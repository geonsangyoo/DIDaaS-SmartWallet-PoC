"use client";

import { useState, useCallback, useEffect } from "react";
import { inAppWallet, createWallet, walletConnect } from "thirdweb/wallets";
import {
  useConnect,
  useActiveAccount,
  useDisconnect,
  useActiveWallet,
  useConnectModal,
} from "thirdweb/react";
import { viemAdapter } from "thirdweb/adapters/viem";
import { sepolia } from "thirdweb/chains";
import { client } from "../client";
import {
  BACKEND_URL,
  OWNER_ADDRESSES,
  detectRole,
  ROLE_CONFIG,
} from "./config";
import { fetchPendingTxs, buildSafeClient, buildReadOnlySafeClient, deploySafe, isSafeRegistered } from "./safe";
import type { SafeInfo, SafeTransaction, Role } from "./types";

export function useSafe() {
  const [safeInfo, setSafeInfo]             = useState<SafeInfo | null>(null);
  const [isEmployeeDelegate, setIsEmployeeDelegate] = useState<boolean>(false);
  const [fetchLoading, setFetchLoading]     = useState(false);
  const [actionLoading, setActionLoading]   = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [success, setSuccess]               = useState<string | null>(null);

  const account                   = useActiveAccount();
  const { connect }               = useConnect();
  const { disconnect }            = useDisconnect();
  const activeWallet              = useActiveWallet();
  const { connect: openWalletUI } = useConnectModal();

  const role: Role | null = account ? detectRole(account.address) : null;

  // employee is not a Safe owner but their address is used as the expense recipient
  const ownersConfigured = !!(
    OWNER_ADDRESSES.employee &&
    OWNER_ADDRESSES.admin1   &&
    OWNER_ADDRESSES.admin2
  );

  // ── Fetch Safe info (read-only, no wallet required) ──────────────────────
  const refresh = useCallback(async () => {
    if (!ownersConfigured) return;
    setFetchLoading(true);
    try {
      const sc = await buildReadOnlySafeClient();
      const safeAddress = await sc.getAddress();
      const isDeployed = await isSafeRegistered(safeAddress);
      const pendingTransactions = isDeployed ? await fetchPendingTxs(safeAddress) : [];
      setSafeInfo({ safeAddress, isDeployed, pendingTransactions });

      // Check if employee is registered as a delegate for this Safe
      if (isDeployed && OWNER_ADDRESSES.employee) {
        const delegates = await sc.apiKit.getSafeDelegates({
          safeAddress,
          delegateAddress: OWNER_ADDRESSES.employee,
        });
        setIsEmployeeDelegate(delegates.results.length > 0);
      } else {
        setIsEmployeeDelegate(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Safe info");
    } finally {
      setFetchLoading(false);
    }
  }, [ownersConfigured]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Google OAuth → ThirdWeb in-app wallet ────────────────────────────────
  const handleGoogleLogin = async (idToken: string) => {
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const { jwt } = await res.json();
      await connect(async () => {
        const wallet = inAppWallet();
        await wallet.connect({ client, strategy: "jwt", jwt, chain: sepolia });
        return wallet;
      });
    } catch {
      setError("Google login failed");
    }
  };

  // ── Wallet picker UI (Ambire, MetaMask, or any WalletConnect wallet) ────
  const handleWalletConnect = async () => {
    setError(null);
    try {
      await openWalletUI({
        client,
        chain: sepolia,
        wallets: [
          walletConnect(),
          createWallet("io.metamask"),
          createWallet("com.coinbase.wallet"),
        ],
        recommendedWallets: [walletConnect()],
        showAllWallets: true,
        size: "compact",
        theme: "dark",
        title: "上長 — Connect Wallet",
        showThirdwebBranding: false,
      });
    } catch {
      setError("Wallet connection failed");
    }
  };

  const handleDisconnect = () => {
    if (activeWallet) disconnect(activeWallet);
  };

  // ── ① Employee: propose expense reimbursement ────────────────────────────
  // Employee is NOT a Safe owner — uses propose() to submit off-chain to the
  // Safe Transaction Service. No gas required; admins sign and execute later.
  const handlePropose = async (amount: string) => {
    if (!activeWallet || !account) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const walletClient = viemAdapter.wallet.toViem({
        client,
        chain: sepolia,
        wallet: activeWallet,
      });
      // signer = employee (non-owner); Safe TX Service accepts proposals from any address
      const safeClient = await buildSafeClient(walletClient, account.address);
      const amountWei = BigInt(Math.round(parseFloat(amount) * 1e18)).toString();

      // Build the Safe transaction via protocolKit
      const tx = await safeClient.protocolKit.createTransaction({
        transactions: [{
          to: OWNER_ADDRESSES.employee, // must be EIP-55 checksummed (stored as-is from env)
          value: amountWei,
          data: "0x",
        }],
      });

      // Off-chain: employee signs the safeTxHash with their EOA key and posts
      // to the TX Service. Both admins must then confirm before execution.
      const safeTxHash = await safeClient.protocolKit.getTransactionHash(tx);
      const senderSignature = await safeClient.protocolKit.signHash(safeTxHash);
      const safeAddress = await safeClient.protocolKit.getAddress();

      await safeClient.apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: tx.data,
        safeTxHash,
        senderAddress: account.address,
        senderSignature: senderSignature.data,
      });

      setSuccess(
        `✓ Expense request submitted! Awaiting 2 admin approvals.\n  safeTxHash: ${safeTxHash}`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proposal failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Shared: build a gas-sponsored Safe client via ERC-4337 ───────────────
  // The ERC-4337 smart account has a different address than acc.address (EOA),
  // but that is fine for execution: execTransaction only verifies the collected
  // owner signatures on-chain — the caller (executor) can be anyone.
  // acc.address is passed as the Safe SDK's signer context for bookkeeping.
  //
  // Requires a ThirdWeb in-app wallet session (id === "inApp") — WalletConnect
  // wallets have no stored ThirdWeb session for autoConnect, so the paymaster
  // cannot be used. Gas-sponsored execution must be triggered by an account
  // connected via Google (ThirdWeb in-app wallet).
  async function buildSponsoredClient(acc: NonNullable<typeof account>) {
    if (activeWallet?.id !== "inApp") {
      throw new Error(
        "ガス代スポンサーにはThirdWebインアプリウォレット（Googleログイン）が必要です。\n" +
        "WalletConnectウォレットではPaymasterが利用できません。\n" +
        "Gas-sponsored execution requires a ThirdWeb in-app wallet (Google login). " +
        "WalletConnect wallets cannot use the paymaster."
      );
    }
    const wallet = inAppWallet({
      executionMode: {
        mode: "EIP4337",
        smartAccount: { chain: sepolia, sponsorGas: true },
      },
    });
    await wallet.autoConnect({ client, chain: sepolia });
    const walletClient = viemAdapter.wallet.toViem({ client, chain: sepolia, wallet });
    return buildSafeClient(walletClient, acc.address);
  }

  // ── Deploy the Safe (one-time) ────────────────────────────────────────────
  const handleDeploy = async () => {
    if (!account) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const wallet = inAppWallet({
        executionMode: {
          mode: "EIP4337",
          smartAccount: { chain: sepolia, sponsorGas: true },
        },
      });
      await wallet.autoConnect({ client, chain: sepolia });
      const walletClient = viemAdapter.wallet.toViem({ client, chain: sepolia, wallet });
      const txHash = await deploySafe(walletClient, account.address);
      setSuccess(`Safe deployed (gas sponsored)! TX: ${txHash}\nWaiting for confirmation…`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Add Employee as Delegate (one-time setup) ─────────────────────────────
  // Allows the employee to propose transactions even though they're not an owner
  const handleAddEmployeeDelegate = async () => {
    if (!activeWallet || !account) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const walletClient = viemAdapter.wallet.toViem({
        client,
        chain: sepolia,
        wallet: activeWallet,
      }) as any; // Type assertion to satisfy Safe SDK types
      const safeClient = await buildSafeClient(walletClient, account.address);
      const safeAddress = await safeClient.protocolKit.getAddress();

      await safeClient.apiKit.addSafeDelegate({
        safeAddress,
        delegateAddress: OWNER_ADDRESSES.employee,
        delegatorAddress: account.address,
        label: "Employee",
        signer: walletClient,
      });

      setSuccess(`✓ Employee added as delegate! They can now propose transactions.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add employee delegate");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Any owner: execute a fully-signed (threshold-met) transaction ────────
  const handleExecute = async (safeTxHash: string) => {
    if (!account) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const safeClient = await buildSponsoredClient(account);
      const result = await safeClient.confirm({ safeTxHash });
      const execTxHash = result.transactions?.ethereumTxHash;
      setSuccess(
        execTxHash
          ? `✓ Executed (gas sponsored)! TX: ${execTxHash}`
          : `Transaction status: ${result.status}`
      );
      // Optimistically mark as executed so the Execute button disappears immediately.
      // The TX Service may lag behind on-chain state, so also re-fetch after a delay.
      if (execTxHash) {
        setSafeInfo(prev => prev ? {
          ...prev,
          pendingTransactions: prev.pendingTransactions.map(tx =>
            tx.safeTxHash === safeTxHash
              ? { ...tx, isExecuted: true, transactionHash: execTxHash }
              : tx
          ),
        } : null);
        setTimeout(() => refresh(), 2000);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── ② ③ Admin: sign a pending transaction (signature only, no auto-execute) ─
  // Uses protocolKit.signTransaction + apiKit.confirmTransaction directly so the
  // SDK never triggers on-chain execution — even when the threshold is met.
  // This keeps execution gas-sponsored: after all approvals are collected the
  // signer clicks "⚡ Execute On-Chain" which routes through ERC-4337.
  //
  // MUST build the Safe client from activeWallet (EOA) — ERC-4337's signTypedData
  // wraps the signature in EIP-1271 format that Safe's ecrecover rejects.
  const handleConfirm = async (safeTxHash: string) => {
    if (!activeWallet || !account) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const walletClient = viemAdapter.wallet.toViem({
        client,
        chain: sepolia,
        wallet: activeWallet,
      });
      const safeClient = await buildSafeClient(walletClient, account.address);

      // Fetch the pending transaction from the TX service
      const pendingTx = await safeClient.apiKit.getTransaction(safeTxHash);

      // Sign using the EOA — produces a raw ECDSA signature Safe can verify
      const signedTx = await safeClient.protocolKit.signTransaction(pendingTx);

      // Extract this signer's signature and post it to the TX service only
      const sig = signedTx.signatures.get(account.address.toLowerCase());
      if (!sig) throw new Error("Failed to generate signature");
      await safeClient.apiKit.confirmTransaction(safeTxHash, sig.data);

      setSuccess(
        `✓ Signature submitted (${role ? ROLE_CONFIG[role].labelJa : ""}). ` +
        `Once all approvals are collected, click ⚡ Execute On-Chain.`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function alreadySigned(tx: SafeTransaction): boolean {
    if (!account) return false;
    const myAddr = account.address.toLowerCase();
    return tx.confirmations.some((c) => c.owner.toLowerCase() === myAddr);
  }

  return {
    // State
    safeInfo,
    isEmployeeDelegate,
    fetchLoading,
    actionLoading,
    error,
    success,
    // ThirdWeb
    account,
    role,
    ownersConfigured,
    // Actions
    refresh,
    handleGoogleLogin,
    handleWalletConnect,
    handleDisconnect,
    handleDeploy,
    handleAddEmployeeDelegate,
    handlePropose,
    handleConfirm,
    handleExecute,
    // Helpers
    alreadySigned,
  };
}
