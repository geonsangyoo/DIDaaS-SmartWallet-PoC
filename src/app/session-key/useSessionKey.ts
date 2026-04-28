"use client";

import { useState } from "react";
import { inAppWallet, smartWallet } from "thirdweb/wallets";
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
} from "thirdweb";
import { addSessionKey } from "thirdweb/extensions/erc4337";
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

export function useSessionKey() {
  const [step, setStep] = useState<SessionKeyStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [execTxHash, setExecTxHash] = useState<string | null>(null);
  const [sessionAccount, setSessionAccount] = useState<Account | null>(null);

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

  // ── Owner: connect to existing smart wallet (default factory) ─────────────
  const handleOwnerConnect = async (idToken: string) => {
    setError(null);
    setStep("connecting");
    try {
      const jwt = await getJwt(idToken);

      const connectedWallet = await connect(async () => {
        const eoaWallet = inAppWallet();
        const personalAccount = await eoaWallet.connect({
          client,
          strategy: "jwt",
          jwt,
          chain: sepolia,
        });

        const sw = smartWallet({ chain: sepolia, sponsorGas: true });
        await sw.connect({ client, personalAccount });
        return sw;
      });

      const smartAcc = connectedWallet?.getAccount();
      if (smartAcc && typeof window !== "undefined") {
        localStorage.setItem(OWNER_ADDR_STORAGE_KEY, smartAcc.address);
      }

      setStep("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStep("error");
    }
  };

  // ── Owner: grant session key to delegate via addSessionKey extension ───────
  //
  // account = useActiveAccount() → smart account whose signTypedData delegates
  // to the underlying EOA.  The contract recovers the EOA and checks isAdmin(EOA).
  const handleGrantSessionKey = async () => {
    if (!account) return;
    setError(null);
    setStep("granting");
    try {
      const smartAccountContract = getContract({
        client,
        chain: sepolia,
        address: account.address,
      });

      const tx = addSessionKey({
        contract: smartAccountContract,
        account,
        sessionKeyAddress: DELEGATE_ADDRESS as `0x${string}`,
        permissions: {
          approvedTargets: "*",
          nativeTokenLimitPerTransaction: parseFloat(AMOUNT_DISPLAY),
          permissionStartTimestamp: new Date(),
          permissionEndTimestamp: new Date(Date.now() + SESSION_DURATION_MS),
        },
      });

      await sendAndConfirmTransaction({ account, transaction: tx });
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grant failed");
      setStep("error");
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
  const executeTransfer = async () => {
    if (!sessionAccount || !RECIPIENT_ADDRESS) return;
    setError(null);
    setStep("executing");
    try {
      const tx = prepareTransaction({
        to: RECIPIENT_ADDRESS as `0x${string}`,
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
    configured,
    handleOwnerConnect,
    handleGrantSessionKey,
    handleDelegateConnect,
    executeTransfer,
    handleDisconnect,
    DELEGATE_ADDRESS,
    RECIPIENT_ADDRESS,
    AMOUNT_DISPLAY,
  };
}
