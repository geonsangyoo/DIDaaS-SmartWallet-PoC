"use client";

import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import { useSafe } from "./useSafe";
import { FlowDiagram } from "./components/FlowDiagram";
import { RolePanel } from "./components/RolePanel";
import { TransactionList } from "./components/TransactionList";
import { ROLE_CONFIG, RING, OWNER_ADDRESSES } from "./config";
import type { Role } from "./types";

export default function MultisigPage() {
  const {
    safeInfo,
    isEmployeeDelegate,
    fetchLoading,
    actionLoading,
    error,
    success,
    account,
    role,
    ownersConfigured,
    refresh,
    handleGoogleLogin,
    handleWalletConnect,
    handleDisconnect,
    handleDeploy,
    handleAddEmployeeDelegate,
    handlePropose,
    handleConfirm,
    handleExecute,
  } = useSafe();

  const pending  = safeInfo?.pendingTransactions.filter((t) => !t.isExecuted) ?? [];
  const executed = safeInfo?.pendingTransactions.filter((t) =>  t.isExecuted) ?? [];

  return (
    <main className="min-h-[100vh] bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">← Home</Link>
            <h1 className="text-2xl font-bold mt-1">Multi-Sig PoC</h1>
            <p className="text-zinc-400 text-sm">
              交通費精算 申請・承認フロー — 2-of-2 Gnosis Safe (Sepolia)
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

        <FlowDiagram />

        {/* Setup notice */}
        {!ownersConfigured && (
          <div className="border border-amber-700/50 rounded-xl p-4 bg-amber-900/10 text-sm space-y-2">
            <p className="text-amber-400 font-medium">Setup required</p>
            <p className="text-zinc-300">
              All 3 users need to log in with their Google account once (employee as proposer, admin1 and admin2 as Safe owners).
              Copy their ThirdWeb wallet addresses into <code className="text-zinc-200">.env.local</code>:
            </p>
            <pre className="text-xs text-zinc-400 bg-zinc-900 rounded p-3 overflow-x-auto">{`NEXT_PUBLIC_EMPLOYEE_ADDRESS=0x...   # 社員 Google account wallet
NEXT_PUBLIC_ADMIN1_ADDRESS=0x...     # 上長 Google account wallet
NEXT_PUBLIC_ADMIN2_ADDRESS=0x...     # 経理担当 Google account wallet`}</pre>
            <p className="text-zinc-500 text-xs">
              After setting these, restart the dev server. The Safe will be deployed
              on the first expense proposal (counterfactual deployment on Sepolia).
            </p>
          </div>
        )}

        {/* Safe info */}
        {safeInfo && (
          <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30 space-y-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Gnosis Safe — Sepolia — Threshold 2/2
            </p>
            <div className="flex justify-between items-center">
              <span className="text-xs text-zinc-400">会社 SmartWallet (Safe)</span>
              <a
                href={`https://app.safe.global/sep:${safeInfo.safeAddress}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-blue-400 hover:underline"
              >
                {safeInfo.safeAddress}
              </a>
            </div>
            {/* Employee: proposer only — not a Safe owner */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-blue-400">
                {ROLE_CONFIG.employee.step} {ROLE_CONFIG.employee.labelJa} EOA
                <span className="text-zinc-500 ml-1">(Proposer / Recipient)</span>
              </span>
              <span className="font-mono text-xs text-zinc-300">
                {OWNER_ADDRESSES.employee || <span className="text-zinc-600 italic">not configured</span>}
              </span>
            </div>
            {/* Admin1 and Admin2: Safe owners */}
            {(["admin1", "admin2"] as Role[]).map((r) => (
              <div key={r} className="flex justify-between items-center">
                <span className={`text-xs ${r === "admin1" ? "text-amber-400" : "text-green-400"}`}>
                  {ROLE_CONFIG[r].step} {ROLE_CONFIG[r].labelJa} EOA
                  <span className="text-zinc-500 ml-1">(Owner)</span>
                </span>
                <span className="font-mono text-xs text-zinc-300">
                  {OWNER_ADDRESSES[r] || <span className="text-zinc-600 italic">not configured</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Deploy notice */}
        {safeInfo && !safeInfo.isDeployed && (
          <div className="border border-red-700/50 rounded-xl p-4 bg-red-900/10 text-sm space-y-4">
            <p className="text-red-400 font-medium">Safe not deployed on Sepolia</p>

            {/* Option A — recommended */}
            <div className="space-y-1">
              <p className="text-zinc-200 font-medium">Option A — recommended</p>
              <p className="text-zinc-400">
                Create the Safe at{" "}
                <a
                  href="https://app.safe.global/new-safe/create?chain=sep"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 underline"
                >
                  app.safe.global
                </a>{" "}
                (Sepolia, owners: admin1 + admin2, threshold 2). Then paste the Safe address into{" "}
                <code className="text-zinc-200">.env.local</code>:
              </p>
              <pre className="text-xs bg-zinc-900 rounded p-2 text-zinc-300">
                NEXT_PUBLIC_SAFE_ADDRESS=0x…
              </pre>
              <p className="text-zinc-500 text-xs">Restart the dev server after adding the var.</p>
            </div>

            {/* Option B — programmatic deploy */}
            <div className="space-y-1">
              <p className="text-zinc-200 font-medium">Option B — deploy from this page</p>
              <p className="text-zinc-400">
                Connect an owner wallet that has Sepolia ETH, then click below.
                The deployment is a single on-chain transaction; all owners can
                propose/confirm afterwards.
              </p>
              {account ? (
                <button
                  onClick={handleDeploy}
                  disabled={actionLoading}
                  className="w-full py-2 px-4 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  {actionLoading ? "Deploying… (waiting for block confirmation)" : "Deploy Safe on Sepolia"}
                </button>
              ) : (
                <p className="text-zinc-500 text-xs">Connect your Google account below to deploy.</p>
              )}
            </div>
          </div>
        )}

        {/* Status messages */}
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

        {/* Wallet connection */}
        <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            Connect Wallet
          </p>

          {account ? (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs text-zinc-500">Connected EOA</p>
                  <p className="font-mono text-sm text-zinc-200">{account.address}</p>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded"
                >
                  Disconnect
                </button>
              </div>

              {role ? (
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${RING[ROLE_CONFIG[role].color]}`}>
                  {ROLE_CONFIG[role].step} {ROLE_CONFIG[role].labelJa} ({ROLE_CONFIG[role].label})
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">
                  This address is not registered as a Safe owner.
                  {ownersConfigured
                    ? " Connect with one of the 2 admin Google accounts."
                    : " Configure NEXT_PUBLIC_*_ADDRESS env vars first."}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Google → ThirdWeb in-app wallet */}
              <div className="flex items-center gap-3 flex-wrap">
                <GoogleLogin
                  onSuccess={(res) => res.credential && handleGoogleLogin(res.credential)}
                  onError={() => {}}
                  theme="filled_black"
                  shape="rectangular"
                  size="medium"
                />
                <p className="text-xs text-zinc-500">社員 / 経理担当 — ThirdWeb in-app wallet</p>
              </div>

              {/* WalletConnect — for external wallets like Ambire */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleWalletConnect}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm text-zinc-200 transition-colors"
                >
                  <span className="text-base">🔗</span>
                  WalletConnect
                </button>
                <p className="text-xs text-zinc-500">上長 — Ambire or any WalletConnect wallet</p>
              </div>
            </div>
          )}
        </div>

        {/* Role action panel */}
        {account && role && (
          <RolePanel
            role={role}
            pending={pending}
            actionLoading={actionLoading}
            ownersConfigured={ownersConfigured}
            isSafeDeployed={safeInfo?.isDeployed ?? false}
            isEmployeeDelegate={isEmployeeDelegate}
            accountAddress={account.address}
            onPropose={handlePropose}
            onConfirm={handleConfirm}
            onExecute={handleExecute}
            onAddEmployeeDelegate={handleAddEmployeeDelegate}
          />
        )}

        <TransactionList pending={pending} executed={executed} />

      </div>
    </main>
  );
}
