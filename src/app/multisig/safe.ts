import type { WalletClient } from "viem";
import { createPublicClient, http } from "viem";
import { sepolia as sepoliaViem } from "viem/chains";
import type { SafeTransaction } from "./types";
import { TX_SERVICE, RPC_URL, SAFE_OPTIONS, EXPLICIT_SAFE_ADDRESS, SAFE_API_KEY } from "./config";

// safeConfig() returns either safeAddress (explicit) or safeOptions (counterfactual).
// Using a pre-deployed address skips address derivation and the deploy step.
function safeConfig(): { safeAddress: string } | { safeOptions: typeof SAFE_OPTIONS } {
  return EXPLICIT_SAFE_ADDRESS
    ? { safeAddress: EXPLICIT_SAFE_ADDRESS }
    : { safeOptions: SAFE_OPTIONS };
}

// Fetch pending (and executed) multi-sig transactions from the public
// Safe Transaction Service — no API key required for Sepolia.
export async function fetchPendingTxs(
  safeAddress: string
): Promise<SafeTransaction[]> {
  const res = await fetch(
    `${TX_SERVICE}/api/v1/safes/${safeAddress}/multisig-transactions/?limit=20`
  );
  if (!res.ok) throw new Error("Failed to fetch pending transactions");
  const data = await res.json();
  return data.results as SafeTransaction[];
}

// Check whether the Safe is registered in the Safe Transaction Service.
// A 200 from GET /safes/{address}/ means it's deployed and indexed — i.e.
// it can accept transaction proposals.
export async function isSafeRegistered(safeAddress: string): Promise<boolean> {
  try {
    const res = await fetch(`${TX_SERVICE}/api/v1/safes/${safeAddress}/`);
    return res.ok;
  } catch {
    return false;
  }
}

// txServiceConfig: when SAFE_API_KEY is set the SDK calls api.safe.global directly
// (no redirect). Without it, it falls back to the legacy URL which now redirects
// to api.safe.global and returns 404 on POST without authentication.
function txServiceConfig() {
  return SAFE_API_KEY
    ? { apiKey: SAFE_API_KEY }
    : { txServiceUrl: TX_SERVICE };
}

// Build a Safe client for signing operations.
// walletClient is used as an EIP-1193 provider (handles RPC + eth_signTypedData_v4).
// signerAddress tells Safe SDK which account to sign with; Safe SDK then calls
// eth_signTypedData_v4(signerAddress, ...) through the provider — no private key needed.
export async function buildSafeClient(walletClient: WalletClient, signerAddress: string) {
  const { createSafeClient } = await import("@safe-global/sdk-starter-kit");
  return createSafeClient({
    provider: walletClient as any,
    signer: signerAddress,
    ...txServiceConfig(),
    ...safeConfig(),
  });
}

// Build a read-only Safe client (no signer) to derive the Safe address
// and read pending transactions without a connected wallet.
export async function buildReadOnlySafeClient() {
  const { createSafeClient } = await import("@safe-global/sdk-starter-kit");
  return createSafeClient({
    provider: RPC_URL,
    ...txServiceConfig(),
    ...safeConfig(),
  });
}

// Deploy the Safe on-chain via the SafeProxyFactory.
// This is a regular Ethereum transaction (not a Safe multi-sig TX), so any
// owner can pay gas once. Waits for the tx to be mined before returning.
export async function deploySafe(walletClient: WalletClient, signerAddress: string): Promise<string> {
  const safeClient = await buildSafeClient(walletClient, signerAddress);
  const deploymentTx = await safeClient.protocolKit.createSafeDeploymentTransaction();

  const txHash = await walletClient.sendTransaction({
    account: signerAddress as `0x${string}`,
    to: deploymentTx.to as `0x${string}`,
    value: BigInt(deploymentTx.value || "0"),
    data: deploymentTx.data as `0x${string}`,
    chain: sepoliaViem,
  });

  // Wait for the deployment to be mined before the caller refreshes.
  // Without this, isSafeRegistered() still returns false immediately after send.
  const publicClient = createPublicClient({
    chain: sepoliaViem,
    transport: http(RPC_URL),
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

  return txHash;
}
