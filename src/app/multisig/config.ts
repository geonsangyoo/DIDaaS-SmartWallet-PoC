import type { Role } from "./types";

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

// ThirdWeb RPC — Growth plan endpoint, no external API key needed
const THIRDWEB_CLIENT_ID = process.env.NEXT_PUBLIC_TEMPLATE_CLIENT_ID;
export const RPC_URL = THIRDWEB_CLIENT_ID
  ? `https://11155111.rpc.thirdweb.com/${THIRDWEB_CLIENT_ID}`
  : "https://ethereum-sepolia-rpc.publicnode.com";

export const TX_SERVICE = "https://safe-transaction-sepolia.safe.global";

// Free API key from https://developer.safe.global — required for POST operations
// because safe-transaction-sepolia.safe.global now redirects to api.safe.global
// which requires authentication. Without a key, propose/confirm return 404.
export const SAFE_API_KEY = process.env.NEXT_PUBLIC_SAFE_API_KEY || "";

// Optional: set this to a pre-deployed Safe address (created via app.safe.global).
// When set, skips counterfactual address derivation and the "Deploy Safe" step.
export const EXPLICIT_SAFE_ADDRESS =
  (process.env.NEXT_PUBLIC_SAFE_ADDRESS || "").toLowerCase();

// Safe owner EOA addresses — public values, not secrets.
// Each person logs in with their Google account once; copy the shown
// ThirdWeb wallet address into NEXT_PUBLIC_*_ADDRESS in .env.local.
// Keep addresses as-is (env vars should be EIP-55 checksummed).
// Safe TX Service v2 rejects lowercase addresses with 422.
export const OWNER_ADDRESSES = {
  employee: process.env.NEXT_PUBLIC_EMPLOYEE_ADDRESS || "",
  admin1:   process.env.NEXT_PUBLIC_ADMIN1_ADDRESS   || "",
  admin2:   process.env.NEXT_PUBLIC_ADMIN2_ADDRESS   || "",
};

// Deterministic Safe address (derived from owners + threshold + saltNonce).
// owners must be mutable string[] for Safe SDK.
export const SAFE_OPTIONS = {
  owners: [
    OWNER_ADDRESSES.employee,
    OWNER_ADDRESSES.admin1,
    OWNER_ADDRESSES.admin2,
  ] as string[],
  threshold: 3,
  saltNonce: "0",
};

export const ROLE_CONFIG: Record<
  Role,
  { labelJa: string; label: string; step: string; color: string }
> = {
  employee: { labelJa: "社員",     label: "Employee",   step: "①", color: "blue"  },
  admin1:   { labelJa: "上長",     label: "Manager",    step: "②", color: "amber" },
  admin2:   { labelJa: "経理担当", label: "Accounting", step: "③", color: "green" },
};

export const RING: Record<string, string> = {
  blue:  "border-blue-500  bg-blue-500/10  text-blue-400",
  amber: "border-amber-500 bg-amber-500/10 text-amber-400",
  green: "border-green-500 bg-green-500/10 text-green-400",
};

export const BTN: Record<string, string> = {
  blue:  "bg-blue-600  hover:bg-blue-500",
  amber: "bg-amber-600 hover:bg-amber-500",
  green: "bg-green-600 hover:bg-green-500",
};

export function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function weiToEth(wei: string): string {
  if (!wei || wei === "0") return "0";
  return (Number(BigInt(wei)) / 1e18).toFixed(6);
}

export function detectRole(address: string): Role | null {
  const addr = address.toLowerCase();
  for (const [role, ownerAddr] of Object.entries(OWNER_ADDRESSES)) {
    if (ownerAddr && addr === ownerAddr.toLowerCase()) return role as Role;
  }
  return null;
}

export function getOwnerLabel(addr: string): string {
  const a = addr.toLowerCase();
  for (const [r, ownerAddr] of Object.entries(OWNER_ADDRESSES)) {
    if (ownerAddr && a === ownerAddr.toLowerCase()) return ROLE_CONFIG[r as Role].labelJa;
  }
  return shorten(addr);
}
