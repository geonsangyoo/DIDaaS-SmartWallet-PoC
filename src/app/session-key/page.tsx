"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import { useSessionKey } from "./useSessionKey";
import { OWNER_ADDR_STORAGE_KEY } from "./config";

function shorten(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

type Role = "owner" | "delegate";

export default function SessionKeyPage() {
  const [role, setRole] = useState<Role>("owner");
  const [ownerAddrInput, setOwnerAddrInput] = useState("");

  const {
    step,
    error,
    execTxHash,
    account,
    sessionAccount,
    configured,
    handleOwnerConnect,
    handleDelegateConnect,
    executeTransfer,
    handleDisconnect,
    DELEGATE_ADDRESS,
    RECIPIENT_ADDRESS,
    AMOUNT_DISPLAY,
  } = useSessionKey();

  // Pre-fill owner address from localStorage when switching to delegate tab
  useEffect(() => {
    if (role === "delegate") {
      const stored = localStorage.getItem(OWNER_ADDR_STORAGE_KEY) ?? "";
      if (stored) setOwnerAddrInput(stored);
    }
  }, [role]);

  // Persist smart account address to localStorage after owner connects
  useEffect(() => {
    if (role === "owner" && account?.address) {
      localStorage.setItem(OWNER_ADDR_STORAGE_KEY, account.address);
    }
  }, [role, account?.address]);

  const switchRole = (next: Role) => {
    handleDisconnect();
    setRole(next);
  };

  const isBusy =
    step === "connecting" ||
    step === "link-connecting" ||
    step === "executing";

  return (
    <main className="min-h-[100vh] bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">
            ← Home
          </Link>
          <h1 className="text-2xl font-bold mt-1">Session Key</h1>
          <p className="text-zinc-400 text-sm">
            権限移譲・別クライアントTx実行 — ERC-4337 SmartWallet (Sepolia)
          </p>
        </div>

        {/* Scenario diagram */}
        <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Scenario</p>

          <div className="flex items-start gap-2 flex-wrap text-xs">
            <div className="border border-blue-500/40 bg-blue-500/10 rounded-lg px-3 py-2 text-center min-w-[110px]">
              <p className="text-blue-400 font-medium">Owner / 社員</p>
              <p className="text-zinc-400 mt-0.5">Google login</p>
              <p className="text-zinc-400">grants session key</p>
            </div>
            <div className="flex items-center self-center text-zinc-600 font-bold">→</div>
            <div className="border border-orange-500/40 bg-orange-500/10 rounded-lg px-3 py-2 text-center min-w-[130px]">
              <p className="text-orange-400 font-medium">Delegate / 経費担当</p>
              <p className="text-zinc-400 mt-0.5">Google login</p>
              <p className="text-zinc-400">executes Tx on Owner&apos;s</p>
              <p className="text-zinc-400">Smart Account</p>
            </div>
            <div className="flex items-center self-center text-zinc-600 font-bold">→</div>
            <div className="border border-green-500/40 bg-green-500/10 rounded-lg px-3 py-2 text-center min-w-[110px]">
              <p className="text-green-400 font-medium">Recipient / 上長</p>
              <p className="text-zinc-400 mt-0.5">receives</p>
              <p className="text-zinc-400">{AMOUNT_DISPLAY} ETH</p>
            </div>
          </div>

          <div className="text-xs text-zinc-500 space-y-0.5 border-t border-zinc-800 pt-3">
            <p>
              <span className="text-zinc-400">Limit:</span> max {AMOUNT_DISPLAY} ETH per tx ·{" "}
              <span className="text-zinc-400">Valid:</span> 24 hours ·{" "}
              <span className="text-zinc-400">Network:</span> Sepolia
            </p>
            <p>
              Owner connects via{" "}
              <code className="text-zinc-300 bg-zinc-800 px-1 rounded">
                smartWallet({"{ sessionKey: {...} }"})
              </code>{" "}
              — the SDK registers the session key automatically using the admin EOA.
            </p>
          </div>
        </div>

        {/* Setup notice */}
        {!configured && (
          <div className="border border-amber-700/50 rounded-xl p-4 bg-amber-900/10 text-sm space-y-3">
            <p className="text-amber-400 font-medium">Setup required — env vars missing</p>
            <pre className="text-xs text-zinc-400 bg-zinc-900 rounded p-3 overflow-x-auto">{`# Delegate's inAppWallet EOA (経費担当)
NEXT_PUBLIC_SESSION_KEY_DELEGATE_ADDRESS=0x...

# Recipient of the test transfer (上長)
NEXT_PUBLIC_SESSION_KEY_TEST_RECIPIENT=0x...

# Transfer amount in ETH (default: 0.001)
NEXT_PUBLIC_SESSION_KEY_TEST_AMOUNT=0.001`}</pre>
          </div>
        )}

        {/* Role selector */}
        <div className="flex gap-2">
          {(["owner", "delegate"] as const).map((r) => (
            <button
              key={r}
              onClick={() => switchRole(r)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                role === r
                  ? r === "owner"
                    ? "bg-blue-700 text-white"
                    : "bg-orange-700 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {r === "owner" ? "① Owner / 社員" : "② Delegate / 経費担当"}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm whitespace-pre-wrap">
            {error}
          </div>
        )}

        {/* ── Owner Panel ──────────────────────────────────────────────────────── */}
        {role === "owner" && (
          <div className="space-y-4">

            <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider">
                  Connect as Owner / 社員
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Google OAuth → EOA → Smart Account.
                  Connecting automatically registers the Delegate as a session key signer
                  (gas sponsored, 24-hour validity).
                </p>
              </div>

              {account ? (
                <div className="space-y-3">
                  {/* Success indicator */}
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    Connected — session key registered
                  </div>

                  {/* Addresses */}
                  <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-zinc-500 shrink-0">Smart Account</span>
                      <span className="font-mono text-zinc-200 break-all text-right">
                        {account.address}
                      </span>
                    </div>
                    <div className="flex justify-between items-start gap-2 border-t border-zinc-800 pt-1.5">
                      <span className="text-zinc-500 shrink-0">Session key granted to</span>
                      <span className="font-mono text-orange-400 break-all text-right">
                        {DELEGATE_ADDRESS || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-zinc-800 pt-1.5">
                      <span className="text-zinc-500">ETH limit / tx</span>
                      <span className="text-zinc-300">{AMOUNT_DISPLAY} ETH</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Valid for</span>
                      <span className="text-zinc-300">24 hours</span>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-500">
                    Share your Smart Account address with the Delegate (copied to clipboard / pre-filled in Delegate tab):
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-zinc-300 bg-zinc-800 px-2 py-1 rounded break-all flex-1">
                      {account.address}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(account.address)}
                      className="shrink-0 text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded"
                    >
                      Copy
                    </button>
                  </div>

                  <button
                    onClick={handleDisconnect}
                    className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Session key preview */}
                  <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
                    <p className="text-zinc-500 uppercase tracking-wider text-[10px] mb-2">
                      Will register on connect
                    </p>
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-zinc-500 shrink-0">Delegate EOA</span>
                      <span className="font-mono text-orange-400 break-all text-right">
                        {DELEGATE_ADDRESS ? shorten(DELEGATE_ADDRESS) : "not configured"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">ETH limit / tx</span>
                      <span className="text-zinc-300">{AMOUNT_DISPLAY} ETH</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Validity</span>
                      <span className="text-zinc-300">24 hours</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Targets</span>
                      <span className="text-zinc-300">any</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <GoogleLogin
                      onSuccess={(res) => res.credential && handleOwnerConnect(res.credential)}
                      onError={() => {}}
                      theme="filled_black"
                      shape="rectangular"
                      size="medium"
                    />
                    {step === "connecting" && (
                      <p className="text-xs text-zinc-400">
                        Connecting & registering session key…
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Delegate Panel ───────────────────────────────────────────────────── */}
        {role === "delegate" && (
          <div className="space-y-4">

            {/* Step 1: Owner's smart account address */}
            <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Step 1 — Owner's Smart Account Address
              </p>
              <p className="text-xs text-zinc-500">
                Paste the Smart Account address from the Owner tab.
                Auto-filled if the Owner connected in this browser session.
              </p>
              <input
                type="text"
                placeholder="0x… (Owner's Smart Account on Sepolia)"
                value={ownerAddrInput}
                onChange={(e) => setOwnerAddrInput(e.target.value)}
                disabled={!!sessionAccount}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
              />
            </div>

            {/* Step 2: Connect as Delegate */}
            <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Step 2 — Connect as Delegate / 経費担当
              </p>
              <p className="text-xs text-zinc-500">
                Your inAppWallet EOA must match the address the Owner registered as the session key.
              </p>

              {sessionAccount ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    Linked to Owner&apos;s Smart Account
                  </div>
                  <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-zinc-500 shrink-0">Your EOA (session key)</span>
                      <span className="font-mono text-zinc-400 break-all text-right">
                        {account?.address ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between items-start gap-2 border-t border-zinc-800 pt-1.5">
                      <span className="text-zinc-500 shrink-0">Executing on</span>
                      <span className="font-mono text-zinc-200 break-all text-right">
                        {sessionAccount.address}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <GoogleLogin
                    onSuccess={(res) =>
                      res.credential && handleDelegateConnect(res.credential, ownerAddrInput)
                    }
                    onError={() => {}}
                    theme="filled_black"
                    shape="rectangular"
                    size="medium"
                  />
                  {step === "connecting" && (
                    <p className="text-xs text-zinc-400">Connecting wallet…</p>
                  )}
                  {step === "link-connecting" && (
                    <p className="text-xs text-zinc-400">Linking to Owner&apos;s Smart Account…</p>
                  )}
                </div>
              )}
            </div>

            {/* Step 3: Execute transfer */}
            {sessionAccount && (
              <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">
                  Step 3 — Execute ETH Transfer via Session Key
                </p>

                {/* Tx preview */}
                <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-zinc-500">From (Owner&apos;s SA)</span>
                    <span className="font-mono text-zinc-300">{shorten(sessionAccount.address)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">To (Recipient / 上長)</span>
                    <span className="font-mono text-zinc-300">
                      {RECIPIENT_ADDRESS ? shorten(RECIPIENT_ADDRESS) : "not configured"}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-zinc-800 pt-1.5 mt-0.5">
                    <span className="text-zinc-500">Amount</span>
                    <span className="text-zinc-100 font-medium">{AMOUNT_DISPLAY} ETH</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Signed by</span>
                    <span className="text-orange-400">Delegate EOA (session key)</span>
                  </div>
                </div>

                {execTxHash && (
                  <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-xs space-y-1.5">
                    <p className="font-medium">✓ Transfer executed via session key!</p>
                    <p>
                      TX:{" "}
                      <a
                        href={`https://sepolia.etherscan.io/tx/${execTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline font-mono"
                      >
                        {shorten(execTxHash)}
                      </a>
                    </p>
                    <p className="text-green-600">
                      The Delegate signed the UserOp with their EOA. Permissions were
                      verified on-chain and the transfer executed from the Owner&apos;s Smart
                      Account — without the Owner&apos;s direct involvement.
                    </p>
                  </div>
                )}

                <button
                  onClick={executeTransfer}
                  disabled={!RECIPIENT_ADDRESS || isBusy || step === "done"}
                  className="w-full py-3 px-4 rounded-xl bg-orange-700 hover:bg-orange-600 text-white font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-sm"
                >
                  {step === "executing"
                    ? "Executing… (awaiting UserOp confirmation)"
                    : step === "done"
                    ? "✓ Transfer Done"
                    : `⚡ Send ${AMOUNT_DISPLAY} ETH from Owner's Smart Account`}
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  );
}
