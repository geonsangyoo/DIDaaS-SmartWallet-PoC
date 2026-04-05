// ── Batch Transaction Verification Config ────────────────────────────────────
//
// Scenario: two ETH transfers batched into a single ERC-4337 UserOperation.
//
//   tx1 — SmartWallet sends ETH_AMOUNT_1 to BATCH_RECIPIENT_1
//   tx2 — SmartWallet sends ETH_AMOUNT_2 to BATCH_RECIPIENT_2
//
// Both are packed into a single ERC-4337 UserOperation via sendBatch(),
// proving they execute atomically (one on-chain transaction, one UserOp hash).
//
// Required env vars (add to .env.local):
//   NEXT_PUBLIC_BATCH_RECIPIENT_1    — first ETH recipient address
//   NEXT_PUBLIC_BATCH_RECIPIENT_2    — second ETH recipient address
//   NEXT_PUBLIC_BATCH_AMOUNT_1       — amount in ETH, e.g. "0.001"  (default: "0.001")
//   NEXT_PUBLIC_BATCH_AMOUNT_2       — amount in ETH, e.g. "0.001"  (default: "0.001")

export const BATCH_RECIPIENT_1 =
  process.env.NEXT_PUBLIC_BATCH_RECIPIENT_1 || "";
export const BATCH_RECIPIENT_2 =
  process.env.NEXT_PUBLIC_BATCH_RECIPIENT_2 || "";

// ETH amounts in wei (18 decimals). Default: 0.001 ETH each.
const toWei = (eth: string) =>
  BigInt(Math.round(parseFloat(eth) * 1e18));

export const BATCH_AMOUNT_1 = toWei(
  process.env.NEXT_PUBLIC_BATCH_AMOUNT_1 || "0.001"
);
export const BATCH_AMOUNT_2 = toWei(
  process.env.NEXT_PUBLIC_BATCH_AMOUNT_2 || "0.001"
);

export const BATCH_AMOUNT_1_DISPLAY =
  process.env.NEXT_PUBLIC_BATCH_AMOUNT_1 || "0.001";
export const BATCH_AMOUNT_2_DISPLAY =
  process.env.NEXT_PUBLIC_BATCH_AMOUNT_2 || "0.001";
