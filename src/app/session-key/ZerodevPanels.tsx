"use client";

import { useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import {
  useSessionKeyZerodev,
  type AssetGrant,
} from "./useSessionKeyZerodev";
import {
  BACKEND_URL,
  TOKEN_ASSETS,
  type TokenAsset,
  DEFAULT_AMOUNT_CAPS,
  RECIPIENT_ADDRESS,
  DELEGATE_ADDRESS,
  ZERODEV_OWNER_ADDR_KEY,
  ZERODEV_SERIALIZED_KEY,
} from "./config";

type Role = "owner" | "delegate" | "agent";

function shorten(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a
      href={`https://sepolia.etherscan.io/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="underline font-mono break-all"
    >
      {shorten(hash)}
    </a>
  );
}

function defaultGrants(): AssetGrant[] {
  return TOKEN_ASSETS.map((a) => ({
    symbol: a.symbol,
    enabled: a.kind === "native",
    capDisplay: DEFAULT_AMOUNT_CAPS[a.symbol] ?? "0",
    recipient: RECIPIENT_ADDRESS,
  }));
}

const JPYC = TOKEN_ASSETS.find((a) => a.symbol === "JPYC");

export default function ZerodevPanels() {
  const [role, setRole] = useState<Role>("owner");
  const {
    step,
    error,
    account,
    configured,
    ownerKernelAddress,
    serializedSessionKey,
    delegateKernelAddress,
    execTxHash,
    v1PrefundTxHash,
    v1ExecTxHash,
    isRegistered,
    agentFundTxHash,
    agentTxHash,
    remoteSignerAddress,
    handleOwnerConnect,
    handleGrantSessionKey,
    handleIssueAndRegister,
    handleDelegateConnect,
    executeTransfer,
    handlePrefundAndSudoExecute,
    handleAgentTransfer,
    fetchRemoteSignerAddress,
    handleDisconnect,
    handleReset,
  } = useSessionKeyZerodev();

  // ── Owner tab state ──────────────────────────────────────────────────────
  const [delegateAddrInput, setDelegateAddrInput] = useState<string>(DELEGATE_ADDRESS);
  const [grants, setGrants] = useState<AssetGrant[]>(defaultGrants);

  // ── Delegate tab state ───────────────────────────────────────────────────
  const [serializedInput, setSerializedInput] = useState<string>("");
  const [execAssetSymbol, setExecAssetSymbol] = useState<string>(TOKEN_ASSETS[0]?.symbol ?? "ETH");
  const [execRecipient, setExecRecipient] = useState<string>(RECIPIENT_ADDRESS);
  const [execAmount, setExecAmount] = useState<string>(DEFAULT_AMOUNT_CAPS[TOKEN_ASSETS[0]?.symbol ?? "ETH"] ?? "0");

  // ── V1 (Owner tab) state ─────────────────────────────────────────────────
  const [v1Asset, setV1Asset] = useState<string>(TOKEN_ASSETS[0]?.symbol ?? "ETH");
  const [v1Amount, setV1Amount] = useState<string>(DEFAULT_AMOUNT_CAPS[TOKEN_ASSETS[0]?.symbol ?? "ETH"] ?? "0");
  const [v1Recipient, setV1Recipient] = useState<string>(RECIPIENT_ADDRESS);

  // ── Agent (V2) tab state ─────────────────────────────────────────────────
  const [issueAmountCap, setIssueAmountCap] = useState<string>(DEFAULT_AMOUNT_CAPS["JPYC"] ?? "10000");
  const [recipientMode, setRecipientMode] = useState<"any" | "fixed">("fixed");
  const [issueRecipient, setIssueRecipient] = useState<string>(RECIPIENT_ADDRESS);
  const [agentTestAmount, setAgentTestAmount] = useState<string>("100");
  const [agentTestRecipient, setAgentTestRecipient] = useState<string>(RECIPIENT_ADDRESS);
  const [assetOwnerAddress, setAssetOwnerAddress] = useState<string | null>(null);

  const execAsset: TokenAsset = TOKEN_ASSETS.find((a) => a.symbol === execAssetSymbol) ?? TOKEN_ASSETS[0];
  const v1AssetObj: TokenAsset = TOKEN_ASSETS.find((a) => a.symbol === v1Asset) ?? TOKEN_ASSETS[0];

  useEffect(() => {
    if (role === "delegate" && typeof window !== "undefined") {
      const stored = localStorage.getItem(ZERODEV_SERIALIZED_KEY) ?? "";
      if (stored) setSerializedInput(stored);
    }
  }, [role]);

  // Fetch asset owner smart wallet address (A) when Phase 2 becomes visible
  useEffect(() => {
    if (!isRegistered || !ownerKernelAddress || assetOwnerAddress) return;
    fetch(`${BACKEND_URL}/asset-owner/address`)
      .then((r) => r.json())
      .then((d: { address?: string }) => { if (d.address) setAssetOwnerAddress(d.address); })
      .catch(() => {});
  }, [isRegistered, ownerKernelAddress, assetOwnerAddress]);

  const switchRole = (next: Role) => {
    handleDisconnect();
    setRole(next);
  };

  const isBusy =
    step === "connecting" ||
    step === "granting" ||
    step === "executing" ||
    step === "prefunding" ||
    step === "registering";

  const updateGrant = (sym: string, patch: Partial<AssetGrant>) =>
    setGrants((prev) => prev.map((g) => (g.symbol === sym ? { ...g, ...patch } : g)));

  // Phase 1 persists across wallet disconnect via localStorage
  const phase1Done = isRegistered && !!ownerKernelAddress;

  return (
    <div className="space-y-4">
      {!configured && (
        <div className="border border-amber-700/50 rounded-xl p-4 bg-amber-900/10 text-sm space-y-2">
          <p className="text-amber-400 font-medium">ZeroDev not configured</p>
          <pre className="text-xs text-zinc-400 bg-zinc-900 rounded p-3">{`NEXT_PUBLIC_ZERODEV_PROJECT_ID=...`}</pre>
        </div>
      )}

      {/* Role tabs */}
      <div className="flex gap-2">
        {(["owner", "delegate", "agent"] as const).map((r) => (
          <button
            key={r}
            onClick={() => switchRole(r)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              role === r
                ? r === "owner" ? "bg-blue-700 text-white"
                  : r === "delegate" ? "bg-orange-700 text-white"
                  : "bg-purple-700 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {r === "owner" ? "① Owner" : r === "delegate" ? "② Delegate" : "③ AI Agent SCW発行"}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* ── ① Owner ─────────────────────────────────────────────────────── */}
      {role === "owner" && (
        <div className="space-y-4">
          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Connect as Owner / 社員</p>

            {!account ? (
              <div className="flex items-center gap-3 flex-wrap">
                <GoogleLogin
                  onSuccess={(res) => res.credential && handleOwnerConnect(res.credential)}
                  onError={() => {}}
                  theme="filled_black" shape="rectangular" size="medium"
                />
                {step === "connecting" && <p className="text-xs text-zinc-400">Connecting…</p>}
              </div>
            ) : step !== "ready" && step !== "done" ? (
              <div className="space-y-3">
                <StatusDot color="blue" label="Connected" />
                <AddressCard eoaAddress={account.address} kernelAddress={ownerKernelAddress} />

                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500 uppercase tracking-wider">Delegate EOA</label>
                  <input type="text" placeholder="0x…" value={delegateAddrInput} onChange={(e) => setDelegateAddrInput(e.target.value)} disabled={isBusy} className="input-base" />
                </div>

                <GrantList grants={grants} disabled={isBusy} onChange={updateGrant} />

                <button
                  onClick={() => handleGrantSessionKey(delegateAddrInput.trim(), grants)}
                  disabled={!delegateAddrInput.trim() || isBusy || !grants.some((g) => g.enabled)}
                  className="btn-primary w-full"
                >
                  {step === "granting" ? "Building session key…" : "Build Session Key (off-chain)"}
                </button>
                <DisconnectBtn onClick={handleDisconnect} />
              </div>
            ) : (
              <div className="space-y-3">
                <StatusDot color="green" label="Session key built — share with delegate" />
                <AddressCard eoaAddress={account.address} kernelAddress={ownerKernelAddress} />
                <SerializedKeyBox value={serializedSessionKey ?? ""} />
                <DisconnectBtn onClick={handleDisconnect} />
              </div>
            )}
          </div>

          {/* Verification 1 */}
          {account && ownerKernelAddress && (
            <div className="border border-blue-900/40 rounded-xl p-5 bg-blue-950/10 space-y-4">
              <div>
                <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider">Verification 1 — 先行Tx + Execute</p>
                <p className="text-xs text-zinc-500 mt-1">EOA → Kernel SCW (先行Tx) → Recipient (UserOp)</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500 uppercase tracking-wider">Asset</label>
                <div className="flex gap-2 flex-wrap">
                  {TOKEN_ASSETS.map((a) => (
                    <button key={a.symbol} type="button" onClick={() => { setV1Asset(a.symbol); setV1Amount(DEFAULT_AMOUNT_CAPS[a.symbol] ?? "0"); }} disabled={isBusy} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${v1Asset === a.symbol ? "bg-blue-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>{a.symbol}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <LabelInput label={`Amount (${v1AssetObj.symbol})`} value={v1Amount} onChange={setV1Amount} disabled={isBusy} inputMode="decimal" />
                <LabelInput label="Recipient" value={v1Recipient} onChange={setV1Recipient} disabled={isBusy} placeholder="0x…" />
              </div>

              {(v1PrefundTxHash || v1ExecTxHash) && (
                <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 text-xs space-y-1.5">
                  {v1PrefundTxHash && <div className="flex justify-between gap-2"><span className="text-zinc-500">① 先行Tx</span><TxLink hash={v1PrefundTxHash} /></div>}
                  {v1ExecTxHash && <div className="flex justify-between gap-2 border-t border-zinc-800 pt-1.5"><span className="text-zinc-500">② Kernel UserOp</span><TxLink hash={v1ExecTxHash} /></div>}
                </div>
              )}

              <button
                onClick={() => handlePrefundAndSudoExecute(v1Recipient.trim(), v1AssetObj, v1Amount.trim())}
                disabled={!v1Recipient.trim() || !v1Amount.trim() || isBusy}
                className="btn-primary w-full bg-blue-700 hover:bg-blue-600"
              >
                {step === "prefunding" ? "① 先行Tx送信中…" : step === "executing" && !execTxHash ? "② UserOp送信中…" : v1ExecTxHash ? "Done ✓" : `Pre-fund + Execute ${v1Amount} ${v1AssetObj.symbol}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ② Delegate ──────────────────────────────────────────────────── */}
      {role === "delegate" && (
        <div className="space-y-4">
          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Step 1 — Paste session key from Owner</p>
            <textarea placeholder="Serialized session key…" value={serializedInput} onChange={(e) => setSerializedInput(e.target.value)} disabled={!!delegateKernelAddress} rows={3} className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono resize-none disabled:opacity-50" />
            <p className="text-xs text-zinc-500">Auto-filled if Owner built it in this browser.</p>
          </div>

          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Step 2 — Connect as Delegate</p>
            {delegateKernelAddress ? (
              <div className="space-y-2">
                <StatusDot color="green" label="Linked — Kernel client ready" />
                <AddressCard eoaAddress={account?.address ?? ""} kernelAddress={delegateKernelAddress} />
                <DisconnectBtn onClick={handleDisconnect} />
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <GoogleLogin onSuccess={(res) => res.credential && handleDelegateConnect(res.credential, serializedInput.trim())} onError={() => {}} theme="filled_black" shape="rectangular" size="medium" />
                {step === "connecting" && <p className="text-xs text-zinc-400">Connecting…</p>}
              </div>
            )}
          </div>

          {delegateKernelAddress && (
            <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Step 3 — Execute Transfer</p>
              <AssetSelector assets={TOKEN_ASSETS} value={execAssetSymbol} onChange={(s) => { setExecAssetSymbol(s); setExecAmount(DEFAULT_AMOUNT_CAPS[s] ?? "0"); }} disabled={isBusy || step === "done"} />
              <div className="grid grid-cols-2 gap-3">
                <LabelInput label="Recipient" value={execRecipient} onChange={setExecRecipient} disabled={isBusy || step === "done"} placeholder="0x…" />
                <LabelInput label={`Amount (${execAsset.symbol})`} value={execAmount} onChange={setExecAmount} disabled={isBusy || step === "done"} inputMode="decimal" />
              </div>
              {execTxHash && (
                <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-xs space-y-1">
                  <p className="font-medium">Transfer executed!</p>
                  <TxLink hash={execTxHash} />
                </div>
              )}
              <button
                onClick={() => executeTransfer(execRecipient.trim(), execAsset, execAmount.trim())}
                disabled={!execRecipient.trim() || !execAmount.trim() || isBusy || step === "done"}
                className="btn-primary w-full bg-orange-700 hover:bg-orange-600"
              >
                {step === "executing" ? "Executing…" : step === "done" ? "Done ✓" : `Send ${execAmount} ${execAsset.symbol}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ③ AI Agent SCW発行 ─────────────────────────────────────────── */}
      {role === "agent" && (
        <div className="space-y-4">

          {/* Header */}
          <div className="border border-purple-900/40 rounded-xl p-4 bg-purple-950/10 text-xs text-zinc-400 space-y-1">
            <p className="text-purple-300 font-semibold text-sm">Verification 2 — ZeroDev SCW 発行 + AI Agent 自動送金</p>
            <p>AI Agent (Remote Signer) に JPYC 送金権限を委任する SCW を発行する。</p>
          </div>

          {/* ── PHASE 1: 設定・発行 ──────────────────────────────────────── */}
          <PhaseCard
            phase={1}
            title="設定・発行"
            subtitle="接続 → 条件設定 → SCW 発行 & バックエンド登録 → 切断"
            done={phase1Done}
            color="purple"
          >
            {phase1Done && ownerKernelAddress ? (
              /* Completion state — shown even after wallet disconnect */
              <div className="space-y-3">
                <StatusDot color="green" label="SCW 発行・登録完了（ウォレット切断済み可）" />
                <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 text-xs space-y-1.5">
                  <Row label="Kernel SCW (B)" value={ownerKernelAddress} mono />
                  <Row label="JPYC 上限" value={`${issueAmountCap} JPYC`} />
                  <Row label="送金先 (C)" value={recipientMode === "any" ? "制限なし" : issueRecipient} mono={recipientMode === "fixed"} />
                  <Row label="Delegate (D)" value="Remote Signer (backend)" />
                </div>
                <div className="flex gap-2">
                  {account && <DisconnectBtn onClick={handleDisconnect} />}
                  <button onClick={handleReset} className="text-xs border border-red-900 text-red-500 hover:text-red-300 px-3 py-1 rounded">
                    Reset
                  </button>
                </div>
              </div>
            ) : !account ? (
              /* Not connected yet */
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">Google アカウントで接続してください。</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <GoogleLogin onSuccess={(res) => res.credential && handleOwnerConnect(res.credential)} onError={() => {}} theme="filled_black" shape="rectangular" size="medium" />
                  {step === "connecting" && <p className="text-xs text-zinc-400">Connecting…</p>}
                </div>
              </div>
            ) : (
              /* Connected — show issue form */
              <div className="space-y-4">
                <AddressCard eoaAddress={account.address} kernelAddress={ownerKernelAddress} />

                {!JPYC && (
                  <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700 text-amber-400 text-xs">
                    JPYC が未設定です。<code>.env.local</code> に <code>NEXT_PUBLIC_SESSION_KEY_JPYC_ADDRESS</code> を追加してください。
                  </div>
                )}

                {JPYC && (
                  <>
                    {/* Remote Signer address */}
                    <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs text-zinc-400 font-medium">Remote Signer D (Delegate EOA)</p>
                          <p className="text-xs text-zinc-600 mt-0.5"><code>REMOTE_SIGNER_PRIVATE_KEY</code> から導出されたアドレスが Session Key のデリゲートになる。</p>
                        </div>
                        {!remoteSignerAddress && (
                          <button onClick={fetchRemoteSignerAddress} disabled={isBusy} className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-800 hover:bg-purple-700 text-white text-xs font-medium transition-colors disabled:opacity-50">取得</button>
                        )}
                      </div>
                      {remoteSignerAddress ? (
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                          <span className="font-mono text-purple-300 text-xs break-all">{remoteSignerAddress}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-600 italic">未取得 — 「取得」ボタンで backend から読み込む</p>
                      )}
                    </div>

                    {remoteSignerAddress && (
                      <div className="space-y-4">
                        {/* Amount cap */}
                        <div className="space-y-1.5">
                          <label className="text-xs text-zinc-400 font-medium">送金限度額 (JPYC)</label>
                          <p className="text-xs text-zinc-600">CallPolicy で on-chain 強制される 1 回あたりの上限額。</p>
                          <div className="flex items-center gap-2">
                            <input type="text" inputMode="decimal" value={issueAmountCap} onChange={(e) => setIssueAmountCap(e.target.value)} disabled={isBusy} className="w-40 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono focus:outline-none focus:border-purple-500 disabled:opacity-50" />
                            <span className="text-sm text-zinc-400">JPYC</span>
                          </div>
                        </div>

                        {/* Recipient condition */}
                        <div className="space-y-2">
                          <label className="text-xs text-zinc-400 font-medium">送金先アドレス条件 (C)</label>
                          <p className="text-xs text-zinc-600">固定の場合は ParamCondition.EQUAL で on-chain 強制。</p>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" checked={recipientMode === "any"} onChange={() => setRecipientMode("any")} disabled={isBusy} className="accent-purple-500" />
                              <span className="text-sm text-zinc-300">制限なし</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" checked={recipientMode === "fixed"} onChange={() => setRecipientMode("fixed")} disabled={isBusy} className="accent-purple-500" />
                              <span className="text-sm text-zinc-300">固定アドレス</span>
                            </label>
                            {recipientMode === "fixed" && (
                              <input type="text" placeholder="0x… 送金先アドレス" value={issueRecipient} onChange={(e) => setIssueRecipient(e.target.value)} disabled={isBusy} className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-purple-500 disabled:opacity-50" />
                            )}
                          </div>
                        </div>

                        {/* Summary */}
                        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-xs space-y-1 text-zinc-400">
                          <p className="text-zinc-300 font-medium mb-1">発行する Session Key の条件</p>
                          <p>・Token: <span className="text-purple-300">JPYC</span> ({shorten(JPYC.address ?? "")})</p>
                          <p>・Operation: <span className="text-purple-300">transfer(C, amount)</span> (Kernel が自身の残高から送金)</p>
                          <p>・Delegate (D): <span className="font-mono text-purple-300 break-all">{remoteSignerAddress}</span></p>
                          <p>・Amount cap: <span className="text-purple-300">{issueAmountCap} JPYC</span></p>
                          <p>・Recipient (C): <span className="text-purple-300">{recipientMode === "any" ? "制限なし" : (issueRecipient || "未入力")}</span></p>
                        </div>

                        <button
                          onClick={() => handleIssueAndRegister(issueAmountCap, recipientMode === "fixed" ? issueRecipient.trim() : undefined)}
                          disabled={isBusy || !issueAmountCap || (recipientMode === "fixed" && !issueRecipient.trim())}
                          className="w-full py-3 px-4 rounded-xl bg-purple-700 hover:bg-purple-600 text-white font-semibold transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
                        >
                          {step === "granting" ? "SCW 発行中…" : step === "registering" ? "登録中…" : "SCW 発行 & バックエンド登録"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </PhaseCard>

          {/* ── PHASE 2: AI Agent 実行 ───────────────────────────────────── */}
          {phase1Done && ownerKernelAddress && JPYC?.address && (
            <PhaseCard
              phase={2}
              title="AI Agent 実行"
              subtitle="POST /agent/execute — バックエンドが A→B (資金調達) → B→C (送金) を実行"
              done={!!agentTxHash}
              color="purple"
            >
              <div className="space-y-3">
                <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 text-xs space-y-1 text-zinc-400">
                  <p className="text-zinc-300 font-medium mb-1">実行フロー</p>
                  <p>① <span className="text-blue-300">A → B</span>: Asset Owner Smart Wallet が Kernel へ JPYC を送金</p>
                  <p>② <span className="text-green-300">B → C</span>: Remote Signer (D) が Session Key で <code>transfer(C, amount)</code> を実行</p>
                  <div className="border-t border-zinc-800 pt-1.5 mt-1 space-y-1">
                    <Row label="Asset Owner SCW (A)" value={assetOwnerAddress ?? "取得中…"} mono />
                    <Row label="Kernel SCW (B)" value={ownerKernelAddress} mono />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={agentTestAmount}
                      onChange={(e) => setAgentTestAmount(e.target.value)}
                      disabled={isBusy}
                      className="w-32 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono focus:outline-none focus:border-purple-500 disabled:opacity-50"
                    />
                    <span className="text-sm text-zinc-400">JPYC</span>
                  </div>
                  <span className="text-xs text-zinc-600">上限 {issueAmountCap} JPYC</span>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">送金先 (C)</label>
                  <input
                    type="text"
                    placeholder="0x…"
                    value={recipientMode === "fixed" ? issueRecipient : agentTestRecipient}
                    onChange={(e) => setAgentTestRecipient(e.target.value)}
                    disabled={isBusy || recipientMode === "fixed"}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                  {recipientMode === "fixed" && (
                    <p className="text-xs text-zinc-600">Session Key の固定先 ({shorten(issueRecipient)}) に自動設定</p>
                  )}
                </div>

                {agentFundTxHash && (
                  <div className="p-3 rounded-lg bg-blue-900/20 border border-blue-800 text-blue-400 text-xs space-y-1">
                    <p className="font-medium">① A→B 資金調達完了</p>
                    <TxLink hash={agentFundTxHash} />
                  </div>
                )}
                {agentTxHash && (
                  <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-xs space-y-1">
                    <p className="font-medium">② B→C 送金完了 ✓</p>
                    <TxLink hash={agentTxHash} />
                  </div>
                )}

                <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-xs text-zinc-500 space-y-1">
                  <p className="text-zinc-400 font-medium">POST /agent/execute</p>
                  <pre className="text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify({
                    kernelAddress: ownerKernelAddress,
                    recipient: recipientMode === "fixed" ? issueRecipient : agentTestRecipient,
                    tokenAddress: JPYC.address,
                    amount: agentTestAmount,
                    decimals: JPYC.decimals,
                  }, null, 2)}</pre>
                </div>

                <button
                  onClick={() => handleAgentTransfer(
                    (recipientMode === "fixed" ? issueRecipient : agentTestRecipient).trim(),
                    JPYC.address!,
                    agentTestAmount.trim(),
                    JPYC.decimals,
                  )}
                  disabled={isBusy || !agentTestAmount.trim() || !(recipientMode === "fixed" ? issueRecipient : agentTestRecipient).trim()}
                  className="w-full py-3 px-4 rounded-xl bg-purple-700 hover:bg-purple-600 text-white font-semibold transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
                >
                  {isBusy ? "AI Agent 実行中…" : agentTxHash ? "再実行" : "AI Agent 実行"}
                </button>
              </div>
            </PhaseCard>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhaseCard({
  phase, title, subtitle, done, color = "zinc", children,
}: {
  phase: number;
  title: string;
  subtitle: string;
  done: boolean;
  color?: "purple" | "zinc";
  children: React.ReactNode;
}) {
  const accent = color === "purple" ? "border-purple-900/50 bg-purple-950/10" : "border-zinc-800 bg-zinc-900/30";
  const badgeDone = done ? "bg-green-800 text-green-200" : color === "purple" ? "bg-purple-900 text-purple-300" : "bg-zinc-700 text-zinc-300";
  return (
    <div className={`border rounded-xl p-5 space-y-4 ${accent}`}>
      <div className="flex items-start gap-3">
        <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${badgeDone}`}>
          {done ? "✓" : `Phase ${phase}`}
        </span>
        <div>
          <p className="text-sm font-semibold text-zinc-200">{title}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function AddressCard({ eoaAddress, smartAccountAddress, kernelAddress }: { eoaAddress: string; smartAccountAddress?: string | null; kernelAddress?: string | null }) {
  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
      <Row label="EOA" value={eoaAddress || "—"} mono />
      {smartAccountAddress && <Row label="TW Smart Account" value={smartAccountAddress} mono className="border-t border-zinc-800 pt-1.5" />}
      {kernelAddress && <Row label="Kernel SCW" value={kernelAddress} mono className="border-t border-zinc-800 pt-1.5" />}
    </div>
  );
}

function Row({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className={`flex justify-between items-start gap-2 ${className ?? ""}`}>
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span className={`break-all text-right ${mono ? "font-mono text-zinc-200" : "text-zinc-300"}`}>{value}</span>
    </div>
  );
}

function SerializedKeyBox({ value }: { value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">Serialized session key</p>
      <textarea readOnly value={value} rows={4} className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-mono resize-none break-all" />
      <button onClick={() => navigator.clipboard.writeText(value)} className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded">Copy</button>
    </div>
  );
}

function GrantList({ grants, disabled, onChange }: { grants: AssetGrant[]; disabled: boolean; onChange: (sym: string, patch: Partial<AssetGrant>) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">Asset grants</p>
      {grants.map((g) => {
        const asset = TOKEN_ASSETS.find((a) => a.symbol === g.symbol);
        if (!asset) return null;
        return (
          <div key={g.symbol} className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={g.enabled} onChange={(e) => onChange(g.symbol, { enabled: e.target.checked })} disabled={disabled} className="accent-blue-600" />
              <span className="text-sm font-medium">{asset.symbol}</span>
              <span className="text-xs text-zinc-500">({asset.kind === "native" ? "native" : "ERC-20"})</span>
            </label>
            {g.enabled && (
              <div className="grid grid-cols-2 gap-2">
                <LabelInput label={`Cap (${asset.symbol})`} value={g.capDisplay} onChange={(v) => onChange(g.symbol, { capDisplay: v })} disabled={disabled} inputMode="decimal" />
                <LabelInput label={asset.kind === "native" ? "Recipient (req)" : "Recipient (opt)"} value={g.recipient ?? ""} onChange={(v) => onChange(g.symbol, { recipient: v })} disabled={disabled} placeholder="0x…" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AssetSelector({ assets, value, onChange, disabled }: { assets: TokenAsset[]; value: string; onChange: (s: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-500 uppercase tracking-wider">Asset</label>
      <div className="flex gap-2 flex-wrap">
        {assets.map((a) => (
          <button key={a.symbol} type="button" onClick={() => onChange(a.symbol)} disabled={disabled} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${value === a.symbol ? "bg-orange-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>{a.symbol}</button>
        ))}
      </div>
    </div>
  );
}

function LabelInput({ label, value, onChange, disabled, placeholder, inputMode }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder?: string; inputMode?: "decimal" | "text" }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-500">{label}</label>
      <input type="text" inputMode={inputMode ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono placeholder-zinc-600 focus:outline-none disabled:opacity-50" />
    </div>
  );
}

function StatusDot({ color, label }: { color: "green" | "blue" | "purple"; label: string }) {
  const cls = color === "green" ? "bg-green-400 text-green-400" : color === "blue" ? "bg-blue-400 text-blue-400" : "bg-purple-400 text-purple-400";
  return (
    <div className={`flex items-center gap-2 text-xs ${cls.split(" ")[1]}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${cls.split(" ")[0]}`} />
      {label}
    </div>
  );
}

function DisconnectBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded">Disconnect</button>;
}

// ── Tailwind shorthand aliases (defined in globals via @apply if preferred) ──
// These are inlined here to avoid needing a custom plugin.
declare module "react" {
  interface HTMLAttributes<T> {
    className?: string;
  }
}

// Suppress unused import
void ZERODEV_OWNER_ADDR_KEY;
