"use client";

import { useState } from "react";
import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import { useRecovery } from "./useRecovery";
import { shorten } from "../multisig/config";

export default function RecoveryPage() {
  const {
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
  } = useRecovery();

  const [lostOwner, setLostOwner] = useState("");
  const [newOwner,  setNewOwner]  = useState("");

  return (
    <main className="min-h-[100vh] bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">← Home</Link>
            <h1 className="text-2xl font-bold mt-1">Social Recovery (Guardian)</h1>
            <p className="text-zinc-400 text-sm">
              検証項目⑥ — 鍵をなくしても復旧しやすい
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={fetchLoading}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm disabled:opacity-40"
          >
            {fetchLoading ? "…" : "↺ Refresh"}
          </button>
        </div>

        {/* ── Status messages ─────────────────────────────────────────────── */}
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm whitespace-pre-wrap">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-sm whitespace-pre-wrap">
            {success}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SECTION A: In-App Wallet Recovery
        ══════════════════════════════════════════════════════════════════ */}
        <section className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">A. In-App Wallet 復旧</h2>
            <p className="text-zinc-500 text-xs mt-0.5">ThirdWeb in-app wallet による認証再試行と複数認証の紐付け</p>
          </div>

          {/* Explanation card */}
          <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-4 space-y-3 text-sm">
            <p className="text-zinc-300 font-medium">① 認証の再試行 — 別デバイスから同じアカウントでログイン</p>
            <p className="text-zinc-400">
              ThirdWeb in-app wallet はユーザーの認証情報（Google アカウント ID / メールアドレス）に基づいて
              秘密鍵のシェアをサーバー側で保持します。<br />
              <span className="text-zinc-300">同じ Google アカウントでログインすれば、デバイスが変わっても常に同一のウォレットアドレスが復元されます。</span>
            </p>
            <div className="flex items-start gap-2 rounded-lg bg-blue-900/20 border border-blue-800/50 p-3">
              <span className="text-blue-400 text-base leading-none mt-0.5">ℹ</span>
              <p className="text-blue-300 text-xs">
                下の「Googleでログイン」ボタンで接続すると、現在のウォレットアドレスが表示されます。
                別のデバイスや別のブラウザから同じ Google アカウントでログインすると、
                <strong className="text-blue-200"> 同一のアドレスが表示される</strong>ことで復旧できることを確認できます。
              </p>
            </div>

            <p className="text-zinc-300 font-medium mt-2">② 複数認証の紐付け — Google + SMS OTP</p>
            <p className="text-zinc-400">
              ThirdWeb SDK の <code className="text-zinc-200 bg-zinc-800 px-1 rounded">linkProfile</code> API を使うと、
              Google ログインで作成したウォレットに SMS OTP（電話番号）を後から紐付けられます。
              紐付け後は Google または電話番号のどちらでログインしても、<span className="text-zinc-300">同じウォレットアドレスに復旧できます。</span>
            </p>
            <div className="rounded-lg bg-zinc-800 p-3 space-y-1">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">実装例</p>
              <pre className="text-xs text-zinc-300 overflow-x-auto">{`import { linkProfile } from "thirdweb/wallets";

// Google ログイン済みの状態で SMS OTP を紐付ける
await linkProfile(client, {
  strategy: "phone",
  phoneNumber: "+81 90-1234-5678",
  verificationCode: "123456",
});
// 以降は phone でも同じアドレスに復旧可能`}</pre>
            </div>
          </div>

          {/* Live demo: Google login shows address */}
          <div className="border border-zinc-700 rounded-lg p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">ライブ確認 — Google ログイン</p>
            {account ? (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-zinc-500">接続中のウォレットアドレス</p>
                    <p className="font-mono text-sm text-zinc-200 break-all">{account.address}</p>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded shrink-0 ml-4"
                  >
                    切断
                  </button>
                </div>
                {activeWallet?.id === "inApp" && (
                  <p className="text-xs text-emerald-400">
                    ✓ ThirdWeb in-app wallet (Google) — 別デバイスで同じ Google アカウントを使うとこのアドレスが復元されます
                  </p>
                )}
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
                <p className="text-xs text-zinc-500">Google アカウントでログインしてアドレスを確認</p>
              </div>
            )}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            SECTION B: Safe Social Recovery (Guardian)
        ══════════════════════════════════════════════════════════════════ */}
        <section className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">B. Safe ソーシャルリカバリー (Guardian)</h2>
            <p className="text-zinc-500 text-xs mt-0.5">Guardian の署名で紛失した Owner を新しい鍵に差し替え (swapOwner)</p>
          </div>

          {/* Architecture explanation */}
          <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-4 space-y-3 text-sm">
            <p className="text-zinc-300 font-medium">仕組み</p>
            <ol className="list-decimal list-inside space-y-1.5 text-zinc-400 text-xs">
              <li>
                <span className="text-zinc-200">Recovery Safe を作成</span> —
                オーナー: [Guardian（例: admin2）, admin1の鍵（紛失想定）]、閾値: <strong className="text-zinc-200">1</strong>
              </li>
              <li>
                <span className="text-zinc-200">鍵紛失を想定</span> —
                admin1 が鍵をなくしたと仮定し、新しい鍵アドレスを用意する
              </li>
              <li>
                <span className="text-zinc-200">Guardian が復旧を実行</span> —
                admin2 が <code className="bg-zinc-800 px-1 rounded">swapOwner(lostKey, newKey)</code> を単独で署名・実行
              </li>
              <li>
                <span className="text-zinc-200">Recovery Safe のオーナー更新</span> —
                紛失した鍵が新しい鍵に置き換えられ、復旧完了
              </li>
            </ol>
            <div className="flex items-start gap-2 rounded-lg bg-amber-900/20 border border-amber-800/50 p-3 mt-2">
              <span className="text-amber-400 text-base leading-none mt-0.5">⚠</span>
              <p className="text-amber-300 text-xs">
                このデモ用 Recovery Safe は<strong className="text-amber-200"> 閾値 1</strong> で作成します（Guardian 単独で実行可能）。
                本番環境では閾値を引き上げ、複数 Guardian の合意を必要とする設計を推奨します。
              </p>
            </div>
          </div>

          {/* Setup instructions */}
          {!isConfigured && (
            <div className="border border-amber-700/50 rounded-xl p-4 bg-amber-900/10 text-sm space-y-3">
              <p className="text-amber-400 font-medium">Recovery Safe の設定が必要です</p>
              <ol className="list-decimal list-inside space-y-2 text-zinc-300 text-sm">
                <li>
                  <a
                    href="https://app.safe.global/new-safe/create?chain=sep"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 underline"
                  >
                    app.safe.global (Sepolia)
                  </a>{" "}
                  で新しい Safe を作成
                </li>
                <li>
                  オーナーに <span className="text-zinc-200">Guardian のアドレス</span> と
                  <span className="text-zinc-200"> admin1 の「紛失想定」アドレス</span> を追加
                </li>
                <li>閾値を <strong className="text-zinc-200">1</strong> に設定（Guardian 単独実行）</li>
                <li>作成した Safe のアドレスを <code className="text-zinc-200">.env.local</code> に追記してサーバーを再起動</li>
              </ol>
              <pre className="text-xs bg-zinc-900 rounded p-3 text-zinc-300 overflow-x-auto">{`# .env.local
NEXT_PUBLIC_RECOVERY_SAFE_ADDRESS=0x…   # Recovery Safe address`}</pre>
            </div>
          )}

          {/* Recovery Safe info */}
          {isConfigured && safeInfo && (
            <div className="border border-zinc-700 rounded-lg p-4 space-y-2">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Recovery Safe — Sepolia</p>
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-400">Safe アドレス</span>
                <a
                  href={`https://app.safe.global/sep:${safeInfo.safeAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-blue-400 hover:underline"
                >
                  {shorten(safeInfo.safeAddress)}
                </a>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-400">閾値</span>
                <span className="text-xs text-zinc-300">
                  {safeInfo.threshold} / {safeInfo.owners.length}
                  {safeInfo.threshold === 1 && (
                    <span className="ml-1 text-emerald-400">(Guardian 単独実行可)</span>
                  )}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-zinc-400">オーナー (Guardians + 紛失想定キー)</p>
                {safeInfo.owners.map((o) => {
                  const isMe = account && o.toLowerCase() === account.address.toLowerCase();
                  return (
                    <div key={o} className="flex items-center justify-between">
                      <span className={`font-mono text-xs ${isMe ? "text-emerald-400" : "text-zinc-300"}`}>
                        {o}
                      </span>
                      {isMe && (
                        <span className="text-xs text-emerald-400 ml-2 shrink-0">← 接続中 (Guardian)</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Wallet connection for guardian */}
          <div className="border border-zinc-700 rounded-lg p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Guardian ウォレット接続</p>
            {account ? (
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-zinc-500">接続中</p>
                  <p className="font-mono text-sm text-zinc-200">{shorten(account.address)}</p>
                  {isConfigured && safeInfo && (
                    isGuardian
                      ? <p className="text-xs text-emerald-400 mt-0.5">✓ このウォレットは Recovery Safe のオーナー (Guardian) です</p>
                      : <p className="text-xs text-amber-400 mt-0.5">⚠ このウォレットは Recovery Safe のオーナーではありません</p>
                  )}
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded"
                >
                  切断
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <GoogleLogin
                    onSuccess={(res) => res.credential && handleGoogleLogin(res.credential)}
                    onError={() => {}}
                    theme="filled_black"
                    shape="rectangular"
                    size="medium"
                  />
                  <p className="text-xs text-zinc-500">ThirdWeb in-app wallet (ガス代スポンサー対応)</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleWalletConnect}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm text-zinc-200 transition-colors"
                  >
                    <span className="text-base">🔗</span>
                    WalletConnect
                  </button>
                  <p className="text-xs text-zinc-500">MetaMask など外部ウォレット</p>
                </div>
              </div>
            )}
          </div>

          {/* Recovery form */}
          {isConfigured && account && (
            <div className="border border-zinc-700 rounded-lg p-4 space-y-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">復旧の実行 — swapOwner</p>

              <div className="space-y-1">
                <label className="text-xs text-zinc-400">
                  紛失した鍵のアドレス <span className="text-red-400">*</span>
                  <span className="text-zinc-500 ml-1">(Recovery Safe の既存オーナーである必要があります)</span>
                </label>
                <input
                  type="text"
                  placeholder="0x… (admin1 の旧アドレス)"
                  value={lostOwner}
                  onChange={(e) => setLostOwner(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                {/* Quick-fill buttons from current Safe owners */}
                {safeInfo && safeInfo.owners.length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-1">
                    {safeInfo.owners
                      .filter((o) => !account || o.toLowerCase() !== account.address.toLowerCase())
                      .map((o) => (
                        <button
                          key={o}
                          onClick={() => setLostOwner(o)}
                          className="text-xs px-2 py-0.5 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 font-mono"
                        >
                          {shorten(o)}
                        </button>
                      ))}
                    <span className="text-xs text-zinc-600 self-center">← クリックで入力</span>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-zinc-400">
                  新しい鍵のアドレス <span className="text-red-400">*</span>
                  <span className="text-zinc-500 ml-1">(復旧先。既存オーナーとは異なるアドレス)</span>
                </label>
                <input
                  type="text"
                  placeholder="0x… (admin1 の新アドレス)"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* Execution summary */}
              {lostOwner && newOwner && (
                <div className="rounded-lg bg-zinc-800 p-3 text-xs space-y-1">
                  <p className="text-zinc-500 uppercase tracking-wider mb-2">実行内容</p>
                  <p className="text-zinc-400">
                    関数: <code className="text-zinc-200">swapOwner(prevOwner, lostKey, newKey)</code>
                  </p>
                  <p className="text-zinc-400">
                    対象 Safe: <span className="font-mono text-zinc-200">{safeInfo ? shorten(safeInfo.safeAddress) : "—"}</span>
                  </p>
                  <p className="text-zinc-400">
                    旧オーナー (紛失): <span className="font-mono text-red-400">{shorten(lostOwner)}</span>
                  </p>
                  <p className="text-zinc-400">
                    新オーナー (復旧先): <span className="font-mono text-emerald-400">{shorten(newOwner)}</span>
                  </p>
                  <p className="text-zinc-400">
                    署名者 (Guardian): <span className="font-mono text-zinc-200">{shorten(account.address)}</span>
                  </p>
                  {activeWallet?.id === "inApp" ? (
                    <p className="text-zinc-400">
                      ガス代: <span className="text-emerald-400">スポンサー (ERC-4337 Paymaster)</span>
                    </p>
                  ) : (
                    <p className="text-amber-400">
                      ガス代: Guardian の ETH 残高から支払い (WalletConnect)
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={() => handleRecover(lostOwner, newOwner)}
                disabled={
                  actionLoading ||
                  !lostOwner.startsWith("0x") ||
                  !newOwner.startsWith("0x") ||
                  lostOwner.toLowerCase() === newOwner.toLowerCase()
                }
                className="w-full py-2.5 px-4 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium transition-colors"
              >
                {actionLoading
                  ? "Recovery 実行中… (ブロック確認を待っています)"
                  : "🔑 Guardian として Recovery を実行 (swapOwner)"}
              </button>

              {!isGuardian && (
                <p className="text-xs text-amber-400 text-center">
                  ⚠ 接続中のウォレットが Recovery Safe のオーナーではないため、実行は失敗します
                </p>
              )}
            </div>
          )}

          {/* Post-recovery note */}
          {success && success.includes("Recovery") && (
            <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-4 text-sm space-y-2">
              <p className="text-zinc-300 font-medium">復旧後の確認事項</p>
              <ul className="list-disc list-inside text-zinc-400 text-xs space-y-1">
                <li>
                  <a
                    href={safeInfo ? `https://app.safe.global/sep:${safeInfo.safeAddress}` : "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 underline"
                  >
                    app.safe.global
                  </a>{" "}
                  で Recovery Safe のオーナーリストが更新されていることを確認
                </li>
                <li>新しい鍵でログインし、Recovery Safe のトランザクションに署名できることを確認</li>
                <li>本番では Recovery Safe を経由してメイン Safe の Admin も更新する</li>
              </ul>
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
