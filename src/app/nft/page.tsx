"use client";

import { useState } from "react";
import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import {
  useNft,
  type NftPanelState,
  type EditionPanelState,
  type OwnedToken721,
  type OwnedEditionToken,
  type DeployStep,
  EDITION_SUPPLY,
} from "./useNft";
import { useExistingNft } from "./useExistingNft";

// ── Helpers ───────────────────────────────────────────────────────────────────

function shorten(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function TxLink({ hash, className = "text-zinc-400" }: { hash: string; className?: string }) {
  return (
    <a
      href={`https://sepolia.etherscan.io/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className={`font-mono underline ${className}`}
    >
      {shorten(hash)}
    </a>
  );
}

function deployLabel(step: DeployStep): string {
  if (step === "deploying")   return "Deploying contract…";
  if (step === "configuring") return "Configuring roles…";
  return "";
}

// ── ERC-721 Token Row ─────────────────────────────────────────────────────────

function TokenRow721({
  token,
  isSoulbound,
  onTransfer,
}: {
  token: OwnedToken721;
  isSoulbound: boolean;
  onTransfer: (tokenId: bigint, to: string) => void;
}) {
  const [recipient, setRecipient] = useState("");
  const accentColor = isSoulbound ? "text-orange-400" : "text-blue-400";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2 text-xs">
      {/* Token header */}
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono font-semibold ${accentColor}`}>
          Token #{token.tokenId.toString()}
        </span>
        <TxLink hash={token.mintTxHash} className="text-zinc-500" />
      </div>

      {/* Transferred badge */}
      {token.transferred && token.transferTxHash && (
        <div className="flex items-center gap-2 text-green-400">
          <span>✓ Transferred</span>
          <TxLink hash={token.transferTxHash} className="text-green-400" />
        </div>
      )}

      {/* Transfer error (soulbound revert) */}
      {token.transferError && !token.transferred && (
        <div className="rounded bg-red-900/20 border border-red-800 p-2 space-y-1">
          <p className={`font-medium ${isSoulbound ? "text-orange-400" : "text-red-400"}`}>
            {isSoulbound ? "✓ Reverted (soulbound — expected)" : "✗ Transfer failed"}
          </p>
          <p className="text-red-300 break-words leading-relaxed">{token.transferError}</p>
        </div>
      )}

      {/* Transfer form — hide once transferred */}
      {!token.transferred && (
        <div className="space-y-1.5">
          <input
            type="text"
            placeholder="Recipient (0x…)"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            onClick={() => onTransfer(token.tokenId, recipient)}
            disabled={!recipient || token.transferring}
            className={`w-full py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isSoulbound
                ? "bg-orange-900/50 hover:bg-orange-900 border border-orange-700 text-orange-200"
                : "bg-blue-800 hover:bg-blue-700 text-blue-100"
            }`}
          >
            {token.transferring
              ? "Sending…"
              : isSoulbound
              ? "Attempt Transfer (expect revert)"
              : "Transfer"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── ERC-1155 Edition Token Row ────────────────────────────────────────────────

function EditionTokenRow({
  token,
  onTransfer,
}: {
  token: OwnedEditionToken;
  onTransfer: (tokenId: bigint, to: string, amount: bigint) => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("1");
  const balancePct = token.totalSupply > 0n
    ? Number((token.balance * 100n) / token.totalSupply)
    : 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2 text-xs">
      {/* Token header */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold text-purple-400">
          Token #{token.tokenId.toString()}
        </span>
        <TxLink hash={token.mintTxHash} className="text-zinc-500" />
      </div>

      {/* Balance bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-zinc-400">
          <span>Balance</span>
          <span className="font-mono">
            <span className="text-purple-300">{token.balance.toString()}</span>
            <span className="text-zinc-600"> / {token.totalSupply.toString()}</span>
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-purple-600 rounded-full transition-all"
            style={{ width: `${balancePct}%` }}
          />
        </div>
      </div>

      {/* Last transfer tx */}
      {token.transferTxHash && (
        <div className="flex items-center gap-2 text-green-400">
          <span>✓ Last transfer</span>
          <TxLink hash={token.transferTxHash} className="text-green-400" />
        </div>
      )}

      {/* Transfer error */}
      {token.transferError && (
        <div className="rounded bg-red-900/20 border border-red-800 p-2 text-red-300 break-words leading-relaxed">
          {token.transferError}
        </div>
      )}

      {/* Partial transfer form — available as long as balance > 0 */}
      {token.balance > 0n && (
        <div className="space-y-1.5">
          <input
            type="text"
            placeholder="Recipient (0x…)"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <div className="flex items-center gap-2">
            <label className="text-zinc-500 shrink-0">Amount</label>
            <input
              type="number"
              min="1"
              max={token.balance.toString()}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-20 px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-center focus:outline-none focus:border-zinc-500"
            />
            <span className="text-zinc-600">of {token.balance.toString()} remaining</span>
          </div>
          <button
            onClick={() => onTransfer(token.tokenId, recipient, BigInt(amount || "1"))}
            disabled={!recipient || !amount || token.transferring}
            className="w-full py-1.5 rounded text-xs font-medium bg-purple-800 hover:bg-purple-700 text-purple-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {token.transferring
              ? "Sending…"
              : `Transfer ${amount || "?"} cop${Number(amount) === 1 ? "y" : "ies"}`}
          </button>
        </div>
      )}

      {token.balance === 0n && (
        <p className="text-zinc-600 italic">All copies transferred</p>
      )}
    </div>
  );
}

// ── ERC-721 Panel ─────────────────────────────────────────────────────────────

function Erc721Panel({
  title,
  titleJa,
  accentClass,
  borderClass,
  tagClass,
  tagLabel,
  description,
  panel,
  isSoulbound,
  onDeploy,
  onMint,
  onTransfer,
}: {
  title: string;
  titleJa: string;
  accentClass: string;
  borderClass: string;
  tagClass: string;
  tagLabel: string;
  description: string;
  panel: NftPanelState;
  isSoulbound: boolean;
  onDeploy: () => void;
  onMint: () => void;
  onTransfer: (tokenId: bigint, to: string) => void;
}) {
  const deploying = panel.deployStep === "deploying" || panel.deployStep === "configuring";

  return (
    <div className={`border ${borderClass} rounded-xl p-5 bg-zinc-900/30 flex flex-col gap-4`}>
      {/* Header */}
      <div className="space-y-1">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${tagClass}`}>{tagLabel}</span>
        <h2 className={`text-base font-semibold mt-1 ${accentClass}`}>{title}</h2>
        <p className="text-xs text-zinc-500">{titleJa}</p>
        <p className="text-xs text-zinc-400">{description}</p>
      </div>

      {/* Deploy section */}
      <div className="space-y-2">
        <p className="text-xs text-zinc-500 uppercase tracking-wider">Contract</p>
        {panel.contractAddress ? (
          <div className="text-xs space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-green-400 shrink-0">✓</span>
              <a
                href={`https://sepolia.etherscan.io/address/${panel.contractAddress}`}
                target="_blank"
                rel="noreferrer"
                className={`font-mono ${accentClass} underline truncate`}
              >
                {panel.contractAddress}
              </a>
            </div>
            {isSoulbound && (
              <p className="text-zinc-600">
                TRANSFER_ROLE revoked from admin — transfers revert on-chain
              </p>
            )}
          </div>
        ) : (
          <>
            {deploying && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <div className="w-3 h-3 border border-zinc-500 border-t-zinc-300 rounded-full animate-spin shrink-0" />
                {deployLabel(panel.deployStep)}
              </div>
            )}
            <button
              onClick={onDeploy}
              disabled={deploying}
              className={`w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isSoulbound
                  ? "bg-orange-900 hover:bg-orange-800 text-orange-100"
                  : "bg-blue-900 hover:bg-blue-800 text-blue-100"
              }`}
            >
              {deploying ? "Deploying…" : isSoulbound ? "Deploy Soulbound Contract" : "Deploy Standard Contract"}
            </button>
          </>
        )}
      </div>

      {/* Mint section */}
      {panel.contractAddress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Tokens ({panel.tokens.length})
            </p>
            <button
              onClick={onMint}
              disabled={panel.minting}
              className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isSoulbound
                  ? "bg-orange-900 hover:bg-orange-800 text-orange-100"
                  : "bg-blue-900 hover:bg-blue-800 text-blue-100"
              }`}
            >
              {panel.minting ? "Minting…" : "+ Mint NFT"}
            </button>
          </div>

          {panel.tokens.length === 0 && !panel.minting && (
            <p className="text-xs text-zinc-600 italic">No tokens minted yet</p>
          )}

          {panel.minting && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <div className="w-3 h-3 border border-zinc-500 border-t-zinc-300 rounded-full animate-spin shrink-0" />
              Minting…
            </div>
          )}

          <div className="space-y-2">
            {panel.tokens.map((token) => (
              <TokenRow721
                key={token.tokenId.toString()}
                token={token}
                isSoulbound={isSoulbound}
                onTransfer={onTransfer}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ERC-1155 Edition Panel ────────────────────────────────────────────────────

function EditionPanel({
  panel,
  onDeploy,
  onMint,
  onTransfer,
}: {
  panel: EditionPanelState;
  onDeploy: () => void;
  onMint: () => void;
  onTransfer: (tokenId: bigint, to: string, amount: bigint) => void;
}) {
  const deploying = panel.deployStep === "deploying";

  return (
    <div className="border border-purple-900/50 rounded-xl p-5 bg-zinc-900/30 flex flex-col gap-4">
      {/* Header */}
      <div className="space-y-1">
        <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
          Edition (ERC-1155)
        </span>
        <h2 className="text-base font-semibold mt-1 text-purple-400">Edition NFT</h2>
        <p className="text-xs text-zinc-500">エディションNFT（ERC-1155）</p>
        <p className="text-xs text-zinc-400">
          Each mint creates a new <code className="bg-zinc-800 px-1 rounded text-zinc-300">tokenId</code> with{" "}
          <strong className="text-zinc-200">{EDITION_SUPPLY.toString()} copies</strong>. Partial
          transfers reduce the balance. Multiple holders can own the same token.
        </p>
      </div>

      {/* Deploy section */}
      <div className="space-y-2">
        <p className="text-xs text-zinc-500 uppercase tracking-wider">Contract</p>
        {panel.contractAddress ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-400 shrink-0">✓</span>
            <a
              href={`https://sepolia.etherscan.io/address/${panel.contractAddress}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-purple-400 underline truncate"
            >
              {panel.contractAddress}
            </a>
          </div>
        ) : (
          <>
            {deploying && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <div className="w-3 h-3 border border-zinc-500 border-t-zinc-300 rounded-full animate-spin shrink-0" />
                Deploying contract…
              </div>
            )}
            <button
              onClick={onDeploy}
              disabled={deploying}
              className="w-full py-2 rounded-lg text-sm font-medium bg-purple-900 hover:bg-purple-800 text-purple-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deploying ? "Deploying…" : "Deploy Edition Contract"}
            </button>
          </>
        )}
      </div>

      {/* Mint section */}
      {panel.contractAddress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Editions ({panel.tokens.length})
            </p>
            <button
              onClick={onMint}
              disabled={panel.minting}
              className="text-xs px-3 py-1 rounded-lg font-medium bg-purple-900 hover:bg-purple-800 text-purple-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {panel.minting ? "Minting…" : `+ Mint ${EDITION_SUPPLY.toString()} Copies`}
            </button>
          </div>

          {panel.tokens.length === 0 && !panel.minting && (
            <p className="text-xs text-zinc-600 italic">No editions minted yet</p>
          )}

          {panel.minting && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <div className="w-3 h-3 border border-zinc-500 border-t-zinc-300 rounded-full animate-spin shrink-0" />
              Minting…
            </div>
          )}

          <div className="space-y-2">
            {panel.tokens.map((token) => (
              <EditionTokenRow
                key={token.tokenId.toString()}
                token={token}
                onTransfer={onTransfer}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Existing Contract Section ─────────────────────────────────────────────────

function ExistingContractSection() {
  const { state, set, reset, mintExisting, transferExisting } = useExistingNft();
  const isErc1155 = state.contractType === "erc1155";
  const hasContract =
    state.contractAddress.trim().startsWith("0x") &&
    state.contractAddress.trim().length === 42;

  return (
    <div className="border border-zinc-700 rounded-xl p-5 bg-zinc-900/30 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">
            Interact with Existing Contract
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            既存のNFTコントラクトに対してミント・転送を実行
          </p>
        </div>
        <button
          onClick={reset}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700 shrink-0"
        >
          Reset
        </button>
      </div>

      {/* Contract address + type */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 space-y-1">
          <label className="text-xs text-zinc-500">Contract Address (Sepolia)</label>
          <input
            type="text"
            placeholder="0x…"
            value={state.contractAddress}
            onChange={(e) => set({ contractAddress: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Token Standard</label>
          <div className="flex gap-2 h-[38px]">
            {(["erc721", "erc1155"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set({ contractType: t })}
                className={`flex-1 rounded-lg text-xs font-medium transition-colors ${
                  state.contractType === t
                    ? "bg-zinc-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                {t === "erc721" ? "ERC-721" : "ERC-1155"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mint + Transfer cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* ── Mint ─────────────────────────────────────────────────────────── */}
        <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-zinc-200">Mint</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {isErc1155
                ? "Mint a new tokenId with the specified supply."
                : "Mint a new token to the recipient."}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500">NFT Name</label>
            <input
              type="text"
              placeholder="My NFT"
              value={state.mintNftName}
              onChange={(e) => set({ mintNftName: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {isErc1155 && (
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Supply (copies)</label>
              <input
                type="number"
                min="1"
                placeholder="10"
                value={state.mintSupply}
                onChange={(e) => set({ mintSupply: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Recipient (blank = my wallet)</label>
            <input
              type="text"
              placeholder="0x… (optional)"
              value={state.mintRecipient}
              onChange={(e) => set({ mintRecipient: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {state.mintError && (
            <div className="rounded-lg bg-red-900/20 border border-red-800 p-2 text-xs text-red-300 break-words">
              {state.mintError}
            </div>
          )}

          <button
            onClick={mintExisting}
            disabled={!hasContract || state.minting}
            className="w-full py-2 rounded-lg text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {state.minting ? "Minting…" : "Mint NFT"}
          </button>

          {state.mintResults.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-zinc-800">
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Results</p>
              {state.mintResults.map((r) => (
                <div key={r.timestamp} className="flex items-center gap-2 text-xs">
                  <span className="text-green-400 shrink-0">✓</span>
                  <TxLink hash={r.txHash} className="text-green-400" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Transfer ─────────────────────────────────────────────────────── */}
        <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-zinc-200">Transfer</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {isErc1155
                ? "Send N copies of a tokenId from your wallet to a recipient."
                : "Transfer a specific token from your wallet to a recipient."}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Token ID</label>
            <input
              type="number"
              min="0"
              placeholder="0"
              value={state.transferTokenId}
              onChange={(e) => set({ transferTokenId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono focus:outline-none focus:border-zinc-500"
            />
          </div>

          {isErc1155 && (
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Amount</label>
              <input
                type="number"
                min="1"
                placeholder="1"
                value={state.transferAmount}
                onChange={(e) => set({ transferAmount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Recipient</label>
            <input
              type="text"
              placeholder="0x…"
              value={state.transferRecipient}
              onChange={(e) => set({ transferRecipient: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {state.transferError && (
            <div className="rounded-lg bg-red-900/20 border border-red-800 p-2 text-xs text-red-300 break-words">
              {state.transferError}
            </div>
          )}

          <button
            onClick={transferExisting}
            disabled={
              !hasContract ||
              !state.transferTokenId ||
              !state.transferRecipient ||
              state.transferring
            }
            className="w-full py-2 rounded-lg text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {state.transferring ? "Sending…" : "Transfer"}
          </button>

          {state.transferResults.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-zinc-800">
              <p className="text-xs text-zinc-600 uppercase tracking-wider">Results</p>
              {state.transferResults.map((r) => (
                <div key={r.timestamp} className="flex items-center gap-2 text-xs">
                  <span className="text-green-400 shrink-0">✓</span>
                  <TxLink hash={r.txHash} className="text-green-400" />
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NftPage() {
  const {
    account,
    globalError,
    transferable,
    soulbound,
    edition,
    handleGoogleLogin,
    handleDisconnect,
    deployTransferable,
    mintTransferable,
    transferTransferable,
    deploySoulbound,
    mintSoulbound,
    transferSoulbound,
    deployEdition,
    mintEdition,
    transferEdition,
  } = useNft();

  return (
    <main className="min-h-[100vh] bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">
              ← Home
            </Link>
            <Link
              href="/nft/viewer"
              className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 px-3 py-1 rounded transition-colors"
            >
              Contract Viewer →
            </Link>
          </div>
          <h1 className="text-2xl font-bold mt-1">NFT Token Deployment PoC</h1>
          <p className="text-zinc-400 text-sm">
            NFTトークンデプロイ検証 — ThirdWeb SDK + ERC-4337 SmartWallet (Sepolia)
          </p>
        </div>

        {/* Scenario */}
        <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Scenario — 3 NFT Patterns</p>
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="border border-blue-500/40 bg-blue-500/10 rounded-lg px-4 py-2">
              <p className="text-blue-400 font-medium">ERC-721 Transferable</p>
              <p className="text-zinc-400 mt-0.5">Deploy → Mint N tokens → Transfer each ✓</p>
            </div>
            <div className="border border-orange-500/40 bg-orange-500/10 rounded-lg px-4 py-2">
              <p className="text-orange-400 font-medium">ERC-721 Soulbound</p>
              <p className="text-zinc-400 mt-0.5">Deploy → Configure → Mint N → Transfer ✗ (revert)</p>
            </div>
            <div className="border border-purple-500/40 bg-purple-500/10 rounded-lg px-4 py-2">
              <p className="text-purple-400 font-medium">ERC-1155 Edition</p>
              <p className="text-zinc-400 mt-0.5">Deploy → Mint editions → Partial transfer ✓</p>
            </div>
          </div>
          <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-3 space-y-1">
            <p>
              <span className="text-blue-400">Transferable / Soulbound</span>: Both use{" "}
              <code className="bg-zinc-800 px-1 rounded text-zinc-300">TokenERC721</code>.
              Mint multiple tokens per contract. Each token has its own transfer form.
            </p>
            <p>
              <span className="text-purple-400">Edition</span>:{" "}
              <code className="bg-zinc-800 px-1 rounded text-zinc-300">TokenERC1155</code> — each
              mint creates a new <code className="bg-zinc-800 px-1 rounded text-zinc-300">tokenId</code> with{" "}
              {EDITION_SUPPLY.toString()} copies. The balance bar reflects copies remaining after partial
              transfers. Repeat mint to create additional editions (tokenId 0, 1, 2…).
            </p>
          </div>
        </div>

        {/* Global error */}
        {globalError && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm break-words">
            {globalError}
          </div>
        )}

        {/* Wallet */}
        <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Connect Wallet</p>
          <p className="text-xs text-zinc-500">
            Google OAuth → ThirdWeb in-app wallet → ERC-4337 SmartAccount (gas sponsored)
          </p>
          {account ? (
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-zinc-500">SmartAccount Address</p>
                <p className="font-mono text-sm text-zinc-200 break-all">{account.address}</p>
              </div>
              <button
                onClick={handleDisconnect}
                className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded shrink-0 ml-4"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <GoogleLogin
              onSuccess={(res) => res.credential && handleGoogleLogin(res.credential)}
              onError={() => {}}
              theme="filled_black"
              shape="rectangular"
              size="medium"
            />
          )}
        </div>

        {/* Panels */}
        {account && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Erc721Panel
              title="Transferable NFT"
              titleJa="譲渡可能NFT（ERC-721）"
              accentClass="text-blue-400"
              borderClass="border-blue-900/50"
              tagClass="bg-blue-500/20 text-blue-400"
              tagLabel="Transferable"
              description="Standard ERC-721. Each token is unique. Mint as many as you like — each gets its own transfer form."
              panel={transferable}
              isSoulbound={false}
              onDeploy={deployTransferable}
              onMint={mintTransferable}
              onTransfer={transferTransferable}
            />

            <Erc721Panel
              title="Soulbound NFT"
              titleJa="譲渡不可NFT（ERC-721）"
              accentClass="text-orange-400"
              borderClass="border-orange-900/50"
              tagClass="bg-orange-500/20 text-orange-400"
              tagLabel="Non-Transferable"
              description="ERC-721 with TRANSFER_ROLE revoked from admin. Minting always works. Any user-to-user transfer reverts on-chain."
              panel={soulbound}
              isSoulbound={true}
              onDeploy={deploySoulbound}
              onMint={mintSoulbound}
              onTransfer={transferSoulbound}
            />

            <EditionPanel
              panel={edition}
              onDeploy={deployEdition}
              onMint={mintEdition}
              onTransfer={transferEdition}
            />
          </div>
        )}

        {/* Existing contract section */}
        {account && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-zinc-800" />
              <p className="text-xs text-zinc-600 uppercase tracking-wider shrink-0">
                Interact with existing contract
              </p>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>
            <ExistingContractSection />
          </>
        )}

      </div>
    </main>
  );
}
