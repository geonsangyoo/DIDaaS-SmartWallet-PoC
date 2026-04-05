"use client";

import { useState } from "react";
import { inAppWallet } from "thirdweb/wallets";
import {
  createSessionKey,
} from "thirdweb/wallets/in-app";
import {
  useConnect,
  useActiveAccount,
  useDisconnect,
  useActiveWallet,
} from "thirdweb/react";
import { sepolia } from "thirdweb/chains";
import {
  prepareTransaction,
  sendBatchTransaction,
  waitForReceipt,
} from "thirdweb";
import { client } from "../client";
import { BACKEND_URL } from "../multisig/config";
import {
  BATCH_RECIPIENT_1,
  BATCH_RECIPIENT_2,
  BATCH_AMOUNT_1,
  BATCH_AMOUNT_2,
  BATCH_AMOUNT_1_DISPLAY,
  BATCH_AMOUNT_2_DISPLAY,
} from "./config";

export type BatchStep =
  | "idle"
  | "connecting"
  | "ready"
  | "executing"
  | "done"
  | "error";

export interface TxPreview {
  index: number;
  label: string;
  labelJa: string;
  to: string;
  amountDisplay: string;
}

export function useBatch() {
  const [step, setStep] = useState<BatchStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const account = useActiveAccount();
  const activeWallet = useActiveWallet();

  const contractsConfigured = !!(BATCH_RECIPIENT_1 && BATCH_RECIPIENT_2);

  // ── Preview of the two transactions that will be batched ──────────────────
  const txPreviews: TxPreview[] = [
    {
      index: 1,
      label: "ETH Transfer",
      labelJa: "ETH送金",
      to: BATCH_RECIPIENT_1,
      amountDisplay: BATCH_AMOUNT_1_DISPLAY,
    },
    {
      index: 2,
      label: "ETH Transfer",
      labelJa: "ETH送金",
      to: BATCH_RECIPIENT_2,
      amountDisplay: BATCH_AMOUNT_2_DISPLAY,
    },
  ];

  // ── Google OAuth → thirdweb in-app wallet with ERC-4337 ──────────────────
  const handleGoogleLogin = async (idToken: string) => {
    setError(null);
    setStep("connecting");
    try {
      const res = await fetch(`${BACKEND_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("Failed to get JWT from backend");
      const { jwt } = await res.json();

      await connect(async () => {
        const wallet = inAppWallet({
          executionMode: {
            mode: "EIP4337",
            smartAccount: { chain: sepolia, sponsorGas: true },
          },
        });
        await wallet.connect({ client, strategy: "jwt", jwt, chain: sepolia });
        return wallet;
      });
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setStep("error");
    }
  };

  const handleDisconnect = () => {
    if (activeWallet) disconnect(activeWallet);
    setStep("idle");
    setTxHash(null);
    setError(null);
  };

  // ── Execute the batch: tx1 (ETH to recipient_1) + tx2 (ETH to recipient_2)
  // Both are packed into a single ERC-4337 UserOperation by sendBatch().
  // The EntryPoint contract executes them sequentially within one on-chain tx.
  const executeBatch = async () => {
    if (!account || !contractsConfigured) return;
    setStep("executing");
    setError(null);
    setTxHash(null);

    try {
      // tx1: send BATCH_AMOUNT_1 ETH to BATCH_RECIPIENT_1
      const tx1 = prepareTransaction({
        to: BATCH_RECIPIENT_1 as `0x${string}`,
        value: BATCH_AMOUNT_1,
        chain: sepolia,
        client,
      });

      // tx2: send BATCH_AMOUNT_2 ETH to BATCH_RECIPIENT_2
      const tx2 = prepareTransaction({
        to: BATCH_RECIPIENT_2 as `0x${string}`,
        value: BATCH_AMOUNT_2,
        chain: sepolia,
        client,
      });

      const waitForReceiptOptions = await sendBatchTransaction({
        account,
        transactions: [tx1, tx2],
      });

      const receipt = await waitForReceipt(waitForReceiptOptions);
      setTxHash(receipt.transactionHash);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch execution failed");
      setStep("error");
    }
  };

  return {
    step,
    error,
    txHash,
    account,
    txPreviews,
    contractsConfigured,
    handleGoogleLogin,
    handleDisconnect,
    executeBatch,
  };
}
