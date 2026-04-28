"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GoogleLogin } from "@react-oauth/google";
import { inAppWallet, preAuthenticate } from "thirdweb/wallets";
import { sepolia } from "thirdweb/chains";
import { useConnect, useActiveWallet, useDisconnect, useActiveAccount } from "thirdweb/react";
import { client } from "./client";
import { createWalletClient, createPublicClient, http, encodeFunctionData, parseEther, parseUnits } from "viem";
import { privateKeyToAccount as viemPrivateKeyToAccount } from "viem/accounts";
import { sepolia as viemSepolia } from "viem/chains";

const IN_APP_WALLET_BASE_URL = "https://embedded-wallet.thirdweb.com";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

// Explicit non-Thirdweb RPC for the direct-execute feature.
// viem's built-in sepolia default resolves to 11155111.rpc.thirdweb.com, so we
// always pass an explicit URL here. Override via NEXT_PUBLIC_SEPOLIA_RPC_URL.
const DEFAULT_SEPOLIA_RPC =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://rpc.ankr.com/eth_sepolia";

// Well-known free public Sepolia RPCs (no API key required).
// Ranked roughly by reliability/latency.
const SEPOLIA_RPC_PRESETS = [
  { label: "Ankr",       url: "https://rpc.ankr.com/eth_sepolia" },
  { label: "PublicNode", url: "https://ethereum-sepolia-rpc.publicnode.com" },
  { label: "Tenderly",   url: "https://sepolia.gateway.tenderly.co" },
  { label: "1RPC",       url: "https://1rpc.io/sepolia" },
] as const;

// Minimal ABI for Thirdweb BaseAccount: admin can call execute/executeBatch directly,
// bypassing ERC-4337 EntryPoint entirely. Gas is paid by the admin EOA.
const SCW_EXECUTE_ABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_target", type: "address" },
      { name: "_value", type: "uint256" },
      { name: "_data",  type: "bytes"    },
    ],
    outputs: [],
  },
  {
    name: "executeBatch",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_target", type: "address[]" },
      { name: "_value",  type: "uint256[]" },
      { name: "_data",   type: "bytes[]"   },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount",    type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── SMS OTP state ──────────────────────────────────────────────────────────
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const [showExportKey, setShowExportKey] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);

  // ── Move assets: admin EOA private key → direct SCW execute (no ERC-4337) ─
  const [pkInput, setPkInput] = useState("");
  const [showPk, setShowPk] = useState(false);
  const [moveScwAddr, setMoveScwAddr] = useState("");
  const [moveAssetType, setMoveAssetType] = useState<"eth" | "erc20">("eth");
  const [moveTokenAddr, setMoveTokenAddr] = useState("");
  const [moveTokenDecimals, setMoveTokenDecimals] = useState(18);
  const [moveDestAddr, setMoveDestAddr] = useState("");
  const [moveAmount, setMoveAmount] = useState("0.001");
  const [moveRpcUrl, setMoveRpcUrl] = useState(DEFAULT_SEPOLIA_RPC);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveTxHash, setMoveTxHash] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

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

  // ── Strategy: jwt + EIP-7702 ──────────────────────────────────────────────
  // Same JWT exchange as above, but the inAppWallet runs in EIP-7702 mode.
  // The smart account address equals the EOA address (no separate contract).
  const handleGoogleSuccessEIP7702 = async (googleIdToken: string) => {
    setLoading(true);
    setError(null);
    try {
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

      await connect(async () => {
        const wallet = inAppWallet({
          executionMode: {
            mode: "EIP7702",
            sponsorGas: true,
          },
        });
        await wallet.connect({ client, strategy: "jwt", jwt, chain: sepolia });
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

  // ── Move assets: admin EOA → SCW.execute() directly (no ERC-4337 bundler) ──
  //
  // Thirdweb's BaseAccount allows the admin EOA to call execute/executeBatch
  // directly on the SCW contract, bypassing EntryPoint entirely.
  // Gas is paid by the admin EOA in native token.
  const handleMoveAsset = async () => {
    const isErc20 = moveAssetType === "erc20";
    if (!pkInput || !moveScwAddr || !moveDestAddr || !moveAmount) return;
    if (isErc20 && !moveTokenAddr) return;

    setMoveLoading(true);
    setMoveError(null);
    setMoveTxHash(null);
    try {
      const normalizedPk = (pkInput.startsWith("0x") ? pkInput : `0x${pkInput}`) as `0x${string}`;
      const adminAccount = viemPrivateKeyToAccount(normalizedPk);

      const transport = http(moveRpcUrl);
      const publicClient = createPublicClient({ chain: viemSepolia, transport });
      const walletClient = createWalletClient({ account: adminAccount, chain: viemSepolia, transport });

      let target: `0x${string}`;
      let value: bigint;
      let data: `0x${string}`;

      if (isErc20) {
        // Fetch decimals on-chain so the user doesn't have to know them
        const onChainDecimals = await publicClient.readContract({
          address: moveTokenAddr as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "decimals",
        });
        setMoveTokenDecimals(Number(onChainDecimals));
        const tokenAmount = parseUnits(moveAmount, Number(onChainDecimals));
        data = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [moveDestAddr as `0x${string}`, tokenAmount],
        });
        target = moveTokenAddr as `0x${string}`;
        value = 0n;
      } else {
        target = moveDestAddr as `0x${string}`;
        value = parseEther(moveAmount);
        data = "0x";
      }

      // Direct call to SCW.execute() — admin EOA signs a normal EOA tx
      const txHash = await walletClient.writeContract({
        address: moveScwAddr as `0x${string}`,
        abi: SCW_EXECUTE_ABI,
        functionName: "execute",
        args: [target, value, data],
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setMoveTxHash(txHash);
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setMoveLoading(false);
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

          <Link
            href="/session-key"
            className="w-full max-w-sm py-2 px-4 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500 transition-colors text-sm text-center"
          >
            Session Key (権限移譲・別クライアントTx実行) →
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

            {/* Strategy: jwt + EIP-7702 — EOA address IS the smart account address */}
            <div className="border border-purple-900/50 rounded-xl p-6 bg-zinc-900/50 flex flex-col items-center gap-3">
              <p className="text-xs text-purple-400 uppercase tracking-wider">Strategy: jwt + EIP-7702</p>
              <p className="text-xs text-zinc-500 text-center">
                EOA is upgraded in-place — smart account address equals the EOA address.
              </p>
              <GoogleLogin
                onSuccess={(res) => res.credential && handleGoogleSuccessEIP7702(res.credential)}
                onError={() => setError("Google sign-in failed")}
                theme="filled_black"
                shape="rectangular"
                size="large"
              />
            </div>

            {/* Direct SCW execute — admin EOA bypasses ERC-4337 bundler */}
            <div className="border border-teal-900/50 rounded-xl p-6 bg-zinc-900/50 flex flex-col gap-4">
              <p className="text-xs text-teal-400 uppercase tracking-wider text-center">
                Move Assets — Direct SCW Execute (No Bundler)
              </p>
              <p className="text-xs text-zinc-500 text-center">
                Admin EOA calls <code className="text-zinc-300 bg-zinc-800 px-1 rounded">execute()</code> directly
                on the SCW contract. No EntryPoint, no UserOp — gas paid by the admin EOA.
              </p>

              {/* RPC URL — explicit non-Thirdweb endpoint */}
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 block">RPC URL (Sepolia)</label>
                <div className="flex flex-wrap gap-1.5">
                  {SEPOLIA_RPC_PRESETS.map((p) => (
                    <button
                      key={p.url}
                      type="button"
                      onClick={() => setMoveRpcUrl(p.url)}
                      className={`px-2 py-1 rounded text-xs transition-colors ${
                        moveRpcUrl === p.url
                          ? "bg-teal-700 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={moveRpcUrl}
                  onChange={(e) => setMoveRpcUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                />
                <p className="text-xs text-zinc-600">
                  Override default via <code className="text-zinc-500">NEXT_PUBLIC_SEPOLIA_RPC_URL</code>
                </p>
              </div>

              {/* Private key */}
              <div className="relative">
                <input
                  type={showPk ? "text" : "password"}
                  placeholder="0xbfc… (exported in-app wallet private key)"
                  value={pkInput}
                  onChange={(e) => setPkInput(e.target.value)}
                  className="w-full px-3 py-2 pr-14 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPk((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-300 px-1"
                >
                  {showPk ? "Hide" : "Show"}
                </button>
              </div>

              {/* SCW address */}
              <input
                type="text"
                placeholder="SCW address (Smart Contract Wallet, 0x…)"
                value={moveScwAddr}
                onChange={(e) => setMoveScwAddr(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              />

              {/* Asset type toggle */}
              <div className="flex gap-2">
                {(["eth", "erc20"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMoveAssetType(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      moveAssetType === t
                        ? "bg-teal-700 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {t === "eth" ? "ETH" : "ERC-20 Token"}
                  </button>
                ))}
              </div>

              {/* ERC-20 token address */}
              {moveAssetType === "erc20" && (
                <input
                  type="text"
                  placeholder="Token contract address (0x…)"
                  value={moveTokenAddr}
                  onChange={(e) => setMoveTokenAddr(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                />
              )}

              {/* Destination */}
              <input
                type="text"
                placeholder="Destination address (0x…)"
                value={moveDestAddr}
                onChange={(e) => setMoveDestAddr(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              />

              {/* Amount */}
              <input
                type="number"
                placeholder={moveAssetType === "eth" ? "Amount (ETH)" : "Amount (token units)"}
                value={moveAmount}
                onChange={(e) => setMoveAmount(e.target.value)}
                min="0"
                step="0.001"
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              />

              {moveError && (
                <p className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded px-3 py-2 break-words">
                  {moveError}
                </p>
              )}

              {moveTxHash && (
                <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-zinc-500 shrink-0">From (SCW)</span>
                    <span className="font-mono text-zinc-300 break-all text-right">{moveScwAddr}</span>
                  </div>
                  {moveAssetType === "erc20" && (
                    <div className="flex justify-between border-t border-zinc-800 pt-1.5">
                      <span className="text-zinc-500">Decimals (auto)</span>
                      <span className="text-zinc-300">{moveTokenDecimals}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-start gap-2 border-t border-zinc-800 pt-1.5">
                    <span className="text-zinc-500 shrink-0">TX</span>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${moveTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-teal-400 underline break-all text-right"
                    >
                      {moveTxHash.slice(0, 10)}…{moveTxHash.slice(-8)}
                    </a>
                  </div>
                </div>
              )}

              <button
                onClick={handleMoveAsset}
                disabled={
                  moveLoading || !pkInput || !moveScwAddr || !moveDestAddr || !moveAmount ||
                  (moveAssetType === "erc20" && !moveTokenAddr)
                }
                className="w-full py-2 rounded-lg bg-teal-800 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-teal-100 text-sm transition-colors"
              >
                {moveLoading
                  ? "Waiting for confirmation…"
                  : `Move ${moveAssetType === "eth" ? "ETH" : "Token"} via SCW.execute()`}
              </button>

              <p className="text-xs text-zinc-600 text-center">
                Private key stays in the browser. Admin EOA needs Sepolia ETH for gas.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
