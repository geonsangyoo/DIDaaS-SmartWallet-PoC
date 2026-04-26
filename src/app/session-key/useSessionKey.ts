"use client";

import { useState } from "react";
import { inAppWallet, smartWallet } from "thirdweb/wallets";
import { DEFAULT_ACCOUNT_FACTORY_V0_7 } from "thirdweb/wallets/smart";
import type { Account } from "thirdweb/wallets";
import {
  useConnect,
  useActiveAccount,
  useDisconnect,
  useActiveWallet,
} from "thirdweb/react";
import { sepolia } from "thirdweb/chains";
import { prepareTransaction, sendTransaction } from "thirdweb";
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
  | "ready"
  | "link-connecting"
  | "executing"
  | "done"
  | "error";

export function useSessionKey() {
  const [step, setStep] = useState<SessionKeyStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [execTxHash, setExecTxHash] = useState<string | null>(null);
  // Delegate's session account — points to the owner's smart wallet
  const [sessionAccount, setSessionAccount] = useState<Account | null>(null);

  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const activeWallet = useActiveWallet();
  // Owner flow  → smart account  (smartWallet is the active wallet)
  // Delegate flow → EOA          (plain inAppWallet is the active wallet)
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

  // ── Owner: connect smart wallet with sessionKey option ────────────────────
  //
  // Guide: https://portal.thirdweb.com/engine/v3/guides/session-keys  (Step 1–2)
  //
  // Key insight: passing `sessionKey` to smartWallet() makes the SDK register
  // the session key automatically during connect(), using personalAccount (EOA)
  // internally — NOT the smart account.  The EOA is the admin, so
  // setPermissionsForSigner passes the isAdmin(msg.sender) check.
  //
  // The previous approach (manually calling addSessionKey with account = smart
  // account) failed because msg.sender in the contract was the smart account
  // address, which is not in the admin set.
  const handleOwnerConnect = async (idToken: string) => {
    setError(null);
    setStep("connecting");
    try {
      const jwt = await getJwt(idToken);

      const connectedWallet = await connect(async () => {
        // Step 1 (guide): personal account — the admin signer
        const eoaWallet = inAppWallet();
        const personalAccount = await eoaWallet.connect({
          client,
          strategy: "jwt",
          jwt,
          chain: sepolia,
        });

        // Step 2 (guide): smartWallet with sessionKey — SDK auto-registers
        // the delegate address as a session key signer on connect()
        const sw = smartWallet({
          chain: sepolia,
          factoryAddress: DEFAULT_ACCOUNT_FACTORY_V0_7,
          sessionKey: {
            address: DELEGATE_ADDRESS,
            permissions: {
              approvedTargets: "*",
              nativeTokenLimitPerTransaction: parseFloat(AMOUNT_DISPLAY),
              permissionStartTimestamp: new Date(),
              permissionEndTimestamp: new Date(Date.now() + SESSION_DURATION_MS),
            },
          },
          sponsorGas: true,
        });

        // Step 3 (guide): connect — session key registration happens here
        await sw.connect({ client, personalAccount });
        return sw; // smart wallet becomes the active wallet
      });

      // Save smart account address so the Delegate tab can pre-fill it
      const smartAcc = connectedWallet?.getAccount();
      if (smartAcc && typeof window !== "undefined") {
        localStorage.setItem(OWNER_ADDR_STORAGE_KEY, smartAcc.address);
      }

      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStep("error");
    }
  };

  // ── Delegate: connect EOA → link to owner's smart wallet as session key ───
  //
  // Guide Step 4 uses Engine.serverWallet (server-side). For a frontend PoC,
  // we use smartWallet with overrides.accountAddress — the client-side
  // equivalent: the SDK signs UserOps with the delegate EOA (the registered
  // session key) and submits them targeting the owner's smart account.
  const handleDelegateConnect = async (idToken: string, ownerAddr: string) => {
    setError(null);
    setStep("connecting");
    try {
      if (!ownerAddr) throw new Error("Owner's smart account address is required");

      const jwt = await getJwt(idToken);

      // Connect delegate's plain EOA (the address registered as session key)
      const connectedWallet = await connect(async () => {
        const wallet = inAppWallet();
        await wallet.connect({ client, strategy: "jwt", jwt, chain: sepolia });
        return wallet;
      });

      const delegateEOA = connectedWallet?.getAccount();
      if (!delegateEOA) throw new Error("Failed to get delegate EOA");

      // Link to owner's smart account — delegate EOA acts as session key signer
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
  // Guide Step 5: sendTransaction with the session account
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
    account,        // smart account (owner) or EOA (delegate)
    sessionAccount, // delegate's session account (owner's smart wallet)
    configured,
    handleOwnerConnect,
    handleDelegateConnect,
    executeTransfer,
    handleDisconnect,
    DELEGATE_ADDRESS,
    RECIPIENT_ADDRESS,
    AMOUNT_DISPLAY,
  };
}
