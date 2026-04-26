// ── Session Key Scenario Config ───────────────────────────────────────────────
//
// Scenario:
//   Owner    (社員)      — Google login, grants session key to Delegate
//   Delegate (経費担当)  — Google login, executes Tx on Owner's Smart Account
//   Recipient (上長)     — receives the test ETH transfer
//
// Required env vars (add to .env.local):
//   NEXT_PUBLIC_SESSION_KEY_DELEGATE_ADDRESS  — Delegate's inAppWallet EOA
//   NEXT_PUBLIC_SESSION_KEY_TEST_RECIPIENT    — Recipient address (上長)
//   NEXT_PUBLIC_SESSION_KEY_TEST_AMOUNT       — amount in ETH (default: "0.001")

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
