"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import { inAppWallet, preAuthenticate } from "thirdweb/wallets";
import { sepolia } from "thirdweb/chains";
import { useConnect, useActiveWallet, useDisconnect, useActiveAccount } from "thirdweb/react";
import { client } from "./client";

const IN_APP_WALLET_BASE_URL = "https://embedded-wallet.thirdweb.com";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── SMS OTP state ──────────────────────────────────────────────────────────
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const [showExportKey, setShowExportKey] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);

  const { connect } = useConnect();
  const activeWallet = useActiveWallet();
  const account = useActiveAccount();
  const { disconnect } = useDisconnect();

  // ── Private key export via Thirdweb iframe ────────────────────────────────
  useEffect(() => {
    if (!showExportKey) return;

    const handleMessage = async (e: MessageEvent<{ eventType: string }>) => {
      if (
        typeof e.data !== "object" ||
        !("eventType" in e.data) ||
        e.origin !== IN_APP_WALLET_BASE_URL
      ) return;

      if (e.data.eventType === "exportPrivateKeyIframeLoaded") {
        const iframe = document.getElementById("export-private-key-iframe") as HTMLIFrameElement | null;
        if (!iframe?.contentWindow || !activeWallet) return;

        const wallet = activeWallet as typeof activeWallet & { getAuthToken?: () => string | null };
        const authToken = wallet.getAuthToken?.() ?? null;

        iframe.contentWindow.postMessage(
          { authToken, eventType: "initExportPrivateKey" },
          e.origin,
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [showExportKey, activeWallet]);

  // ── Strategy: jwt ─────────────────────────────────────────────────────────────
  // googleIdToken  = signed by Google's private key (proves the user authenticated with Google)
  // customJwt      = signed by OUR private key      (what thirdweb verifies against our JWKS)
  const handleGoogleSuccessJwt = async (googleIdToken: string) => {
    setLoading(true);
    setError(null);
    try {
      // Step 1: exchange the Google ID token for a JWT signed by our own private key
      const res = await fetch(`${BACKEND_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: googleIdToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to obtain JWT from backend");
      }
      const { jwt } = (await res.json()) as { jwt: string };

      // Step 2: pass our custom JWT to thirdweb
      //         thirdweb verifies it against our /.well-known/jwks.json
      await connect(async () => {
        const wallet = inAppWallet({
          executionMode: {
            mode: "EIP4337",
            smartAccount: { chain: sepolia, sponsorGas: true },
          },  
        });
        await wallet.connect({ client, strategy: "jwt", jwt });
        return wallet;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Strategy: phone (SMS OTP) ─────────────────────────────────────────────
  const handleSendOtp = async () => {
    setLoading(true);
    setError(null);
    try {
      await preAuthenticate({ client, strategy: "phone", phoneNumber });
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await connect(async () => {
        const wallet = inAppWallet({
          executionMode: {
            mode: "EIP4337",
            smartAccount: { chain: sepolia, sponsorGas: true },
          },  
        });
        await wallet.connect({ client, strategy: "phone", phoneNumber, verificationCode: otpCode });
        return wallet;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Strategy: auth_endpoint ────────────────────────────────────────────────
  // The Google ID token is passed directly as the payload.
  // ThirdWeb POSTs { payload } to our backend /auth/verify-payload endpoint,
  // which verifies the Google token and returns { userId, email }.
  const handleGoogleSuccessAuthEndpoint = async (googleIdToken: string) => {
    setLoading(true);
    setError(null);
    try {
      await connect(async () => {
        const wallet = inAppWallet();
        await wallet.connect({
          client,
          strategy: "auth_endpoint",
          payload: googleIdToken,
        });
        return wallet;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  if (account) {
    return (
      <main className="p-4 pb-10 min-h-[100vh] flex items-center justify-center container max-w-screen-lg mx-auto">
        <div className="flex flex-col items-center gap-6 py-20 text-center">
          <h1 className="text-3xl font-bold text-zinc-100">Smart Wallet Connected</h1>

          <div className="border border-zinc-700 rounded-lg p-4 bg-zinc-900 max-w-sm w-full">
            <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Wallet Address</p>
            <p className="text-sm font-mono text-zinc-200 break-all">{account.address}</p>
          </div>

          <button
            onClick={() => { setIframeLoading(true); setShowExportKey(true); }}
            className="px-6 py-2 rounded-lg border border-yellow-700 text-yellow-300 hover:bg-yellow-900/30 transition-colors text-sm"
          >
            Export Private Key
          </button>

          <button
            onClick={() => activeWallet && disconnect(activeWallet)}
            className="px-6 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
          >
            Disconnect
          </button>
        </div>

        {/* Export Private Key Modal */}
        {showExportKey && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            onClick={(e) => { if (e.target === e.currentTarget) setShowExportKey(false); }}
          >
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-sm mx-4 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700">
                <h2 className="text-sm font-medium text-zinc-200">Export Private Key</h2>
                <button
                  onClick={() => setShowExportKey(false)}
                  className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
                >
                  ×
                </button>
              </div>
              <div className="relative" style={{ height: 280 }}>
                {iframeLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                  </div>
                )}
                <iframe
                  allow="clipboard-read; clipboard-write"
                  id="export-private-key-iframe"
                  onLoad={() => setIframeLoading(false)}
                  src={`${IN_APP_WALLET_BASE_URL}/sdk/2022-08-12/embedded-wallet/export-private-key?clientId=${client.clientId}&theme=dark`}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "none",
                    visibility: iframeLoading ? "hidden" : "visible",
                  }}
                  title="Export Private Key"
                />
              </div>
              <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-950/60 text-left space-y-2">
                <p className="text-xs font-medium text-yellow-400">How to import into MetaMask</p>
                <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-1">
                  <li>Open MetaMask → top-right menu → <span className="text-zinc-200">Import Account</span></li>
                  <li>Select type: <span className="text-zinc-200">Private Key</span> (not Secret Recovery Phrase)</li>
                  <li>Paste the key copied above and click Import</li>
                </ol>
                <p className="text-xs text-zinc-500 pt-1">
                  Note: this key controls the underlying EOA signer, whose address differs from the smart account address shown above.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="p-4 pb-10 min-h-[100vh] flex items-center justify-center container max-w-screen-lg mx-auto">
      <div className="flex flex-col items-center gap-8 py-20 text-center">
        <h1 className="text-4xl font-bold text-zinc-100">DIDaaS Smart Wallet</h1>

          <Link
            href="/multisig"
            className="w-full max-w-sm py-2 px-4 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500 transition-colors text-sm text-center"
          >
            Multi-Sig PoC (交通費精算) →
          </Link>

          <Link
            href="/batch"
            className="w-full max-w-sm py-2 px-4 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500 transition-colors text-sm text-center"
          >
            Batch Tx Verification (バッチトランザクション検証) →
          </Link>

          <Link
            href="/recovery"
            className="w-full max-w-sm py-2 px-4 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500 transition-colors text-sm text-center"
          >
            Social Recovery / Guardian (鍵紛失からの復旧) →
          </Link>

        {error && (
          <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-4 py-2 w-full max-w-sm">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-zinc-400 text-sm">Connecting wallet…</p>
        ) : (
          <div className="flex flex-col gap-6 w-full max-w-sm">
            {/* Strategy: phone — ThirdWeb sends SMS OTP, no backend required */}
            <div className="border border-zinc-800 rounded-xl p-6 bg-zinc-900/50 flex flex-col items-center gap-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Strategy: phone (SMS OTP)</p>
              {!otpSent ? (
                <>
                  <input
                    type="tel"
                    placeholder="+81 90-1234-5678"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    onClick={handleSendOtp}
                    disabled={loading || !phoneNumber}
                    className="w-full py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 text-sm transition-colors"
                  >
                    Send OTP
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-zinc-400">OTP sent to {phoneNumber}</p>
                  <input
                    type="text"
                    placeholder="Enter OTP code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    onClick={handlePhoneConnect}
                    disabled={loading || !otpCode}
                    className="w-full py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 text-sm transition-colors"
                  >
                    Verify &amp; Connect
                  </button>
                  <button
                    onClick={() => { setOtpSent(false); setOtpCode(""); }}
                    className="text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                  >
                    Change number
                  </button>
                </>
              )}
            </div>

            {/* Strategy: jwt — frontend exchanges Google token for our custom JWT */}
            <div className="border border-zinc-800 rounded-xl p-6 bg-zinc-900/50 flex flex-col items-center gap-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Strategy: jwt (OIDC)</p>
              <GoogleLogin
                onSuccess={(res) => res.credential && handleGoogleSuccessJwt(res.credential)}
                onError={() => setError("Google sign-in failed")}
                theme="filled_black"
                shape="rectangular"
                size="large"
              />
            </div>

            {/* Strategy: auth_endpoint — ThirdWeb calls our backend to verify the payload */}
            <div className="border border-zinc-800 rounded-xl p-6 bg-zinc-900/50 flex flex-col items-center gap-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Strategy: auth_endpoint</p>
              <GoogleLogin
                onSuccess={(res) => res.credential && handleGoogleSuccessAuthEndpoint(res.credential)}
                onError={() => setError("Google sign-in failed")}
                theme="filled_black"
                shape="rectangular"
                size="large"
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
