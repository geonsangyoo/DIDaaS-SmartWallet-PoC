"use client";

import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import { useBatch } from "./useBatch";
import {
  BATCH_RECIPIENT_1,
  BATCH_RECIPIENT_2,
  BATCH_AMOUNT_1_DISPLAY,
  BATCH_AMOUNT_2_DISPLAY,
} from "./config";

function shorten(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

export default function BatchPage() {
  const {
    step,
    error,
    txHash,
    account,
    txPreviews,
    contractsConfigured,
    handleGoogleLogin,
    handleDisconnect,
    executeBatch,
  } = useBatch();

  return (
    <main className="min-h-[100vh] bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">
            ← Home
          </Link>
          <h1 className="text-2xl font-bold mt-1">Batch Transaction Verification</h1>
          <p className="text-zinc-400 text-sm">
            バッチトランザクション検証 — ERC-4337 SmartWallet (Sepolia)
          </p>
        </div>

        {/* Scenario explanation */}
        <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            Scenario — Two ETH Transfers as One UserOperation
          </p>
          <p className="text-sm text-zinc-300">
            tx1とtx2をまとめて実行できることを確認するシナリオ。
            SmartWalletから2件のETH送金を一括して、単一のERC-4337 UserOperationとして実行します。
          </p>
          <p className="text-sm text-zinc-400">
            Both transfers are packed into a{" "}
            <span className="text-purple-400 font-medium">single ERC-4337 UserOperation</span>{" "}
            via{" "}
            <code className="text-zinc-200 text-xs bg-zinc-800 px-1 rounded">
              sendBatchTransaction()
            </code>
            , executing atomically — one on-chain transaction, one UserOp hash.
          </p>

          {/* Transaction flow diagram */}
          <div className="flex items-center gap-3 pt-1 flex-wrap">
            <div className="border border-blue-500/40 bg-blue-500/10 rounded-lg px-4 py-2 text-xs text-center">
              <p className="text-blue-400 font-medium">tx1</p>
              <p className="text-zinc-300 mt-0.5">
                {BATCH_AMOUNT_1_DISPLAY} ETH → {BATCH_RECIPIENT_1 ? shorten(BATCH_RECIPIENT_1) : "recipient_1"}
              </p>
            </div>
            <span className="text-zinc-600 font-bold">+</span>
            <div className="border border-green-500/40 bg-green-500/10 rounded-lg px-4 py-2 text-xs text-center">
              <p className="text-green-400 font-medium">tx2</p>
              <p className="text-zinc-300 mt-0.5">
                {BATCH_AMOUNT_2_DISPLAY} ETH → {BATCH_RECIPIENT_2 ? shorten(BATCH_RECIPIENT_2) : "recipient_2"}
              </p>
            </div>
            <span className="text-zinc-600 font-bold">=</span>
            <div className="border border-purple-500/40 bg-purple-500/10 rounded-lg px-4 py-2 text-xs text-center">
              <p className="text-purple-400 font-medium">1 UserOperation</p>
              <p className="text-zinc-500 mt-0.5">atomic</p>
            </div>
          </div>
        </div>

        {/* Setup notice — missing env vars */}
        {!contractsConfigured && (
          <div className="border border-amber-700/50 rounded-xl p-4 bg-amber-900/10 text-sm space-y-3">
            <p className="text-amber-400 font-medium">
              Setup required — recipient addresses not configured
            </p>
            <p className="text-zinc-300">
              Add the following to{" "}
              <code className="text-zinc-200">.env.local</code> and restart the
              dev server:
            </p>
            <pre className="text-xs text-zinc-400 bg-zinc-900 rounded p-3 overflow-x-auto">{`# First ETH transfer recipient
NEXT_PUBLIC_BATCH_RECIPIENT_1=0x...

# Second ETH transfer recipient
NEXT_PUBLIC_BATCH_RECIPIENT_2=0x...

# Optional: amount in ETH (default: 0.001 each)
NEXT_PUBLIC_BATCH_AMOUNT_1=0.001
NEXT_PUBLIC_BATCH_AMOUNT_2=0.001`}</pre>
          </div>
        )}

        {/* Configured recipients */}
        {contractsConfigured && (
          <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30 space-y-2 text-xs">
            <p className="text-zinc-500 uppercase tracking-wider">Recipients — Sepolia</p>
            <div className="flex justify-between">
              <span className="text-zinc-500">Recipient 1</span>
              <span className="font-mono text-zinc-300">{BATCH_RECIPIENT_1}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Recipient 2</span>
              <span className="font-mono text-zinc-300">{BATCH_RECIPIENT_2}</span>
            </div>
          </div>
        )}

        {/* Status messages */}
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm whitespace-pre-wrap">
            {error}
          </div>
        )}
        {txHash && (
          <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-sm space-y-1">
            <p className="font-medium">✓ Batch executed atomically!</p>
            <p className="text-xs">
              UserOperation TX:{" "}
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="underline font-mono"
              >
                {shorten(txHash)}
              </a>
            </p>
            <p className="text-xs text-green-600">
              tx1 + tx2 confirmed in a single on-chain transaction.
            </p>
          </div>
        )}

        {/* Wallet connection */}
        <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Connect Wallet</p>
          <p className="text-xs text-zinc-500">
            Google OAuth → ThirdWeb in-app wallet → ERC-4337 SmartAccount (gas sponsored)
          </p>

          {account ? (
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-zinc-500">SmartAccount Address</p>
                <p className="font-mono text-sm text-zinc-200 break-all">
                  {account.address}
                </p>
              </div>
              <button
                onClick={handleDisconnect}
                className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded shrink-0 ml-4"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <GoogleLogin
                onSuccess={(res) => res.credential && handleGoogleLogin(res.credential)}
                onError={() => {}}
                theme="filled_black"
                shape="rectangular"
                size="medium"
              />
              {step === "connecting" && (
                <p className="text-xs text-zinc-400">Connecting…</p>
              )}
            </div>
          )}
        </div>

        {/* Transaction preview */}
        {account && (
          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Batch Contents — 2 transactions → 1 UserOperation
            </p>

            {txPreviews.map((tx) => (
              <div
                key={tx.index}
                className={`rounded-lg p-4 border space-y-2 ${
                  tx.index === 1
                    ? "border-blue-500/30 bg-blue-500/5"
                    : "border-green-500/30 bg-green-500/5"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded ${
                      tx.index === 1
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-green-500/20 text-green-400"
                    }`}
                  >
                    tx{tx.index}
                  </span>
                  <span className="text-sm font-medium text-zinc-200">
                    {tx.label}
                  </span>
                  <span className="text-xs text-zinc-500">{tx.labelJa}</span>
                </div>
                <div className="text-xs space-y-0.5">
                  <p className="text-zinc-400">
                    <span className="text-zinc-500">from: </span>
                    <span className="font-mono">{shorten(account.address)}</span>
                    <span className="text-zinc-500"> (SmartAccount)</span>
                  </p>
                  <p className="text-zinc-400">
                    <span className="text-zinc-500">to: </span>
                    <span className="font-mono">{tx.to || "—"}</span>
                  </p>
                  <p className="text-zinc-400">
                    <span className="text-zinc-500">value: </span>
                    <span className="text-zinc-200">{tx.amountDisplay} ETH</span>
                  </p>
                </div>
              </div>
            ))}

            <div className="border-t border-zinc-800 pt-3 flex items-start gap-2 text-xs text-zinc-500">
              <span className="text-purple-400 mt-0.5">→</span>
              <span>
                <code className="bg-zinc-800 px-1 rounded text-zinc-300">
                  sendBatchTransaction()
                </code>{" "}
                packs both ETH transfers into one UserOperation. The EntryPoint
                contract executes them sequentially within a single Ethereum
                transaction — both succeed or both revert.
              </span>
            </div>
          </div>
        )}

        {/* Execute button */}
        {account && (
          <button
            onClick={executeBatch}
            disabled={
              !contractsConfigured ||
              step === "executing" ||
              step === "connecting"
            }
            className="w-full py-3 px-4 rounded-xl bg-purple-700 hover:bg-purple-600 text-white font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {step === "executing"
              ? "Executing batch… (waiting for UserOp confirmation)"
              : "⚡ Execute Batch (tx1 + tx2 atomically)"}
          </button>
        )}

      </div>
    </main>
  );
}
