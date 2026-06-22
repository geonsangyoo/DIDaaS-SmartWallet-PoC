"use client";

import { useState } from "react";
import {
  useConnect,
  useActiveAccount,
  useDisconnect,
  useActiveWallet,
} from "thirdweb/react";
import { inAppWallet } from "thirdweb/wallets";
import { sepolia as twSepolia } from "thirdweb/chains";
import type { Account as TwAccount } from "thirdweb/wallets";

import { sepolia } from "viem/chains";
import {
  createPublicClient,
  http,
  parseEther,
  parseUnits,
  erc20Abi,
  encodeFunctionData,
  type Hex,
} from "viem";
import { toAccount } from "viem/accounts";

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  toPermissionValidator,
  serializePermissionAccount,
  deserializePermissionAccount,
} from "@zerodev/permissions";
import {
  toECDSASigner,
  toEmptyECDSASigner,
} from "@zerodev/permissions/signers";
import {
  toCallPolicy,
  CallPolicyVersion,
  ParamCondition,
} from "@zerodev/permissions/policies";

import { client } from "../client";
import {
  BACKEND_URL,
  TOKEN_ASSETS,
  type TokenAsset,
  ZERODEV_CONFIGURED,
  ZERODEV_OWNER_ADDR_KEY,
  ZERODEV_SERIALIZED_KEY,
  ZERODEV_REMOTE_SIGNER_KEY,
  ZERODEV_REGISTERED_KEY,
  ZERODEV_RPC_URL,
  AMOUNT_DISPLAY,
} from "./config";

// ── Constants ────────────────────────────────────────────────────────────────
const ENTRY_POINT = getEntryPoint("0.7");
const KERNEL_VERSION = KERNEL_V3_1;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

// ── Types ────────────────────────────────────────────────────────────────────
export type ZdStep =
  | "idle"
  | "connecting"
  | "connected"
  | "granting"
  | "ready"
  | "link-pasted"
  | "prefunding"   // V1 pre-fund / V2 fund-kernel Tx in-flight
  | "registering"  // V2: registering session key to backend
  | "executing"
  | "done"
  | "error";

export type AssetGrant = {
  symbol: string;
  enabled: boolean;
  capDisplay: string;
  recipient?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function twToViemAccount(tw: TwAccount) {
  return toAccount({
    address: tw.address as `0x${string}`,
    async signMessage({ message }) {
      return (await tw.signMessage({ message })) as Hex;
    },
    async signTypedData(typedData) {
      return (await tw.signTypedData(typedData as never)) as Hex;
    },
    async signTransaction() {
      throw new Error(
        "signTransaction is not supported via the in-app wallet bridge.",
      );
    },
  });
}

function buildPermissionsForGrants(
  grants: AssetGrant[],
  assets: TokenAsset[],
) {
  const permissions: Array<Record<string, unknown>> = [];

  for (const g of grants) {
    if (!g.enabled) continue;
    const asset = assets.find((a) => a.symbol === g.symbol);
    if (!asset) continue;

    if (asset.kind === "native") {
      if (!g.recipient) {
        throw new Error("ETH grant requires a recipient address");
      }
      permissions.push({
        target: g.recipient as `0x${string}`,
        valueLimit: parseEther(g.capDisplay),
      });
    } else {
      if (!asset.address) {
        throw new Error(`Token contract address missing for ${asset.symbol}`);
      }
      const recipientArg = g.recipient
        ? {
            condition: ParamCondition.EQUAL,
            value: g.recipient as `0x${string}`,
          }
        : null;
      permissions.push({
        target: asset.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [
          recipientArg,
          {
            condition: ParamCondition.LESS_THAN_OR_EQUAL,
            value: parseUnits(g.capDisplay, asset.decimals),
          },
        ],
      });
    }
  }

  if (permissions.length === 0) {
    throw new Error("Select at least one asset to grant.");
  }
  return permissions;
}


async function makeSudoKernelClient(ownerViemAccount: ReturnType<typeof twToViemAccount>) {
  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerViemAccount,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
  });
  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: sudoValidator },
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
  });
  const zerodevTransport = http(ZERODEV_RPC_URL);
  const paymasterClient = createZeroDevPaymasterClient({
    chain: sepolia,
    transport: zerodevTransport,
  });
  return {
    kernelAddress: kernelAccount.address,
    client: createKernelAccountClient({
      account: kernelAccount,
      chain: sepolia,
      bundlerTransport: zerodevTransport,
      paymaster: paymasterClient,
    }),
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useSessionKeyZerodev() {
  const [step, setStep] = useState<ZdStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [execTxHash, setExecTxHash] = useState<string | null>(null);
  // Persisted in localStorage so Phase 2 remains accessible after wallet disconnect
  const [ownerKernelAddress, setOwnerKernelAddress] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(ZERODEV_OWNER_ADDR_KEY) : null
  );
  const [serializedSessionKey, setSerializedSessionKey] = useState<string | null>(null);

  // Delegate side
  const [delegateKernelAddress, setDelegateKernelAddress] = useState<string | null>(null);
  const [delegateClient, setDelegateClient] = useState<ReturnType<
    typeof createKernelAccountClient
  > | null>(null);

  // V1: Pre-fund flow
  const [v1PrefundTxHash, setV1PrefundTxHash] = useState<string | null>(null);
  const [v1ExecTxHash, setV1ExecTxHash] = useState<string | null>(null);

  // V2: AI Agent flow — kernel address + registered status survive wallet disconnect
  const [isRegistered, setIsRegistered] = useState<boolean>(() =>
    typeof window !== "undefined" ? localStorage.getItem(ZERODEV_REGISTERED_KEY) === "true" : false
  );
  const [remoteSignerAddress, setRemoteSignerAddress] = useState<string | null>(null);
  const [agentFundTxHash, setAgentFundTxHash] = useState<string | null>(null);
  const [agentTxHash, setAgentTxHash] = useState<string | null>(null);

  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const activeWallet = useActiveWallet();
  const account = useActiveAccount();

  const configured = ZERODEV_CONFIGURED;


  const getJwt = async (idToken: string): Promise<string> => {
    const res = await fetch(`${BACKEND_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) throw new Error("Failed to get JWT from backend");
    const { jwt } = (await res.json()) as { jwt: string };
    return jwt;
  };

  // ── Owner: connect with in-app wallet (EOA) ──────────────────────────────
  const handleOwnerConnect = async (idToken: string) => {
    setError(null);
    setStep("connecting");
    try {
      if (!configured) throw new Error("ZeroDev not configured");
      const jwt = await getJwt(idToken);

      const connectedWallet = await connect(async () => {
        const w = inAppWallet();
        await w.connect({ client, strategy: "jwt", jwt, chain: twSepolia });
        return w;
      });
      const eoa = connectedWallet?.getAccount();
      if (!eoa) throw new Error("Failed to get EOA");

      const ownerSigner = twToViemAccount(eoa);
      const sudoValidator = await signerToEcdsaValidator(publicClient, {
        signer: ownerSigner,
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
      });
      const ownerAccount = await createKernelAccount(publicClient, {
        plugins: { sudo: sudoValidator },
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
      });

      setOwnerKernelAddress(ownerAccount.address);
      if (typeof window !== "undefined") {
        localStorage.setItem(ZERODEV_OWNER_ADDR_KEY, ownerAccount.address);
      }
      setStep("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStep("error");
    }
  };

  // ── Owner: grant session key (transfer policy) ───────────────────────────
  const handleGrantSessionKey = async (
    delegateAddress: string,
    grants: AssetGrant[],
  ) => {
    if (!account) return;
    setError(null);
    setStep("granting");
    try {
      if (!delegateAddress) throw new Error("Delegate address is required");
      if (!configured) throw new Error("ZeroDev not configured");

      const ownerSigner = twToViemAccount(account);
      const sudoValidator = await signerToEcdsaValidator(publicClient, {
        signer: ownerSigner,
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
      });

      const emptySessionKeySigner = toEmptyECDSASigner(
        delegateAddress as `0x${string}`,
      );

      const permissions = buildPermissionsForGrants(grants, TOKEN_ASSETS);
      const callPolicy = toCallPolicy({
        policyVersion: CallPolicyVersion.V0_0_4,
        permissions: permissions as never,
      });

      const permissionPlugin = await toPermissionValidator(publicClient, {
        entryPoint: ENTRY_POINT,
        signer: emptySessionKeySigner,
        policies: [callPolicy],
        kernelVersion: KERNEL_VERSION,
      });

      const sessionKeyAccount = await createKernelAccount(publicClient, {
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
        plugins: { sudo: sudoValidator, regular: permissionPlugin },
      });

      const serialized = await serializePermissionAccount(sessionKeyAccount);
      setSerializedSessionKey(serialized);
      setOwnerKernelAddress(sessionKeyAccount.address);

      if (typeof window !== "undefined") {
        localStorage.setItem(ZERODEV_OWNER_ADDR_KEY, sessionKeyAccount.address);
        localStorage.setItem(ZERODEV_SERIALIZED_KEY, serialized);
      }

      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grant failed");
      setStep("error");
    }
  };


  // ── Delegate: connect EOA + deserialize the session key ──────────────────
  const handleDelegateConnect = async (
    idToken: string,
    serialized: string,
  ) => {
    setError(null);
    setStep("connecting");
    try {
      if (!serialized) throw new Error("Session key string is required");
      if (!configured) throw new Error("ZeroDev not configured");

      const jwt = await getJwt(idToken);

      const connectedWallet = await connect(async () => {
        const w = inAppWallet();
        await w.connect({ client, strategy: "jwt", jwt, chain: twSepolia });
        return w;
      });
      const delegateEOA = connectedWallet?.getAccount();
      if (!delegateEOA) throw new Error("Failed to get delegate EOA");

      const delegateSigner = twToViemAccount(delegateEOA);
      const sessionKeySigner = await toECDSASigner({ signer: delegateSigner });

      const sessionKeyAccount = await deserializePermissionAccount(
        publicClient,
        ENTRY_POINT,
        KERNEL_VERSION,
        serialized,
        sessionKeySigner,
      );

      const zerodevTransport = http(ZERODEV_RPC_URL);

      const paymasterClient = createZeroDevPaymasterClient({
        chain: sepolia,
        transport: zerodevTransport,
      });

      const kernelClient = createKernelAccountClient({
        account: sessionKeyAccount,
        chain: sepolia,
        bundlerTransport: zerodevTransport,
        paymaster: paymasterClient,
      });

      setDelegateClient(kernelClient);
      setDelegateKernelAddress(sessionKeyAccount.address);
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStep("error");
    }
  };

  // ── Delegate: execute transfer via the session key ────────────────────────
  const executeTransfer = async (
    recipient: string,
    asset: TokenAsset,
    amountDisplay: string,
  ) => {
    if (!delegateClient) return;
    if (!recipient) {
      setError("Recipient address is required");
      return;
    }
    setError(null);
    setStep("executing");
    try {
      const calls =
        asset.kind === "native"
          ? [
              {
                to: recipient as `0x${string}`,
                value: parseEther(amountDisplay || AMOUNT_DISPLAY),
                data: "0x" as Hex,
              },
            ]
          : (() => {
              if (!asset.address) {
                throw new Error(
                  `Token contract address missing for ${asset.symbol}`,
                );
              }
              return [
                {
                  to: asset.address as `0x${string}`,
                  value: 0n,
                  data: encodeErc20Transfer(
                    recipient as `0x${string}`,
                    parseUnits(amountDisplay, asset.decimals),
                  ),
                },
              ];
            })();

      const send = (
        delegateClient as unknown as {
          sendUserOperation: (a: { calls: typeof calls }) => Promise<Hex>;
          waitForUserOperationReceipt: (a: {
            hash: Hex;
          }) => Promise<{ receipt: { transactionHash: Hex } }>;
        }
      );
      const userOpHash = await send.sendUserOperation({ calls });
      const { receipt } = await send.waitForUserOperationReceipt({
        hash: userOpHash,
      });
      setExecTxHash(receipt.transactionHash);
      setStep("done");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Transfer failed";
      console.error("Transfer error:", err);
      setError(errorMsg);
      setStep("error");
    }
  };

  // ── V1: Pre-fund Kernel then execute via sudo validator ───────────────────
  // Step A: ThirdWeb EOA → Kernel SCW (regular Tx, moves tokens into Kernel)
  // Step B: Kernel → recipient (UserOp via sudo ECDSA validator, no session key)
  const handlePrefundAndSudoExecute = async (
    recipient: string,
    asset: TokenAsset,
    amountDisplay: string,
  ) => {
    if (!account) return;
    setError(null);
    setV1PrefundTxHash(null);
    setV1ExecTxHash(null);
    setStep("prefunding");
    try {
      if (!configured) throw new Error("ZeroDev not configured");

      // ── Step A: Pre-fund Tx (EOA → Kernel) ─────────────────────────────
      const ownerSigner = twToViemAccount(account);
      const { kernelAddress, client: sudoClient } = await makeSudoKernelClient(ownerSigner);

      let prefundTx: { to: `0x${string}`; value: bigint; data: Hex };
      if (asset.kind === "native") {
        prefundTx = {
          to: kernelAddress as `0x${string}`,
          value: parseEther(amountDisplay),
          data: "0x",
        };
      } else {
        if (!asset.address) throw new Error(`No address for ${asset.symbol}`);
        prefundTx = {
          to: asset.address as `0x${string}`,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [kernelAddress as `0x${string}`, parseUnits(amountDisplay, asset.decimals)],
          }),
        };
      }

      const { transactionHash: pHash } = await account.sendTransaction({
        ...prefundTx,
        chainId: sepolia.id,
      });
      setV1PrefundTxHash(pHash);

      // Wait for pre-fund to be mined before executing the UserOp
      await publicClient.waitForTransactionReceipt({ hash: pHash as `0x${string}` });

      // ── Step B: Kernel → recipient (UserOp, gas sponsored by ZeroDev) ──
      setStep("executing");

      const calls =
        asset.kind === "native"
          ? [{ to: recipient as `0x${string}`, value: parseEther(amountDisplay), data: "0x" as Hex }]
          : [{
              to: asset.address! as `0x${string}`,
              value: 0n,
              data: encodeErc20Transfer(
                recipient as `0x${string}`,
                parseUnits(amountDisplay, asset.decimals),
              ),
            }];

      const send = sudoClient as unknown as {
        sendUserOperation(a: { calls: typeof calls }): Promise<Hex>;
        waitForUserOperationReceipt(a: { hash: Hex }): Promise<{ receipt: { transactionHash: Hex } }>;
      };

      const userOpHash = await send.sendUserOperation({ calls });
      const { receipt } = await send.waitForUserOperationReceipt({ hash: userOpHash });
      setV1ExecTxHash(receipt.transactionHash);
      setStep("done");
    } catch (err) {
      console.error("V1 prefund+execute error:", err);
      setError(err instanceof Error ? err.message : "Prefund + execute failed");
      setStep("error");
    }
  };


  // ── V2: Register serialized session key to backend ────────────────────────
  // Backend stores it keyed by kernelAddress; AI agent looks it up when
  // triggering a transfer via POST /agent/transfer.
  const handleRegisterToBackend = async () => {
    if (!serializedSessionKey || !ownerKernelAddress) return;
    setError(null);
    setStep("registering");
    try {
      const res = await fetch(`${BACKEND_URL}/session-key/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kernelAddress: ownerKernelAddress,
          serializedSessionKey,
          thirdwebSCWAddress: account?.address,
        }),
      });
      if (!res.ok) throw new Error("Failed to register session key to backend");
      setIsRegistered(true);
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setStep("error");
    }
  };

  // ── V2: Issue SCW + register in one step (JPYC-specific) ─────────────────
  // Combines: fetch remote signer → build transferFrom session key → register.
  // amountCap: JPYC amount in display units (e.g. "10000")
  // recipient: fixed recipient address, or undefined = any address allowed
  const handleIssueAndRegister = async (
    amountCap: string,
    recipient?: string,
  ) => {
    if (!account) return;
    setError(null);
    setStep("granting");
    try {
      if (!configured) throw new Error("ZeroDev not configured");

      // Ensure remote signer address is available
      let signerAddr = remoteSignerAddress;
      if (!signerAddr) {
        const res = await fetch(`${BACKEND_URL}/remote-signer/address`);
        if (!res.ok) throw new Error("Backend unavailable — REMOTE_SIGNER_PRIVATE_KEY not set");
        const data = (await res.json()) as { address: string };
        signerAddr = data.address;
        setRemoteSignerAddress(signerAddr);
        if (typeof window !== "undefined") {
          localStorage.setItem(ZERODEV_REMOTE_SIGNER_KEY, signerAddr);
        }
      }

      const jpycAsset = TOKEN_ASSETS.find((a) => a.symbol === "JPYC");
      if (!jpycAsset?.address) {
        throw new Error("JPYC not configured — set NEXT_PUBLIC_SESSION_KEY_JPYC_ADDRESS");
      }

      const grants: AssetGrant[] = [{
        symbol: "JPYC",
        enabled: true,
        capDisplay: amountCap,
        recipient: recipient || undefined,
      }];

      const ownerSigner = twToViemAccount(account);
      const sudoValidator = await signerToEcdsaValidator(publicClient, {
        signer: ownerSigner,
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
      });

      const emptySessionKeySigner = toEmptyECDSASigner(signerAddr as `0x${string}`);
      // Transfer policy: Kernel calls JPYC.transfer(recipient, ≤cap) from its own balance.
      const permissions = buildPermissionsForGrants(grants, TOKEN_ASSETS);
      const callPolicy = toCallPolicy({
        policyVersion: CallPolicyVersion.V0_0_4,
        permissions: permissions as never,
      });
      const permissionPlugin = await toPermissionValidator(publicClient, {
        entryPoint: ENTRY_POINT,
        signer: emptySessionKeySigner,
        policies: [callPolicy],
        kernelVersion: KERNEL_VERSION,
      });

      const sessionKeyAccount = await createKernelAccount(publicClient, {
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
        plugins: { sudo: sudoValidator, regular: permissionPlugin },
      });

      const serialized = await serializePermissionAccount(sessionKeyAccount);
      const kernelAddr = sessionKeyAccount.address;

      // Register to backend (uses locally captured values — no state race)
      const regRes = await fetch(`${BACKEND_URL}/session-key/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kernelAddress: kernelAddr,
          serializedSessionKey: serialized,
          // Kernel holds its own tokens — no thirdwebSCWAddress needed
        }),
      });
      if (!regRes.ok) throw new Error("Failed to register session key to backend");

      setSerializedSessionKey(serialized);
      setOwnerKernelAddress(kernelAddr);
      setIsRegistered(true);

      if (typeof window !== "undefined") {
        localStorage.setItem(ZERODEV_OWNER_ADDR_KEY, kernelAddr);
        localStorage.setItem(ZERODEV_SERIALIZED_KEY, serialized);
        localStorage.setItem(ZERODEV_REGISTERED_KEY, "true");
      }

      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Issue failed");
      setStep("error");
    }
  };

  // ── V2: Fetch remote signer address from backend ─────────────────────────
  const fetchRemoteSignerAddress = async () => {
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/remote-signer/address`);
      if (!res.ok) throw new Error("Backend returned error — check REMOTE_SIGNER_PRIVATE_KEY in backend .env");
      const data = (await res.json()) as { address: string };
      setRemoteSignerAddress(data.address);
      if (typeof window !== "undefined") {
        localStorage.setItem(ZERODEV_REMOTE_SIGNER_KEY, data.address);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch remote signer address");
    }
  };

  // ── V2: AI Agent executes Phase 2 via backend ────────────────────────────
  // Backend does: A → B (fund kernel) then B → C (session key transfer)
  const handleAgentTransfer = async (
    recipient: string,
    tokenAddress: string,
    amountDisplay: string,
    decimals: number,
  ) => {
    if (!ownerKernelAddress) return;
    setError(null);
    setAgentTxHash(null);
    setAgentFundTxHash(null);
    setStep("executing");
    try {
      const res = await fetch(`${BACKEND_URL}/agent/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kernelAddress: ownerKernelAddress,
          recipient,
          tokenAddress,
          amount: amountDisplay,
          decimals,
        }),
      });
      const data = (await res.json()) as { fundTxHash?: string; transferTxHash?: string; error?: string };
      if (!res.ok || !data.transferTxHash) throw new Error(data.error ?? "Agent execute failed");
      setAgentFundTxHash(data.fundTxHash ?? null);
      setAgentTxHash(data.transferTxHash);
      setStep("done");
    } catch (err) {
      console.error("Agent execute error:", err);
      setError(err instanceof Error ? err.message : "Agent execute failed");
      setStep("error");
    }
  };

  // ── Disconnect (wallet only — kernel address persists for Phase 2) ────────
  const handleDisconnect = () => {
    if (activeWallet) disconnect(activeWallet);
    setSerializedSessionKey(null);
    setDelegateClient(null);
    setDelegateKernelAddress(null);
    setExecTxHash(null);
    setV1PrefundTxHash(null);
    setV1ExecTxHash(null);
    setRemoteSignerAddress(null);
    setStep("idle");
    setError(null);
    // ownerKernelAddress and isRegistered are intentionally kept so Phase 2
    // remains accessible after the owner wallet disconnects.
  };

  // ── Full reset — clears all state including persisted Phase 1 data ────────
  const handleReset = () => {
    handleDisconnect();
    setOwnerKernelAddress(null);
    setIsRegistered(false);
    setAgentTxHash(null);
    setAgentFundTxHash(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(ZERODEV_OWNER_ADDR_KEY);
      localStorage.removeItem(ZERODEV_SERIALIZED_KEY);
      localStorage.removeItem(ZERODEV_REMOTE_SIGNER_KEY);
      localStorage.removeItem(ZERODEV_REGISTERED_KEY);
    }
  };

  return {
    step,
    error,
    account,
    configured,
    ownerKernelAddress,
    serializedSessionKey,
    delegateKernelAddress,
    execTxHash,
    // V1
    v1PrefundTxHash,
    v1ExecTxHash,
    // V2
    isRegistered,
    remoteSignerAddress,
    agentFundTxHash,
    agentTxHash,
    // Actions
    handleOwnerConnect,
    handleGrantSessionKey,
    handleIssueAndRegister,
    handleDelegateConnect,
    executeTransfer,
    handlePrefundAndSudoExecute,
    handleRegisterToBackend,
    fetchRemoteSignerAddress,
    handleAgentTransfer,
    handleDisconnect,
    handleReset,
  };
}

// ── Local helpers ────────────────────────────────────────────────────────────
function encodeErc20Transfer(to: `0x${string}`, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
}
