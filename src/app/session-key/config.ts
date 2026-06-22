// ── Session Key Scenario Config ───────────────────────────────────────────────
//
// Scenario:
//   Owner    (社員)      — Google login, grants session key to Delegate
//   Delegate (経費担当)  — Google login, executes Tx on Owner's Smart Account
//   Recipient (上長)     — receives the test transfer (ETH or ERC-20)
//
// Required env vars (add to .env.local):
//   NEXT_PUBLIC_SESSION_KEY_DELEGATE_ADDRESS  — Delegate's inAppWallet EOA
//   NEXT_PUBLIC_SESSION_KEY_TEST_RECIPIENT    — Recipient address (上長)
//   NEXT_PUBLIC_SESSION_KEY_TEST_AMOUNT       — amount in ETH (default: "0.001")
//
// Optional ERC-20 token contracts (Sepolia). When set, they appear in the
// asset selector so the Owner can grant the session key for that token and
// the Delegate can transfer it via the session key.
//   NEXT_PUBLIC_SESSION_KEY_JPYC_ADDRESS      — JPYC contract address
//   NEXT_PUBLIC_SESSION_KEY_USDC_ADDRESS      — USDC contract address

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export const DELEGATE_ADDRESS =
  process.env.NEXT_PUBLIC_SESSION_KEY_DELEGATE_ADDRESS || "";

export const RECIPIENT_ADDRESS =
  process.env.NEXT_PUBLIC_SESSION_KEY_TEST_RECIPIENT || "";

export const AMOUNT_DISPLAY =
  process.env.NEXT_PUBLIC_SESSION_KEY_TEST_AMOUNT || "0.001";

const toWei = (eth: string) =>
  BigInt(Math.round(parseFloat(eth) * 1e18));

export const AMOUNT_WEI = toWei(AMOUNT_DISPLAY);

// Session key valid for 1 day
export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

// localStorage key for persisting owner's smart account address between roles
export const OWNER_ADDR_STORAGE_KEY = "sessionKey_ownerSmartAccountAddress";

// ── Asset registry ────────────────────────────────────────────────────────────
//
// "native" represents ETH (transferred directly, with the recipient as the
// approvedTarget). ERC-20 entries use the token contract as the approvedTarget;
// the AccountPermissions module then only checks that the call is to that
// contract — it cannot enforce per-token amount or recipient limits.

export type TokenAsset = {
  symbol: string;
  kind: "native" | "erc20";
  address: `0x${string}` | null;
  decimals: number;
};

const JPYC_ADDRESS = process.env.NEXT_PUBLIC_SESSION_KEY_JPYC_ADDRESS || "";
const USDC_ADDRESS = process.env.NEXT_PUBLIC_SESSION_KEY_USDC_ADDRESS || "";

export const NATIVE_ASSET: TokenAsset = {
  symbol: "ETH",
  kind: "native",
  address: null,
  decimals: 18,
};

export const TOKEN_ASSETS: TokenAsset[] = [
  NATIVE_ASSET,
  ...(JPYC_ADDRESS
    ? [
        {
          symbol: "JPYC",
          kind: "erc20" as const,
          address: JPYC_ADDRESS as `0x${string}`,
          decimals: 18,
        },
      ]
    : []),
  ...(USDC_ADDRESS
    ? [
        {
          symbol: "USDC",
          kind: "erc20" as const,
          address: USDC_ADDRESS as `0x${string}`,
          decimals: 6,
        },
      ]
    : []),
];

export function getAssetBySymbol(symbol: string): TokenAsset {
  return TOKEN_ASSETS.find((a) => a.symbol === symbol) ?? NATIVE_ASSET;
}

// ── Backend selector ──────────────────────────────────────────────────────────
export type Backend = "thirdweb" | "zerodev";

// ── ZeroDev / Kernel (ERC-7579 modular account) ──────────────────────────────
//
// Required env var:
//   NEXT_PUBLIC_ZERODEV_PROJECT_ID — get one at https://dashboard.zerodev.app
//
// We use ZeroDev only for the Kernel session-key plugin/policy — the bundler
// + paymaster both stay on Thirdweb (see below). The session-key validator is
// a smart-contract module installed on the Kernel account, so any compliant
// ERC-4337 bundler can submit UserOps signed by it; ZERODEV_RPC_URL is kept
// only as a reference for ZeroDev's own infrastructure.

export const ZERODEV_PROJECT_ID =
  process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID || "";
export const ZERODEV_CONFIGURED = !!ZERODEV_PROJECT_ID;

const SEPOLIA_CHAIN_ID = 11155111;
export const ZERODEV_RPC_URL = ZERODEV_PROJECT_ID
  ? `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${SEPOLIA_CHAIN_ID}`
  : "";

// ── Thirdweb bundler + paymaster (used for ZeroDev/Kernel UserOps) ───────────
//
// Thirdweb's bundler endpoint also serves the standard ERC-7677 paymaster
// methods, so a single transport covers both `bundlerTransport` and
// `paymaster` on the Kernel account client. The public client ID is sent as
// the `x-client-id` header.
export const THIRDWEB_CLIENT_ID =
  process.env.NEXT_PUBLIC_TEMPLATE_CLIENT_ID || "";
export const THIRDWEB_BUNDLER_URL = `https://${SEPOLIA_CHAIN_ID}.bundler.thirdweb.com/v2`;

// Default per-asset amount caps shown in the Owner grant UI for the ZeroDev
// backend. Display units (e.g. "0.001" ETH, "10000" JPYC).
export const DEFAULT_AMOUNT_CAPS: Record<string, string> = {
  ETH: AMOUNT_DISPLAY,
  JPYC: "10000",
  USDC: "100",
};

// localStorage keys for the ZeroDev flow
export const ZERODEV_OWNER_ADDR_KEY =
  "sessionKey_zerodev_ownerKernelAddress";
export const ZERODEV_SERIALIZED_KEY = "sessionKey_zerodev_serialized";
export const ZERODEV_REMOTE_SIGNER_KEY = "sessionKey_zerodev_remoteSignerAddress";
export const ZERODEV_REGISTERED_KEY = "sessionKey_zerodev_registered";
