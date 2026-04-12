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
import { BACKEND_URL, TX_SERVICE, RPC_URL, SAFE_API_KEY } from "../multisig/config";

// Recovery Safe: a separate Safe with guardians as owners, threshold 1.
// Create at app.safe.global (Sepolia, owners: guardian + admin1 "lost key", threshold: 1)
// then set NEXT_PUBLIC_RECOVERY_SAFE_ADDRESS in .env.local.
const RECOVERY_SAFE_ADDRESS = process.env.NEXT_PUBLIC_RECOVERY_SAFE_ADDRESS || "";

export interface RecoverySafeInfo {
  safeAddress: string;
  owners: string[];
  threshold: number;
}

function txServiceConfig() {
  return SAFE_API_KEY
    ? { apiKey: SAFE_API_KEY }
    : { txServiceUrl: TX_SERVICE };
}

async function buildRecoverySafeClient(walletClient: any, signerAddress: string) {
  const { createSafeClient } = await import("@safe-global/sdk-starter-kit");
  return createSafeClient({
    provider: walletClient,
    signer: signerAddress,
    safeAddress: RECOVERY_SAFE_ADDRESS,
    ...txServiceConfig(),
  });
}

async function buildReadOnlyRecoverySafeClient() {
  const { createSafeClient } = await import("@safe-global/sdk-starter-kit");
  return createSafeClient({
    provider: RPC_URL,
    safeAddress: RECOVERY_SAFE_ADDRESS,
    ...txServiceConfig(),
  });
}

export function useRecovery() {
  const [safeInfo, setSafeInfo]         = useState<RecoverySafeInfo | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState<string | null>(null);

  const account                   = useActiveAccount();
  const { connect }               = useConnect();
  const { disconnect }            = useDisconnect();
  const activeWallet              = useActiveWallet();
  const { connect: openWalletUI } = useConnectModal();

  const isConfigured = !!RECOVERY_SAFE_ADDRESS;

  // ── Fetch Recovery Safe info (owners, threshold) ──────────────────────────
  const refresh = useCallback(async () => {
    if (!isConfigured) return;
    setFetchLoading(true);
    try {
      const sc = await buildReadOnlyRecoverySafeClient();
      const safeAddress = await sc.protocolKit.getAddress();
      const owners      = await sc.protocolKit.getOwners();
      const threshold   = await sc.protocolKit.getThreshold();
      setSafeInfo({ safeAddress, owners, threshold });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Recovery Safe info");
    } finally {
      setFetchLoading(false);
    }
  }, [isConfigured]);

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

  // ── WalletConnect / MetaMask ─────────────────────────────────────────────
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
        showAllWallets: true,
        size: "compact",
        theme: "dark",
        title: "Guardian — Connect Wallet",
        showThirdwebBranding: false,
      });
    } catch {
      setError("Wallet connection failed");
    }
  };

  const handleDisconnect = () => {
    if (activeWallet) disconnect(activeWallet);
  };

  // ── Guardian Recovery: swapOwner (lostKey → newKey) ──────────────────────
  //
  // Prerequisites:
  //   - Recovery Safe exists with owners = [guardian, lostKey], threshold = 1
  //   - Guardian is connected (account.address === guardian address)
  //
  // Flow:
  //   1. Create swapOwner Safe tx via protocolKit
  //   2. Sign with guardian's EOA (activeWallet — not ERC-4337 to avoid EIP-1271 wrapping)
  //   3. Propose to TX Service
  //   4. Execute via ERC-4337 sponsored account (if inApp wallet) or normal EOA execution
  //
  // The ERC-4337 executor is separate from the Safe signer: Safe verifies the
  // guardian's ECDSA signature on-chain, while anyone (including the smart account
  // relayer) can call execTransaction as the executor.
  const handleRecover = async (lostOwnerAddress: string, newOwnerAddress: string) => {
    if (!activeWallet || !account) return;
    if (!isConfigured) {
      setError("NEXT_PUBLIC_RECOVERY_SAFE_ADDRESS is not configured");
      return;
    }
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      // Step 1: Build safe client from the EOA wallet for signing
      const walletClient = viemAdapter.wallet.toViem({
        client,
        chain: sepolia,
        wallet: activeWallet,
      });
      const safeClient = await buildRecoverySafeClient(walletClient as any, account.address);

      // Step 2: Create the swapOwner tx (protocolKit auto-resolves prevOwner)
      const swapOwnerTx = await safeClient.protocolKit.createSwapOwnerTx({
        oldOwnerAddress: lostOwnerAddress,
        newOwnerAddress,
      });

      const safeTxHash   = await safeClient.protocolKit.getTransactionHash(swapOwnerTx);
      const signature    = await safeClient.protocolKit.signHash(safeTxHash);
      const safeAddress  = await safeClient.protocolKit.getAddress();

      // Step 3: Propose to TX Service
      await safeClient.apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: swapOwnerTx.data,
        safeTxHash,
        senderAddress:   account.address,
        senderSignature: signature.data,
      });

      // Step 4: Execute
      // threshold = 1 → guardian's single signature meets threshold → execute now.
      if (activeWallet.id === "inApp") {
        // Gas-sponsored execution via ERC-4337 (requires ThirdWeb in-app wallet session)
        const sponsoredWallet = inAppWallet({
          executionMode: {
            mode: "EIP4337",
            smartAccount: { chain: sepolia, sponsorGas: true },
          },
        });
        await sponsoredWallet.autoConnect({ client, chain: sepolia });
        const sponsoredWalletClient = viemAdapter.wallet.toViem({
          client,
          chain: sepolia,
          wallet: sponsoredWallet,
        });
        const sponsoredSafeClient = await buildRecoverySafeClient(
          sponsoredWalletClient as any,
          account.address,
        );
        const result      = await sponsoredSafeClient.confirm({ safeTxHash });
        const execTxHash  = result.transactions?.ethereumTxHash;

        if (execTxHash) {
          setSuccess(
            `✓ Recovery executed (gas sponsored)!\n` +
            `  TX: ${execTxHash}\n` +
            `  Lost key  : ${lostOwnerAddress}\n` +
            `  New key   : ${newOwnerAddress}\n` +
            `  The Recovery Safe owners list has been updated on-chain.`
          );
          // Refresh after block confirmation (TX service may lag)
          setTimeout(() => refresh(), 3000);
        } else {
          setSuccess(`Recovery submitted. Status: ${result.status}`);
        }
      } else {
        // WalletConnect: guardian just proposed; confirm in Safe app or re-run with a signer
        setSuccess(
          `✓ Recovery transaction proposed!\n` +
          `  safeTxHash: ${safeTxHash}\n` +
          `  The Recovery Safe threshold is 1 — your signature already qualifies.\n` +
          `  Open app.safe.global to execute, or reconnect with Google login for gas-sponsored execution.`
        );
      }

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Check if connected wallet is a guardian (owner of Recovery Safe) ──────
  const isGuardian =
    !!account &&
    !!safeInfo &&
    safeInfo.owners.some((o) => o.toLowerCase() === account.address.toLowerCase());

  return {
    safeInfo,
    isConfigured,
    isGuardian,
    fetchLoading,
    actionLoading,
    error,
    success,
    account,
    activeWallet,
    refresh,
    handleGoogleLogin,
    handleWalletConnect,
    handleDisconnect,
    handleRecover,
  };
}
