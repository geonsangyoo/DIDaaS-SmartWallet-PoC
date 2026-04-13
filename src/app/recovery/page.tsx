"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import { useRecovery } from "./useRecovery";
import { shorten, OWNER_ADDRESSES, ROLE_CONFIG } from "../multisig/config";

// ── Scenario constants ────────────────────────────────────────────────────────
// Lost account : Employee   — NEXT_PUBLIC_EMPLOYEE_ADDRESS (Smart Account)
// Guardian     : 経理担当   — NEXT_PUBLIC_ADMIN2_ADDRESS = 0x5c97D36ae2705e6011008A9ABC059AD5d46fA5BC
//
// For Panel ② Recovery, the guardian must connect with plain inAppWallet (no ERC-4337)
// so that account.address = EOA and signTypedData = raw ECDSA.
// This address is registered as Admin on the employee's Smart Account via addAdmin().
const SCENARIO_LOST_KEY     = OWNER_ADDRESSES.employee;
const SCENARIO_GUARDIAN_EOA = "0x4e2E9ce70772e36e635A7CAe8fc1323EF7DAa587"; // 経理担当 EOA

export default function RecoveryPage() {
  const {
    smartAccount,
    balance,
    fetchLoading,
    actionLoading,
    error,
    success,
    profiles,
    otpSent,
    linkLoading,
    linkError,
    linkSuccess,
    account,
    activeWallet,
    fetchAdmins,
    handleGoogleLogin,
    handleGuardianGoogleLogin,
    handleWalletConnect,
    handleDisconnect,
    handleAddGuardian,
    handleRecover,
    handleSendFromEmployeeWallet,
    sendLoading,
    sendError,
    sendSuccess,
    isAdminOf,
    handleFetchProfiles,
    handleSendOtp,
    handleLinkPhone,
    handleUnlinkProfile,
    setOtpSent,
  } = useRecovery();

  // ── Section A: phone linking state ────────────────────────────────────────
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode,     setOtpCode]     = useState("");

  // ── Panel ①: Setup state ───────────────────────────────────────────────────
  // Pre-fill Guardian address with admin2 (Guardian in this scenario)
  const [guardianInput, setGuardianInput] = useState(SCENARIO_GUARDIAN_EOA);

  // ── Panel ②: Recovery state ────────────────────────────────────────────────
  const [targetAccount, setTargetAccount] = useState("");
  // Pre-fill lost key with employee's EOA — this is the initial Admin of the
  // employee's Smart Account (the EOA that signed all addAdmin calls).
  const [lostKey, setLostKey] = useState(SCENARIO_LOST_KEY);
  const [newKey,  setNewKey]  = useState("");

  // ── Panel ③: Send ETH state ────────────────────────────────────────────────
  const [sendTo,     setSendTo]     = useState(OWNER_ADDRESSES.admin2);
  const [sendAmount, setSendAmount] = useState("0.001");

  // Auto-fetch smart account details whenever an admin logs in
  useEffect(() => {
    if (account && SCENARIO_LOST_KEY) fetchAdmins(SCENARIO_LOST_KEY);
  }, [account, fetchAdmins]);

  return (
    <main className="min-h-[100vh] bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div>
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">← Home</Link>
          <h1 className="text-2xl font-bold mt-1">Social Recovery (Guardian)</h1>
          <p className="text-zinc-400 text-sm">検証項目⑥ — 鍵をなくしても復旧しやすい</p>
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

          {/* Section A status */}
          {linkError && (
            <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm">
              {linkError}
            </div>
          )}
          {linkSuccess && (
            <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-sm whitespace-pre-wrap">
              {linkSuccess}
            </div>
          )}

          {/* ── A-① Google login / address verification ───────────────────── */}
          <div className="border border-zinc-700 rounded-lg p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              ① 認証の再試行 — Google ログイン後にアドレスを確認
            </p>
            <p className="text-zinc-400 text-xs">
              ThirdWeb in-app wallet は MPC でキーシェアをサーバー側に保持するため、
              <span className="text-zinc-300"> 同じ Google アカウントであればデバイスが変わっても同一アドレスが復元されます。</span>
            </p>

            {account ? (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-zinc-500">
                      接続中 {activeWallet?.id === "inApp" ? "(ThirdWeb in-app / ERC-4337)" : "(外部ウォレット)"}
                    </p>
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
                    ✓ 別デバイスで同じ Google アカウントでログインするとこのアドレスが復元されます
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

          {/* ── A-② linkProfile — phone number linking ────────────────────── */}
          <div className="border border-zinc-700 rounded-lg p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              ② 複数認証の紐付け — 電話番号 (SMS OTP) を Google ウォレットに紐付け
            </p>
            <p className="text-zinc-400 text-xs">
              Google でログイン済みのウォレットに電話番号を紐付けます。
              紐付け後は SMS OTP でログインしても
              <span className="text-zinc-300"> 常に同じウォレットアドレスに復旧できます。</span>
            </p>

            {!account ? (
              <p className="text-xs text-zinc-500 italic">① で Google ログインしてから操作してください</p>
            ) : activeWallet?.id !== "inApp" ? (
              <p className="text-xs text-amber-400">⚠ linkProfile は ThirdWeb in-app wallet (Google ログイン) のみ対応しています</p>
            ) : (
              <div className="space-y-3">
                {/* Phone input */}
                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">電話番号</label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      placeholder="+81 90-1234-5678"
                      value={phoneNumber}
                      onChange={(e) => {
                        const v = e.target.value;
                        // Auto-prepend + if user starts typing digits directly
                        setPhoneNumber(v && !v.startsWith("+") ? `+${v}` : v);
                      }}
                      disabled={otpSent}
                      className={`flex-1 px-3 py-2 rounded-lg bg-zinc-800 border text-zinc-200 text-sm placeholder-zinc-600 focus:outline-none disabled:opacity-50 ${
                        phoneNumber && !phoneNumber.startsWith("+")
                          ? "border-red-600 focus:border-red-500"
                          : "border-zinc-700 focus:border-zinc-500"
                      }`}
                    />
                    {otpSent ? (
                      <button
                        onClick={() => { setOtpSent(false); setOtpCode(""); }}
                        className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs shrink-0"
                      >
                        変更
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSendOtp(phoneNumber)}
                        disabled={linkLoading || !phoneNumber || !phoneNumber.startsWith("+")}
                        className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 text-sm transition-colors shrink-0"
                      >
                        {linkLoading ? "送信中…" : "OTP 送信"}
                      </button>
                    )}
                  </div>
                  {phoneNumber && !phoneNumber.startsWith("+") && (
                    <p className="text-xs text-red-400">
                      国番号付きの形式で入力してください（例: <span className="font-mono">+81 90-1234-5678</span>）
                    </p>
                  )}
                </div>

                {/* OTP input — shown after send */}
                {otpSent && (
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">確認コード (OTP)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="123456"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                      <button
                        onClick={() => handleLinkPhone(phoneNumber, otpCode)}
                        disabled={linkLoading || !otpCode}
                        className="px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm transition-colors shrink-0"
                      >
                        {linkLoading ? "紐付け中…" : "電話番号を紐付け"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── A-③ Linked profiles list ──────────────────────────────────── */}
          <div className="border border-zinc-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">③ 紐付け済みプロフィール一覧</p>
              {account && activeWallet?.id === "inApp" && (
                <button
                  onClick={handleFetchProfiles}
                  disabled={linkLoading}
                  className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-2 py-1 rounded transition-colors"
                >
                  {linkLoading ? "…" : "↺ 更新"}
                </button>
              )}
            </div>

            {!account ? (
              <p className="text-xs text-zinc-500 italic">Google ログイン後に確認できます</p>
            ) : profiles.length === 0 ? (
              <p className="text-xs text-zinc-500">
                {activeWallet?.id === "inApp"
                  ? "「↺ 更新」を押してプロフィールを取得してください"
                  : "in-app wallet でのみ確認できます"}
              </p>
            ) : (
              <ul className="space-y-2">
                {profiles.map((p, i) => {
                  const detail =
                    "email"       in p.details ? p.details.email :
                    "phone"       in p.details ? p.details.phone :
                    "address"     in p.details ? p.details.address :
                    p.type;
                  return (
                    <li key={i} className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2 text-xs">
                      <div>
                        <span className="text-zinc-400 capitalize">{p.type}</span>
                        <span className="text-zinc-300 ml-2 font-mono">{String(detail)}</span>
                      </div>
                      {profiles.length > 1 && (
                        <button
                          onClick={() => handleUnlinkProfile(p)}
                          disabled={linkLoading}
                          className="text-red-400 hover:text-red-300 disabled:opacity-40 ml-3 shrink-0"
                          title="このプロフィールを削除"
                        >
                          削除
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="text-xs text-zinc-600">
              複数プロフィールが表示された場合、どのログイン方法でも同じウォレットアドレスに復旧できます。
            </p>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            SECTION B: ThirdWeb Smart Account Social Recovery (Guardian)
        ══════════════════════════════════════════════════════════════════ */}
        <section className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-5">
          <div>
            <h2 className="text-lg font-semibold">B. Smart Account ソーシャルリカバリー (Guardian)</h2>
            <p className="text-zinc-500 text-xs mt-0.5">
              ThirdWeb ERC-4337 — <code>addAdmin</code> / <code>removeAdmin</code> で Guardian が単独で鍵を差し替え
            </p>
          </div>

          {/* ── Scenario card ──────────────────────────────────────────────── */}
          <div className="rounded-lg bg-zinc-900 border border-amber-700/40 p-4 space-y-3">
            <p className="text-amber-400 font-medium text-sm">シナリオ: 社員が Google アカウントを紛失 → 上長が復旧</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-zinc-800 p-3 space-y-2">
                <p className="text-red-400 font-medium">鍵を紛失した人</p>
                <p className="text-zinc-400">
                  {ROLE_CONFIG.employee.step} 社員 ({ROLE_CONFIG.employee.label})
                </p>
                <p className="font-mono text-zinc-300 break-all text-xs">
                  {SCENARIO_LOST_KEY || <span className="text-zinc-600 italic">env 未設定</span>}
                </p>
                <p className="text-zinc-500 text-xs">
                  ← この EOA アドレスが Smart Account の初期 Admin として登録されている
                </p>
              </div>
              <div className="rounded-lg bg-zinc-800 p-3 space-y-2">
                <p className="text-emerald-400 font-medium">Guardian (復旧を実行する人)</p>
                <p className="text-zinc-400">
                  {ROLE_CONFIG.admin2.step} {ROLE_CONFIG.admin2.labelJa} ({ROLE_CONFIG.admin2.label})
                </p>
                <p className="font-mono text-zinc-300 break-all text-xs">
                  {SCENARIO_GUARDIAN_EOA || <span className="text-zinc-600 italic">env 未設定</span>}
                </p>
                <p className="text-zinc-500 text-xs">
                  ← 事前に社員の Smart Account に Guardian として登録済み
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-blue-900/20 border border-blue-800/50 p-3 text-xs">
              <span className="text-blue-400 mt-0.5">ℹ</span>
              <p className="text-blue-300">
                Guardian は <code>SignerPermissionRequest</code> (EIP-712) に署名するだけで復旧を実行できます。
                <strong className="text-blue-200"> 紛失した鍵の署名・秘密鍵は一切不要です。</strong>
                Gnosis Safe も別コントラクトも不要 — ThirdWeb のみで完結します。
              </p>
            </div>
          </div>

          {/* ── Smart Account Details card (auto-loaded on login) ──────────── */}
          {SCENARIO_LOST_KEY && (
            <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-400 font-medium uppercase tracking-wider">
                  社員 Smart Account 詳細
                </p>
                <button
                  onClick={() => fetchAdmins(SCENARIO_LOST_KEY)}
                  disabled={fetchLoading}
                  className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-2 py-1 rounded transition-colors disabled:opacity-40"
                >
                  {fetchLoading ? "…" : "↺ 更新"}
                </button>
              </div>

              {/* Address + Etherscan */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-zinc-500 shrink-0">アドレス</span>
                <a
                  href={`https://sepolia.etherscan.io/address/${SCENARIO_LOST_KEY}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-blue-400 hover:underline break-all text-right"
                >
                  {SCENARIO_LOST_KEY}
                </a>
              </div>

              {/* ETH Balance */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">ETH 残高 (Sepolia)</span>
                {balance !== null ? (
                  <span className="font-mono text-zinc-200">{balance} ETH</span>
                ) : (
                  <span className="text-zinc-600 italic">
                    {account ? "取得中…" : "ログイン後に表示"}
                  </span>
                )}
              </div>

              {/* Deployment status */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">デプロイ状態</span>
                {smartAccount?.address.toLowerCase() === SCENARIO_LOST_KEY.toLowerCase() ? (
                  smartAccount.isDeployed ? (
                    <span className="text-emerald-400">デプロイ済み ✓</span>
                  ) : (
                    <span className="text-amber-400">未デプロイ (初回 TX 後に作成)</span>
                  )
                ) : (
                  <span className="text-zinc-600 italic">{account ? "確認中…" : "ログイン後に表示"}</span>
                )}
              </div>

              {/* Admin list */}
              {smartAccount?.address.toLowerCase() === SCENARIO_LOST_KEY.toLowerCase() &&
                smartAccount.isDeployed && (
                  <div className="space-y-1.5 border-t border-zinc-800 pt-3">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider">Admin 一覧 ({smartAccount.admins.length})</p>
                    {smartAccount.admins.map((a) => {
                      const isGuardian = SCENARIO_GUARDIAN_EOA && a.toLowerCase() === SCENARIO_GUARDIAN_EOA.toLowerCase();
                      const isEmployee = SCENARIO_LOST_KEY && a.toLowerCase() === SCENARIO_LOST_KEY.toLowerCase();
                      const isNew      = a.toLowerCase() === "0xd00a23e1e3afe771de86d7e29be790c0f91b01bd";
                      return (
                        <div key={a} className="flex items-center justify-between text-xs gap-2">
                          <span className={`font-mono break-all ${
                            isGuardian ? "text-emerald-400" :
                            isEmployee ? "text-blue-400"   :
                            isNew      ? "text-purple-400" :
                            "text-zinc-300"
                          }`}>
                            {a}
                          </span>
                          <span className="shrink-0 text-zinc-500">
                            {isGuardian && "← Guardian (上長)"}
                            {isEmployee && "← 社員 (初期 Admin)"}
                            {isNew      && "← 新しい鍵"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
          )}

          {/* ── Architecture ───────────────────────────────────────────────── */}
          <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-4 space-y-2 text-xs">
            <p className="text-zinc-400 font-medium mb-3">フロー</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg bg-zinc-800 p-3 space-y-1.5">
                <p className="text-emerald-400 font-medium">① Guardian 設定 (社員の操作・事前)</p>
                <ol className="list-decimal list-inside text-zinc-400 space-y-1">
                  <li>社員が Google ログイン → Smart Account を取得</li>
                  <li>Smart Account アドレスを Guardian (上長) に共有</li>
                  <li><code className="bg-zinc-900 px-1 rounded">addAdmin(上長アドレス)</code> を実行</li>
                  <li>上長が Admin ロールを取得 → Guardian として登録完了</li>
                </ol>
              </div>
              <div className="rounded-lg bg-zinc-800 p-3 space-y-1.5">
                <p className="text-amber-400 font-medium">② Recovery 実行 (上長の操作・紛失後)</p>
                <ol className="list-decimal list-inside text-zinc-400 space-y-1">
                  <li>上長 (Guardian) が接続 <span className="text-zinc-500">(社員の鍵は不要)</span></li>
                  <li>社員の Smart Account アドレスを入力</li>
                  <li><code className="bg-zinc-900 px-1 rounded">addAdmin(社員の新しい鍵)</code></li>
                  <li><code className="bg-zinc-900 px-1 rounded">removeAdmin(社員の旧い鍵)</code></li>
                </ol>
              </div>
            </div>
          </div>

          {/* ── Wallet connection ──────────────────────────────────────────── */}
          <div className="border border-zinc-700 rounded-lg p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">ウォレット接続</p>
            {account ? (
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-zinc-500">
                    接続中{" "}
                    {activeWallet?.id === "inApp"
                      ? "(ThirdWeb in-app / ERC-4337 · ガス代スポンサー)"
                      : "(外部ウォレット)"}
                  </p>
                  <p className="font-mono text-sm text-zinc-200 break-all">{account.address}</p>
                  {/* Show role badge if address matches a known actor */}
                  {SCENARIO_GUARDIAN_EOA && account.address.toLowerCase() === SCENARIO_GUARDIAN_EOA.toLowerCase() && (
                    <p className="text-xs text-emerald-400 mt-0.5">
                      ✓ Guardian ({ROLE_CONFIG.admin2.step} {ROLE_CONFIG.admin2.labelJa}) として接続中
                    </p>
                  )}
                  {SCENARIO_LOST_KEY && account.address.toLowerCase() === SCENARIO_LOST_KEY.toLowerCase() && (
                    <p className="text-xs text-blue-400 mt-0.5">
                      → {ROLE_CONFIG.employee.step} 社員として接続中 — ① Guardian 設定を行ってください
                    </p>
                  )}
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded shrink-0 ml-4"
                >
                  切断
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* ① Employee — ERC-4337 Smart Account */}
                <div className="rounded-lg bg-zinc-900 border border-emerald-800/40 p-3 space-y-2">
                  <p className="text-xs text-emerald-400 font-medium">
                    ① Guardian 設定用 — 社員 (アカウントオーナー)
                  </p>
                  <p className="text-xs text-zinc-500">
                    ERC-4337 Smart Account モード。<code className="bg-zinc-800 px-1 rounded">account.address</code> = Smart Account アドレス
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <GoogleLogin
                      onSuccess={(res) => res.credential && handleGoogleLogin(res.credential)}
                      onError={() => {}}
                      theme="filled_black"
                      shape="rectangular"
                      size="medium"
                    />
                  </div>
                </div>

                {/* ② Guardian — plain EOA (no ERC-4337) */}
                <div className="rounded-lg bg-zinc-900 border border-amber-800/40 p-3 space-y-2">
                  <p className="text-xs text-amber-400 font-medium">
                    ② Recovery 用 — 上長 (Guardian) · EOA モード
                  </p>
                  <p className="text-xs text-zinc-500">
                    ERC-4337 <strong className="text-zinc-400">なし</strong>。<code className="bg-zinc-800 px-1 rounded">account.address</code> = EOA → raw ECDSA 署名 →{" "}
                    <code className="bg-zinc-800 px-1 rounded">!sig</code> エラー回避
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <GoogleLogin
                      onSuccess={(res) => res.credential && handleGuardianGoogleLogin(res.credential)}
                      onError={() => {}}
                      theme="filled_black"
                      shape="rectangular"
                      size="medium"
                    />
                  </div>
                </div>

                {/* WalletConnect */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleWalletConnect}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm text-zinc-200 transition-colors"
                  >
                    <span>🔗</span> WalletConnect
                  </button>
                  <p className="text-xs text-zinc-500">MetaMask など (自分でガスを支払う · ① ② 両方で使用可)</p>
                </div>
              </div>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────
              Panel ①: Guardian 設定 (社員の操作)
          ──────────────────────────────────────────────────────────────── */}
          <div className="border border-emerald-800/50 rounded-xl p-4 bg-emerald-900/5 space-y-3">
            <div>
              <p className="text-emerald-400 font-medium text-sm">
                ① Guardian 設定 — 社員が自分の Smart Account に上長を Guardian として登録
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                社員 ({SCENARIO_LOST_KEY ? shorten(SCENARIO_LOST_KEY) : "—"}) の Google アカウントでログイン後に実行
              </p>
            </div>

            <p className="text-xs text-zinc-400">
              Google でログインすると <code className="bg-zinc-800 px-1 rounded">account.address</code> が
              社員の <strong className="text-zinc-200">ERC-4337 Smart Account アドレス</strong>になります。
              このアドレスを② Recovery で入力します。
            </p>

            {/* Show employee's smart account address if connected as employee */}
            {account && SCENARIO_LOST_KEY && account.address.toLowerCase() !== SCENARIO_LOST_KEY.toLowerCase() && (
              <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 p-3 text-xs text-amber-300">
                ⚠ 接続中のアドレスは社員の EOA ({shorten(SCENARIO_LOST_KEY)}) と異なります。
                社員アカウントで再接続してください。
              </div>
            )}

            {account && (
              <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">社員の Smart Account アドレス (② Recovery で使用)</span>
                </div>
                <p className="font-mono text-sm text-emerald-400 break-all">{account.address}</p>
                <p className="text-xs text-zinc-500">← この値を② Recovery 実行パネルの「Smart Account アドレス」に入力してください</p>
                {smartAccount?.address.toLowerCase() === account.address.toLowerCase() && smartAccount.admins.length > 0 && (
                  <div className="pt-2 space-y-1 border-t border-zinc-800">
                    <p className="text-xs text-zinc-500">現在の Admin 一覧</p>
                    {smartAccount.admins.map((a) => {
                      const isGuardian = SCENARIO_GUARDIAN_EOA && a.toLowerCase() === SCENARIO_GUARDIAN_EOA.toLowerCase();
                      const isEmployee = SCENARIO_LOST_KEY && a.toLowerCase() === SCENARIO_LOST_KEY.toLowerCase();
                      return (
                        <div key={a} className="flex items-center justify-between text-xs">
                          <span className={`font-mono ${isGuardian ? "text-emerald-400" : "text-zinc-300"}`}>{a}</span>
                          {isGuardian && <span className="text-emerald-400 ml-2 shrink-0">← Guardian (上長) ✓</span>}
                          {isEmployee && <span className="text-blue-400 ml-2 shrink-0">← 社員 (初期 Admin)</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => fetchAdmins(account.address)}
                  disabled={fetchLoading}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {fetchLoading ? "読み込み中…" : "↺ Admin 一覧を更新"}
                </button>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-zinc-400">
                Guardian のウォレットアドレス{" "}
                <span className="text-zinc-500">
                  (上長 {ROLE_CONFIG.admin2.step} {ROLE_CONFIG.admin2.labelJa} — 事前入力済み)
                </span>
              </label>
              <input
                type="text"
                placeholder="0x…"
                value={guardianInput}
                onChange={(e) => setGuardianInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            <button
              onClick={() => handleAddGuardian(guardianInput)}
              disabled={
                actionLoading ||
                !account ||
                !guardianInput.startsWith("0x") ||
                guardianInput.toLowerCase() === account?.address.toLowerCase()
              }
              className="w-full py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium transition-colors"
            >
              {actionLoading ? "処理中… (ブロック確認待ち)" : "上長 (Guardian) を登録 (addAdmin)"}
            </button>
            {!account && (
              <p className="text-xs text-zinc-500 text-center">上のウォレット接続が必要です</p>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────
              Panel ②: Recovery 実行 (上長の操作)
          ──────────────────────────────────────────────────────────────── */}
          <div className="border border-amber-800/50 rounded-xl p-4 bg-amber-900/5 space-y-3">
            <div>
              <p className="text-amber-400 font-medium text-sm">
                ② Recovery 実行 — 上長 (Guardian) が社員の紛失した鍵を新しい鍵に差し替え
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                上長 ({SCENARIO_GUARDIAN_EOA ? shorten(SCENARIO_GUARDIAN_EOA) : "—"}) の
                Google アカウント <strong className="text-amber-300/70">(EOA モード)</strong> または WalletConnect でログイン後に実行
              </p>
            </div>

            <p className="text-xs text-zinc-400">
              <strong className="text-zinc-200">社員の旧い鍵は不要です。</strong>
              上長が Guardian として SignerPermissionRequest に署名するだけで
              Smart Account の Admin を差し替えられます。
            </p>

            {/* Guardian role check */}
            {account && SCENARIO_GUARDIAN_EOA && account.address.toLowerCase() !== SCENARIO_GUARDIAN_EOA.toLowerCase() && (
              <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 p-3 text-xs text-amber-300">
                ⚠ 接続中のアドレス ({shorten(account.address)}) は Guardian (上長:{" "}
                {shorten(SCENARIO_GUARDIAN_EOA)}) と異なります。
                上長のアカウントで接続してください。
              </div>
            )}

            {/* Target account input */}
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">
                社員の Smart Account アドレス{" "}
                <span className="text-red-400">*</span>
                <span className="text-zinc-500 ml-1">(① Guardian 設定で表示されたアドレス)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="0x… (社員の ERC-4337 Smart Account)"
                  value={targetAccount}
                  onChange={(e) => setTargetAccount(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={() => fetchAdmins(targetAccount)}
                  disabled={fetchLoading || !targetAccount.startsWith("0x")}
                  className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 text-sm transition-colors shrink-0"
                >
                  {fetchLoading ? "…" : "確認"}
                </button>
              </div>
            </div>

            {/* Admin list */}
            {smartAccount && smartAccount.address.toLowerCase() === targetAccount.toLowerCase() && (
              <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-2">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">現在の Admin 一覧</p>
                {smartAccount.isDeployed ? (
                  smartAccount.admins.length > 0 ? (
                    smartAccount.admins.map((a) => {
                      const isMe      = account && a.toLowerCase() === account.address.toLowerCase();
                      const isGuardian = SCENARIO_GUARDIAN_EOA && a.toLowerCase() === SCENARIO_GUARDIAN_EOA.toLowerCase();
                      const isEmployee = SCENARIO_LOST_KEY && a.toLowerCase() === SCENARIO_LOST_KEY.toLowerCase();
                      return (
                        <div key={a} className="flex items-center justify-between text-xs gap-2">
                          <span className={`font-mono break-all ${isGuardian ? "text-emerald-400" : isEmployee ? "text-red-400" : "text-zinc-300"}`}>
                            {a}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {isGuardian && <span className="text-emerald-400">Guardian ✓</span>}
                            {isEmployee && <span className="text-red-400">社員 (紛失)</span>}
                            {isMe && !isGuardian && !isEmployee && <span className="text-zinc-400">接続中</span>}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-zinc-500">Admin が見つかりません</p>
                  )
                ) : (
                  <p className="text-xs text-amber-400">⚠ Smart Account がまだデプロイされていません (① を先に実行してください)</p>
                )}
                {account && smartAccount.isDeployed && !isAdminOf(targetAccount) && (
                  <p className="text-xs text-red-400">
                    ⚠ 接続中のウォレット ({shorten(account.address)}) はこの Smart Account の Admin ではありません
                  </p>
                )}
              </div>
            )}

            {/* Lost key — pre-filled with employee's EOA */}
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">
                紛失した鍵のアドレス
                <span className="text-zinc-500 ml-1">
                  (社員の EOA — 事前入力済み。空欄で削除スキップ)
                </span>
              </label>
              <input
                type="text"
                placeholder="0x…"
                value={lostKey}
                onChange={(e) => setLostKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              {lostKey && (
                <button onClick={() => setLostKey("")} className="text-xs text-zinc-500 hover:text-zinc-400">
                  クリア (削除をスキップ)
                </button>
              )}
            </div>

            {/* New key */}
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">
                新しい鍵のアドレス <span className="text-red-400">*</span>
                <span className="text-zinc-500 ml-1">(社員の復旧先 — 新しい Google アカウントの EOA など)</span>
              </label>
              <input
                type="text"
                placeholder="0x… (社員の新しいアドレス)"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* Execution summary */}
            {targetAccount.startsWith("0x") && newKey.startsWith("0x") && (
              <div className="rounded-lg bg-zinc-800 p-3 text-xs space-y-1.5">
                <p className="text-zinc-500 uppercase tracking-wider mb-2">実行内容</p>
                <p className="text-zinc-400">
                  対象 Smart Account:{" "}
                  <span className="font-mono text-zinc-200">{shorten(targetAccount)}</span>
                  <span className="text-zinc-500 ml-1">(社員の ERC-4337 Account)</span>
                </p>
                <p className="text-zinc-400">
                  署名者 (Guardian / 上長):{" "}
                  <span className="font-mono text-zinc-200">{account ? shorten(account.address) : "—"}</span>
                </p>
                <p className="text-zinc-400">
                  Step 1 — <code>addAdmin</code>:{" "}
                  <span className="font-mono text-emerald-400">{shorten(newKey)}</span>
                  <span className="text-zinc-500 ml-1">を Admin に追加 (社員の新しい鍵)</span>
                </p>
                {lostKey && lostKey !== newKey ? (
                  <p className="text-zinc-400">
                    Step 2 — <code>removeAdmin</code>:{" "}
                    <span className="font-mono text-red-400">{shorten(lostKey)}</span>
                    <span className="text-zinc-500 ml-1">を Admin から削除 (社員の旧い鍵)</span>
                  </p>
                ) : (
                  <p className="text-zinc-500 italic">Step 2 — removeAdmin: スキップ (旧鍵未入力)</p>
                )}
                <p className="text-zinc-400">
                  ガス代:{" "}
                  {activeWallet?.id === "inApp"
                    ? <span className="text-emerald-400">スポンサー (ERC-4337 Paymaster)</span>
                    : <span className="text-amber-400">接続中のウォレットの ETH 残高から支払い</span>
                  }
                </p>
              </div>
            )}

            <button
              onClick={() => handleRecover(targetAccount, lostKey, newKey, !lostKey)}
              disabled={
                actionLoading ||
                !account ||
                !targetAccount.startsWith("0x") ||
                !newKey.startsWith("0x") ||
                (!!lostKey && newKey.toLowerCase() === lostKey.toLowerCase())
              }
              className="w-full py-2.5 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium transition-colors"
            >
              {actionLoading
                ? "Recovery 実行中…"
                : lostKey
                  ? "🔑 Recovery を実行 (addAdmin + removeAdmin)"
                  : "🔑 Recovery を実行 (addAdmin のみ)"}
            </button>
            {!account && (
              <p className="text-xs text-zinc-500 text-center">上のウォレット接続が必要です</p>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────
              Panel ③: Send ETH from Employee's Smart Account
              Visible when a recognized admin (not the lost key itself) connects.
          ──────────────────────────────────────────────────────────────── */}
          {account &&
            SCENARIO_LOST_KEY &&
            account.address.toLowerCase() !== SCENARIO_LOST_KEY.toLowerCase() && (
            <div className="border border-purple-800/50 rounded-xl p-4 bg-purple-900/5 space-y-3">
              <div>
                <p className="text-purple-400 font-medium text-sm">
                  ③ 資産送金 — Admin が社員の Smart Account から ETH を送金
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  接続中の Admin ({shorten(account.address)}) が
                  <code className="bg-zinc-800 px-1 rounded mx-1">execute(target, value, &quot;0x&quot;)</code>
                  を呼び出し、社員の Smart Account から ETH を転送します
                </p>
              </div>

              {/* Connection guidance */}
              {activeWallet?.id === "inApp" ? (
                <div className="rounded-lg bg-emerald-900/20 border border-emerald-700/40 p-3 text-xs space-y-1">
                  <p className="text-emerald-400 font-medium">
                    ThirdWeb In-App Wallet (ERC-4337) — ガス代スポンサー済み
                  </p>
                  <p className="text-zinc-400">
                    Admin の Smart Wallet ({shorten(account.address)}) が
                    <code className="bg-zinc-900 px-1 rounded mx-1">execute()</code>
                    を UserOperation として送信します。
                    Paymaster がガス代を負担するため、Admin の ETH 残高は不要です。
                  </p>
                  <p className="text-zinc-500">
                    ※ ウォレット接続で「① ERC-4337 Smart Account」の Google ログインを使用してください。
                    「② EOA モード」で接続した場合はガス代がスポンサーされません。
                  </p>
                </div>
              ) : (
                <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 p-3 text-xs space-y-1">
                  <p className="text-amber-400 font-medium">
                    外部ウォレット (EOA) — ガス代は接続中のウォレットが負担
                  </p>
                  <p className="text-zinc-400">
                    Admin の EOA ({shorten(account.address)}) が直接
                    <code className="bg-zinc-900 px-1 rounded mx-1">execute()</code>
                    を呼び出します。ガス代は接続中のウォレットの ETH 残高から支払われます。
                  </p>
                </div>
              )}

              <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-zinc-500">送金元 (Smart Account)</span>
                  <span className="font-mono text-blue-400">{shorten(SCENARIO_LOST_KEY)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">残高</span>
                  <span className="font-mono text-zinc-200">
                    {balance !== null ? `${balance} ETH` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">署名者 (Admin)</span>
                  <span className="font-mono text-purple-400">{shorten(account.address)}</span>
                </div>
              </div>

              {/* sendError / sendSuccess */}
              {sendError && (
                <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-xs whitespace-pre-wrap">
                  {sendError}
                </div>
              )}
              {sendSuccess && (
                <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-xs whitespace-pre-wrap">
                  {sendSuccess}
                </div>
              )}

              {/* Recipient */}
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">
                  送金先アドレス
                  <span className="text-zinc-500 ml-1">
                    (事前入力: admin2 / {ROLE_CONFIG.admin2.labelJa})
                  </span>
                </label>
                <input
                  type="text"
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* Amount */}
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">金額 (ETH)</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <button
                onClick={() =>
                  handleSendFromEmployeeWallet(SCENARIO_LOST_KEY, sendTo, sendAmount)
                }
                disabled={
                  sendLoading ||
                  !sendTo.startsWith("0x") ||
                  !sendAmount ||
                  parseFloat(sendAmount) <= 0
                }
                className="w-full py-2.5 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium transition-colors"
              >
                {sendLoading ? "送金中… (ブロック確認待ち)" : "ETH を送金 (execute)"}
              </button>
            </div>
          )}

        </section>
      </div>
    </main>
  );
}
