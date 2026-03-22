"use client";

import { useState } from "react";
import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import { inAppWallet } from "thirdweb/wallets";
import { useConnect, useActiveWallet, useDisconnect, useActiveAccount } from "thirdweb/react";
import { client } from "./client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { connect } = useConnect();
  const activeWallet = useActiveWallet();
  const account = useActiveAccount();
  const { disconnect } = useDisconnect();

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
        const wallet = inAppWallet();
        await wallet.connect({ client, strategy: "jwt", jwt });
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
            onClick={() => activeWallet && disconnect(activeWallet)}
            className="mt-4 px-6 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
          >
            Disconnect
          </button>
        </div>
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

        {error && (
          <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-4 py-2 w-full max-w-sm">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-zinc-400 text-sm">Connecting wallet…</p>
        ) : (
          <div className="flex flex-col gap-6 w-full max-w-sm">
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
