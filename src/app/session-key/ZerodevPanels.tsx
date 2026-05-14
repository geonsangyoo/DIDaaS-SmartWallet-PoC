"use client";

import { useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import {
  useSessionKeyZerodev,
  type AssetGrant,
} from "./useSessionKeyZerodev";
import {
  TOKEN_ASSETS,
  type TokenAsset,
  DEFAULT_AMOUNT_CAPS,
  RECIPIENT_ADDRESS,
  DELEGATE_ADDRESS,
  ZERODEV_OWNER_ADDR_KEY,
  ZERODEV_SERIALIZED_KEY,
} from "./config";

type Role = "owner" | "delegate";

function shorten(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

// Build the default grant rows from the configured TOKEN_ASSETS.
function defaultGrants(): AssetGrant[] {
  return TOKEN_ASSETS.map((a) => ({
    symbol: a.symbol,
    enabled: a.kind === "native",
    capDisplay: DEFAULT_AMOUNT_CAPS[a.symbol] ?? "0",
    recipient: RECIPIENT_ADDRESS,
  }));
}

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
    handleOwnerConnect,
    handleGrantSessionKey,
    handleDelegateConnect,
    executeTransfer,
    handleDisconnect,
  } = useSessionKeyZerodev();

  // Owner state
  const [delegateAddrInput, setDelegateAddrInput] =
    useState<string>(DELEGATE_ADDRESS);
  const [grants, setGrants] = useState<AssetGrant[]>(defaultGrants);

  // Delegate state
  const [serializedInput, setSerializedInput] = useState<string>("");
  const [execAssetSymbol, setExecAssetSymbol] = useState<string>(
    TOKEN_ASSETS[0]?.symbol ?? "ETH",
  );
  const [execRecipient, setExecRecipient] = useState<string>(RECIPIENT_ADDRESS);
  const [execAmount, setExecAmount] = useState<string>(
    DEFAULT_AMOUNT_CAPS[TOKEN_ASSETS[0]?.symbol ?? "ETH"] ?? "0",
  );

  const execAsset: TokenAsset =
    TOKEN_ASSETS.find((a) => a.symbol === execAssetSymbol) ?? TOKEN_ASSETS[0];

  // Auto-fill the serialized key on the delegate tab from localStorage so the
  // demo works on the same browser without copy/paste.
  useEffect(() => {
    if (role === "delegate" && typeof window !== "undefined") {
      const stored = localStorage.getItem(ZERODEV_SERIALIZED_KEY) ?? "";
      if (stored) setSerializedInput(stored);
    }
  }, [role]);

  const switchRole = (next: Role) => {
    handleDisconnect();
    setRole(next);
  };

  const isBusy =
    step === "connecting" ||
    step === "granting" ||
    step === "executing";

  const updateGrant = (sym: string, patch: Partial<AssetGrant>) => {
    setGrants((prev) =>
      prev.map((g) => (g.symbol === sym ? { ...g, ...patch } : g)),
    );
  };

  return (
    <div className="space-y-4">
      {/* Setup notice */}
      {!configured && (
        <div className="border border-amber-700/50 rounded-xl p-4 bg-amber-900/10 text-sm space-y-3">
          <p className="text-amber-400 font-medium">
            ZeroDev not configured — env var missing
          </p>
          <pre className="text-xs text-zinc-400 bg-zinc-900 rounded p-3 overflow-x-auto">{`# ZeroDev Project ID (https://dashboard.zerodev.app)
NEXT_PUBLIC_ZERODEV_PROJECT_ID=...`}</pre>
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

      {error && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* ── Owner ─────────────────────────────────────────────────────────── */}
      {role === "owner" && (
        <div className="space-y-4">
          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Connect as Owner / 社員 — Kernel (ERC-7579)
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Sign in with Google. The grant is built off-chain and shared as a
                serialized session-key blob — no on-chain tx until the delegate
                acts.
              </p>
            </div>

            {!account && (
              <div className="flex items-center gap-3 flex-wrap">
                <GoogleLogin
                  onSuccess={(res) =>
                    res.credential && handleOwnerConnect(res.credential)
                  }
                  onError={() => {}}
                  theme="filled_black"
                  shape="rectangular"
                  size="medium"
                />
                {step === "connecting" && (
                  <p className="text-xs text-zinc-400">Connecting wallet…</p>
                )}
              </div>
            )}

            {account && step !== "ready" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                  Connected — configure grant below
                </div>
                <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-zinc-500 shrink-0">Owner EOA</span>
                    <span className="font-mono text-zinc-200 break-all text-right">
                      {account.address}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-2 border-t border-zinc-800 pt-1.5">
                    <span className="text-zinc-500 shrink-0">
                      Kernel SA (predicted)
                    </span>
                    <span className="font-mono text-zinc-200 break-all text-right">
                      {ownerKernelAddress ?? "—"}
                    </span>
                  </div>
                </div>

                {/* Delegate address */}
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500 uppercase tracking-wider">
                    Delegate EOA
                  </label>
                  <input
                    type="text"
                    placeholder="0x… (delegate's inAppWallet EOA)"
                    value={delegateAddrInput}
                    onChange={(e) => setDelegateAddrInput(e.target.value)}
                    disabled={isBusy}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                  />
                </div>

                {/* Per-asset grants */}
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider">
                    Asset grants & per-tx caps
                  </p>
                  <div className="space-y-2">
                    {grants.map((g) => {
                      const asset = TOKEN_ASSETS.find(
                        (a) => a.symbol === g.symbol,
                      );
                      if (!asset) return null;
                      return (
                        <div
                          key={g.symbol}
                          className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-2"
                        >
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={g.enabled}
                              onChange={(e) =>
                                updateGrant(g.symbol, {
                                  enabled: e.target.checked,
                                })
                              }
                              disabled={isBusy}
                              className="accent-blue-600"
                            />
                            <span className="text-sm font-medium">
                              {asset.symbol}
                            </span>
                            <span className="text-xs text-zinc-500">
                              ({asset.kind === "native"
                                ? "native"
                                : `${shorten(asset.address ?? "")}, ${asset.decimals} dec`})
                            </span>
                          </label>

                          {g.enabled && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="text-xs text-zinc-500">
                                  Cap per tx ({asset.symbol})
                                </label>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={g.capDisplay}
                                  onChange={(e) =>
                                    updateGrant(g.symbol, {
                                      capDisplay: e.target.value,
                                    })
                                  }
                                  disabled={isBusy}
                                  className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-zinc-500">
                                  Recipient
                                  {asset.kind === "native"
                                    ? " (required)"
                                    : " (optional — blank = any)"}
                                </label>
                                <input
                                  type="text"
                                  placeholder="0x…"
                                  value={g.recipient ?? ""}
                                  onChange={(e) =>
                                    updateGrant(g.symbol, {
                                      recipient: e.target.value,
                                    })
                                  }
                                  disabled={isBusy}
                                  className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-zinc-500">
                    Caps and recipients are enforced on-chain by the Kernel{" "}
                    <code className="text-zinc-400">CallPolicy</code>. For
                    ERC-20, providing a recipient adds a{" "}
                    <code className="text-zinc-400">ParamCondition.EQUAL</code>{" "}
                    on the first arg of{" "}
                    <code className="text-zinc-400">transfer(address,uint256)</code>;
                    leaving it blank allows any recipient. ETH uses{" "}
                    <code className="text-zinc-400">target = recipient</code> +{" "}
                    <code className="text-zinc-400">valueLimit</code>.
                  </p>
                </div>

                <button
                  onClick={() =>
                    handleGrantSessionKey(delegateAddrInput.trim(), grants)
                  }
                  disabled={
                    !delegateAddrInput.trim() ||
                    isBusy ||
                    !grants.some((g) => g.enabled)
                  }
                  className="w-full py-3 px-4 rounded-xl bg-blue-700 hover:bg-blue-600 text-white font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-sm"
                >
                  {step === "granting"
                    ? "Building & signing session key…"
                    : "Build Session Key (off-chain)"}
                </button>

                <button
                  onClick={handleDisconnect}
                  className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded"
                >
                  Disconnect
                </button>
              </div>
            )}

            {account && step === "ready" && serializedSessionKey && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                  Session key built — share with delegate
                </div>

                <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-zinc-500 shrink-0">Kernel SA</span>
                    <span className="font-mono text-zinc-200 break-all text-right">
                      {ownerKernelAddress ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-2 border-t border-zinc-800 pt-1.5">
                    <span className="text-zinc-500 shrink-0">Delegate</span>
                    <span className="font-mono text-orange-400 break-all text-right">
                      {delegateAddrInput || "—"}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider">
                    Serialized session key (paste into Delegate tab)
                  </p>
                  <textarea
                    readOnly
                    value={serializedSessionKey}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-mono resize-none break-all"
                  />
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(serializedSessionKey)
                    }
                    className="text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-3 py-1 rounded"
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
            )}
          </div>
        </div>
      )}

      {/* ── Delegate ──────────────────────────────────────────────────────── */}
      {role === "delegate" && (
        <div className="space-y-4">
          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Step 1 — Paste the session key from the Owner
            </p>
            <textarea
              placeholder="Serialized session key…"
              value={serializedInput}
              onChange={(e) => setSerializedInput(e.target.value)}
              disabled={!!delegateKernelAddress}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono resize-none disabled:opacity-50"
            />
            <p className="text-xs text-zinc-500">
              Auto-filled if the Owner built it in this browser.
            </p>
          </div>

          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              Step 2 — Connect as Delegate / 経費担当
            </p>
            <p className="text-xs text-zinc-500">
              Your Google identity must produce the same EOA the Owner
              registered, or the session key&apos;s validator will reject signing.
            </p>

            {delegateKernelAddress ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                  Linked — Kernel client ready
                </div>
                <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-zinc-500 shrink-0">
                      Your EOA (session key)
                    </span>
                    <span className="font-mono text-zinc-400 break-all text-right">
                      {account?.address ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-2 border-t border-zinc-800 pt-1.5">
                    <span className="text-zinc-500 shrink-0">Executing on</span>
                    <span className="font-mono text-zinc-200 break-all text-right">
                      {delegateKernelAddress}
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
                    res.credential &&
                    handleDelegateConnect(
                      res.credential,
                      serializedInput.trim(),
                    )
                  }
                  onError={() => {}}
                  theme="filled_black"
                  shape="rectangular"
                  size="medium"
                />
                {step === "connecting" && (
                  <p className="text-xs text-zinc-400">Connecting wallet…</p>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Execute */}
          {delegateKernelAddress && (
            <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Step 3 — Execute Transfer via Session Key
              </p>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500 uppercase tracking-wider">
                  Asset
                </label>
                <div className="flex gap-2 flex-wrap">
                  {TOKEN_ASSETS.map((a) => (
                    <button
                      key={a.symbol}
                      type="button"
                      onClick={() => {
                        setExecAssetSymbol(a.symbol);
                        setExecAmount(DEFAULT_AMOUNT_CAPS[a.symbol] ?? "0");
                      }}
                      disabled={isBusy || step === "done"}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                        execAssetSymbol === a.symbol
                          ? "bg-orange-700 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {a.symbol}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-500">
                  Must be one of the assets the Owner included in the grant —
                  otherwise the CallPolicy reverts on-chain.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500 uppercase tracking-wider">
                  Recipient
                </label>
                <input
                  type="text"
                  placeholder="0x…"
                  value={execRecipient}
                  onChange={(e) => setExecRecipient(e.target.value)}
                  disabled={isBusy || step === "done"}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                />
                <p className="text-xs text-zinc-500">
                  Must match the recipient the Owner registered in the grant
                  (if any was set). ERC-20 recipients are enforced when the
                  Owner provided one; otherwise any recipient is allowed.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500 uppercase tracking-wider">
                  Amount ({execAsset.symbol})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={execAmount}
                  onChange={(e) => setExecAmount(e.target.value)}
                  disabled={isBusy || step === "done"}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                />
                <p className="text-xs text-zinc-500">
                  Exceeding the cap configured by the Owner will revert.
                </p>
              </div>

              {execTxHash && (
                <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-xs space-y-1.5">
                  <p className="font-medium">
                    Transfer executed via session key (Kernel)!
                  </p>
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
                </div>
              )}

              <button
                onClick={() =>
                  executeTransfer(
                    execRecipient.trim(),
                    execAsset,
                    execAmount.trim(),
                  )
                }
                disabled={
                  !execRecipient.trim() ||
                  !execAmount.trim() ||
                  isBusy ||
                  step === "done"
                }
                className="w-full py-3 px-4 rounded-xl bg-orange-700 hover:bg-orange-600 text-white font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-sm"
              >
                {step === "executing"
                  ? "Executing UserOp…"
                  : step === "done"
                  ? "Transfer Done"
                  : `Send ${execAmount || "0"} ${execAsset.symbol}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Suppress unused-import warning when ZERODEV_OWNER_ADDR_KEY is reserved for
// future cross-tab handoff.
void ZERODEV_OWNER_ADDR_KEY;
