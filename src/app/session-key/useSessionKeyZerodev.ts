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
  | "executing"
  | "done"
  | "error";

// Per-asset configuration the Owner can set.
//
// For ETH the recipient becomes the policy `target` (required).
// For ERC-20 the recipient is added as a ParamCondition.EQUAL constraint on
// the first arg of `transfer(address,uint256)` when provided, or left
// unconstrained (any recipient) when blank.
export type AssetGrant = {
  symbol: string;            // matches a TokenAsset.symbol
  enabled: boolean;
  capDisplay: string;        // amount cap in human display units
  recipient?: string;        // ETH: required; ERC-20: optional (blank = any)
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function twToViemAccount(tw: TwAccount) {
  return toAccount({
    address: tw.address as `0x${string}`,
    async signMessage({ message }) {
      return (await tw.signMessage({ message })) as Hex;
    },
    async signTypedData(typedData) {
      // thirdweb's signTypedData accepts the same EIP-712 shape viem uses
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

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useSessionKeyZerodev() {
  const [step, setStep] = useState<ZdStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [execTxHash, setExecTxHash] = useState<string | null>(null);
  const [ownerKernelAddress, setOwnerKernelAddress] = useState<string | null>(
    null,
  );
  const [serializedSessionKey, setSerializedSessionKey] = useState<
    string | null
  >(null);

  // Delegate side. The kernel client's full generic type is unwieldy; type it
  // loosely here since we only need it to send UserOps.
  const [delegateKernelAddress, setDelegateKernelAddress] = useState<
    string | null
  >(null);
  const [delegateClient, setDelegateClient] = useState<ReturnType<
    typeof createKernelAccountClient
  > | null>(null);

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

  // ── Owner: connect with in-app wallet (EOA) ─────────────────────────────────
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

      // Build sudo validator from the Owner EOA so we can predict the kernel
      // address and later use it as the sudo signer when serializing the
      // session-key account.
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

  // ── Owner: build session key with policies, serialize for sharing ──────────
  //
  // No on-chain tx needed. The serialized blob carries the validator + policies
  // and is consumed by the delegate at use-time. The kernel deploys lazily on
  // the delegate's first UserOp.
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

      // Empty signer for the delegate (only the address is needed at grant
      // time; the delegate's actual signer is plugged in on deserialize).
      const emptySessionKeySigner = toEmptyECDSASigner(
        delegateAddress as `0x${string}`,
      );

      const permissions = buildPermissionsForGrants(grants, TOKEN_ASSETS);
      const callPolicy = toCallPolicy({
        policyVersion: CallPolicyVersion.V0_0_4,
        // Cast: typed inference is too strict for our dynamic grant list.
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

  // ── Delegate: connect EOA + deserialize the session key string ────────────
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

      // Use ZeroDev's RPC for both bundler and paymaster. Thirdweb's paymaster
      // is not ERC-7677 compliant (only legacy `pm_sponsorUserOperation`) and
      // ZeroDev's bundler natively supports `zd_getUserOperationGasPrice`, so
      // the previous fee-estimator override is no longer needed.
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

  // ── Delegate: execute transfer via the session key ─────────────────────────
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

      console.log("Sending UserOperation with calls:", calls);

      // Cast to bypass the union-narrowing issue on the client's generic type;
      // the kernel client always carries an account, so passing none here is
      // valid at runtime.
      const send = (
        delegateClient as unknown as {
          sendUserOperation: (a: { calls: typeof calls }) => Promise<Hex>;
          waitForUserOperationReceipt: (a: {
            hash: Hex;
          }) => Promise<{ receipt: { transactionHash: Hex } }>;
        }
      );
      console.log("Calling sendUserOperation...", send);
      const userOpHash = await send.sendUserOperation({ calls });
      console.log("UserOp sent, hash:", userOpHash);
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

  const handleDisconnect = () => {
    if (activeWallet) disconnect(activeWallet);
    setOwnerKernelAddress(null);
    setSerializedSessionKey(null);
    setDelegateClient(null);
    setDelegateKernelAddress(null);
    setExecTxHash(null);
    setStep("idle");
    setError(null);
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
    handleOwnerConnect,
    handleGrantSessionKey,
    handleDelegateConnect,
    executeTransfer,
    handleDisconnect,
  };
}

// ── Local helpers ────────────────────────────────────────────────────────────
import { encodeFunctionData } from "viem";
function encodeErc20Transfer(to: `0x${string}`, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
}
