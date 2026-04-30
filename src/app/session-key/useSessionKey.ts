"use client";

import { useState } from "react";
import { inAppWallet, smartWallet } from "thirdweb/wallets";
import { predictSmartAccountAddress } from "thirdweb/wallets/smart";
import type { Account } from "thirdweb/wallets";
import {
  useConnect,
  useActiveAccount,
  useDisconnect,
  useActiveWallet,
} from "thirdweb/react";
import { sepolia } from "thirdweb/chains";
import {
  getContract,
  prepareTransaction,
  sendTransaction,
  sendAndConfirmTransaction,
  deploySmartAccount,
} from "thirdweb";
import { addSessionKey, getAllActiveSigners } from "thirdweb/extensions/erc4337";
import { client } from "../client";
import {
  BACKEND_URL,
  DELEGATE_ADDRESS,
  RECIPIENT_ADDRESS,
  AMOUNT_DISPLAY,
  AMOUNT_WEI,
  SESSION_DURATION_MS,
  OWNER_ADDR_STORAGE_KEY,
} from "./config";

export type SessionKeyStep =
  | "idle"
  | "connecting"
  | "connected"       // wallet connected, session key not yet granted
  | "granting"        // addSessionKey tx in progress
  | "ready"           // grant complete (owner) or linked to owner SA (delegate)
  | "link-connecting"
  | "executing"
  | "done"
  | "error";

export type ActiveSigner = {
  signer: string;
  approvedTargets: readonly string[];
  nativeTokenLimitPerTransaction: bigint;
  startTimestamp: bigint;
  endTimestamp: bigint;
};

export function useSessionKey() {
  const [step, setStep] = useState<SessionKeyStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [execTxHash, setExecTxHash] = useState<string | null>(null);
  const [sessionAccount, setSessionAccount] = useState<Account | null>(null);
  const [ownerSmartAccountAddress, setOwnerSmartAccountAddress] = useState<string | null>(null);
  const [activeSigners, setActiveSigners] = useState<ActiveSigner[]>([]);
  const [signersLoading, setSignersLoading] = useState(false);

  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const activeWallet = useActiveWallet();
  const account = useActiveAccount();

  const configured = !!(DELEGATE_ADDRESS && RECIPIENT_ADDRESS);

  const getJwt = async (idToken: string): Promise<string> => {
    const res = await fetch(`${BACKEND_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) throw new Error("Failed to get JWT from backend");
    const { jwt } = (await res.json()) as { jwt: string };
    return jwt;
  };

  // ── Owner: connect with in-app wallet only (EOA, no smart wallet wrapper) ─
  //
  // The active account is the EOA itself.  The smart account address is
  // predicted from the EOA (default factory) so it can be shared with the
  // delegate and used as the contract target when granting the session key.
  const handleOwnerConnect = async (idToken: string) => {
    setError(null);
    setStep("connecting");
    try {
      const jwt = await getJwt(idToken);

      const connectedWallet = await connect(async () => {
        const eoaWallet = inAppWallet();
        await eoaWallet.connect({
          client,
          strategy: "jwt",
          jwt,
          chain: sepolia,
        });
        return eoaWallet;
      });

      const eoa = connectedWallet?.getAccount();
      if (!eoa) throw new Error("Failed to get EOA");

      const predictedSmartAddr = await predictSmartAccountAddress({
        client,
        chain: sepolia,
        adminAddress: eoa.address,
      });
      setOwnerSmartAccountAddress(predictedSmartAddr);

      if (typeof window !== "undefined") {
        localStorage.setItem(OWNER_ADDR_STORAGE_KEY, predictedSmartAddr);
      }

      setStep("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStep("error");
    }
  };

  // ── Owner: grant session key to delegate via addSessionKey extension ───────
  //
  // account = useActiveAccount() → EOA (in-app wallet).  We lazily wrap it in
  // a smart wallet only for this transaction so the smart account is deployed
  // and the addSessionKey UserOp is sponsored.  The owner's visible identity
  // (account.address) remains the EOA.
  const handleGrantSessionKey = async (recipient: string) => {
    if (!account) return;
    if (!recipient) {
      setError("Recipient address is required");
      return;
    }
    setError(null);
    setStep("granting");
    try {
      const sw = smartWallet({ chain: sepolia, sponsorGas: true });
      const smartAccount = await sw.connect({ client, personalAccount: account });

      const smartAccountContract = getContract({
        client,
        chain: sepolia,
        address: smartAccount.address,
      });

      // Ensure the smart account exists on-chain before granting.  This avoids
      // bundlers that fail to lazily deploy + call setPermissionsForSigner in a
      // single UserOp, which surfaces as a confusing "not admin" revert.
      await deploySmartAccount({
        smartAccount,
        chain: sepolia,
        client,
        accountContract: smartAccountContract,
      });

      const tx = addSessionKey({
        contract: smartAccountContract,
        account: smartAccount,
        sessionKeyAddress: DELEGATE_ADDRESS as `0x${string}`,
        permissions: {
          approvedTargets: [recipient as `0x${string}`],
          nativeTokenLimitPerTransaction: parseFloat(AMOUNT_DISPLAY),
          permissionStartTimestamp: new Date(),
          permissionEndTimestamp: new Date(Date.now() + SESSION_DURATION_MS),
        },
      });

      await sendAndConfirmTransaction({ account: smartAccount, transaction: tx });

      setOwnerSmartAccountAddress(smartAccount.address);
      if (typeof window !== "undefined") {
        localStorage.setItem(OWNER_ADDR_STORAGE_KEY, smartAccount.address);
      }

      await loadActiveSigners(smartAccount.address);

      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grant failed");
      setStep("error");
    }
  };

  // Read on-chain list of active session keys for the given Smart Account.
  const loadActiveSigners = async (smartAccountAddr?: string) => {
    const target = smartAccountAddr ?? ownerSmartAccountAddress;
    if (!target) {
      setError("Smart Account address not available");
      return;
    }
    setError(null);
    setSignersLoading(true);
    try {
      const contract = getContract({ client, chain: sepolia, address: target });
      const signers = await getAllActiveSigners({ contract });
      setActiveSigners(signers as unknown as ActiveSigner[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load signers");
    } finally {
      setSignersLoading(false);
    }
  };

  // ── Delegate: connect EOA → link to owner's smart wallet as session key ───
  const handleDelegateConnect = async (idToken: string, ownerAddr: string) => {
    setError(null);
    setStep("connecting");
    try {
      if (!ownerAddr) throw new Error("Owner's smart account address is required");

      const jwt = await getJwt(idToken);

      const connectedWallet = await connect(async () => {
        const wallet = inAppWallet();
        await wallet.connect({ client, strategy: "jwt", jwt, chain: sepolia });
        return wallet;
      });

      const delegateEOA = connectedWallet?.getAccount();
      if (!delegateEOA) throw new Error("Failed to get delegate EOA");

      setStep("link-connecting");
      const ownerSessionWallet = smartWallet({
        chain: sepolia,
        sponsorGas: true,
        overrides: { accountAddress: ownerAddr },
      });

      const session = await ownerSessionWallet.connect({
        client,
        personalAccount: delegateEOA,
      });

      setSessionAccount(session);
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStep("error");
    }
  };

  // ── Delegate: execute ETH transfer from owner's smart account ─────────────
  const executeTransfer = async (recipient: string) => {
    if (!sessionAccount) return;
    if (!recipient) {
      setError("Recipient address is required");
      return;
    }
    setError(null);
    setStep("executing");
    try {
      const tx = prepareTransaction({
        to: recipient as `0x${string}`,
        value: AMOUNT_WEI,
        chain: sepolia,
        client,
      });

      const { transactionHash } = await sendTransaction({
        account: sessionAccount,
        transaction: tx,
      });

      setExecTxHash(transactionHash);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
      setStep("error");
    }
  };

  const handleDisconnect = () => {
    if (activeWallet) disconnect(activeWallet);
    setSessionAccount(null);
    setOwnerSmartAccountAddress(null);
    setActiveSigners([]);
    setStep("idle");
    setExecTxHash(null);
    setError(null);
  };

  return {
    step,
    error,
    execTxHash,
    account,
    sessionAccount,
    ownerSmartAccountAddress,
    activeSigners,
    signersLoading,
    configured,
    handleOwnerConnect,
    handleGrantSessionKey,
    handleDelegateConnect,
    executeTransfer,
    loadActiveSigners,
    handleDisconnect,
    DELEGATE_ADDRESS,
    RECIPIENT_ADDRESS,
    AMOUNT_DISPLAY,
  };
}
