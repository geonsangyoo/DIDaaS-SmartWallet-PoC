"use client";

import { useState, useCallback, useEffect } from "react";
import { inAppWallet, createWallet, walletConnect, smartWallet } from "thirdweb/wallets";
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
  const [safeInfo, setSafeInfo]       = useState<SafeInfo | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState<string | null>(null);

  const account                   = useActiveAccount();
  const { connect }               = useConnect();
  const { disconnect }            = useDisconnect();
  const activeWallet              = useActiveWallet();
  const { connect: openWalletUI } = useConnectModal();

  const role: Role | null = account ? detectRole(account.address) : null;

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
      const safeClient = await buildSafeClient(walletClient, account.address);
      const amountWei = BigInt(Math.round(parseFloat(amount) * 1e18)).toString();

      const result = await safeClient.send({
        transactions: [{
          to: OWNER_ADDRESSES.employee, // must be EIP-55 checksummed (stored as-is from env)
          value: amountWei,
          data: "0x",
        }],
      });

      setSuccess(
        result.transactions?.ethereumTxHash
          ? `✓ Executed immediately! TX: ${result.transactions.ethereumTxHash}`
          : `✓ Expense request submitted! Awaiting 2 more approvals.\n  safeTxHash: ${result.transactions?.safeTxHash}`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proposal failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Shared: build a gas-sponsored Safe client via ThirdWeb SmartWallet ─────
  // SmartWallet.signTypedData() delegates to personalAccount (EOA), so the
  // signature recovers to account.address — the actual Safe owner address.
  // Transactions (execute, deploy) are sent as ERC-4337 UserOperations, so
  // ThirdWeb's paymaster covers the gas; no ETH required in the EOA wallet.
  async function buildSponsoredClient(acc: NonNullable<typeof account>) {
    const sw = smartWallet({ chain: sepolia, sponsorGas: true });
    await sw.connect({ client, chain: sepolia, personalAccount: acc });
    const walletClient = viemAdapter.wallet.toViem({ client, chain: sepolia, wallet: sw });
    return buildSafeClient(walletClient, acc.address);
  }

  // ── Deploy the Safe (one-time) ────────────────────────────────────────────
  const handleDeploy = async () => {
    if (!account) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const sw = smartWallet({ chain: sepolia, sponsorGas: true });
      await sw.connect({ client, chain: sepolia, personalAccount: account });
      const walletClient = viemAdapter.wallet.toViem({ client, chain: sepolia, wallet: sw });
      const txHash = await deploySafe(walletClient, account.address);
      setSuccess(`Safe deployed (gas sponsored)! TX: ${txHash}\nWaiting for confirmation…`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed");
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
        setTimeout(() => refresh(), 4000);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── ② ③ Admin: sign a pending transaction ────────────────────────────────
  // MUST use activeWallet (EOA) directly — SmartWallet wraps typed-data
  // signatures in an ERC-6492/EIP-1271 format that Safe's ecrecover rejects.
  // If this is the last signature, the SDK auto-executes using EOA gas.
  // For gas-sponsored execution use the "⚡ Execute On-Chain" button instead.
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
      const result = await safeClient.confirm({ safeTxHash });
      const execTxHash = result.transactions?.ethereumTxHash;

      setSuccess(
        execTxHash
          ? `✓ All signatures collected — executed!\n  TX: ${execTxHash}`
          : `✓ Signature submitted (${role ? ROLE_CONFIG[role].labelJa : ""}). Waiting for remaining approvals.`
      );
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
    handlePropose,
    handleConfirm,
    handleExecute,
    // Helpers
    alreadySigned,
  };
}
