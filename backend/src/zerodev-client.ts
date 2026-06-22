import { createPublicClient, http, erc20Abi, encodeFunctionData, parseUnits, parseEther, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { createThirdwebClient } from "thirdweb";
import { privateKeyToAccount as twPrivateKeyToAccount, smartWallet } from "thirdweb/wallets";
import { sepolia as twSepolia } from "thirdweb/chains";

const ZERODEV_PROJECT_ID = process.env.ZERODEV_PROJECT_ID;
const REMOTE_SIGNER_PRIVATE_KEY = process.env.REMOTE_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
const ASSET_OWNER_PRIVATE_KEY = process.env.ASSET_OWNER_PRIVATE_KEY as `0x${string}` | undefined;
const THIRDWEB_SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || "";

const SEPOLIA_CHAIN_ID = 11155111;
const ENTRY_POINT = getEntryPoint("0.7");
const KERNEL_VERSION = KERNEL_V3_1;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

const twClient = createThirdwebClient({ secretKey: THIRDWEB_SECRET_KEY });

export function getRemoteSignerAddress(): `0x${string}` {
  if (!REMOTE_SIGNER_PRIVATE_KEY) throw new Error("REMOTE_SIGNER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(REMOTE_SIGNER_PRIVATE_KEY);
  console.log("[remote-signer] Address:", account.address);
  return account.address;
}

// Creates the ThirdWeb ERC-4337 smart wallet account for the asset owner (A).
// The smart wallet address is deterministic: same EOA + same factory → same address.
async function createAssetOwnerSmartAccount() {
  if (!ASSET_OWNER_PRIVATE_KEY) throw new Error("ASSET_OWNER_PRIVATE_KEY not set");
  if (!THIRDWEB_SECRET_KEY) throw new Error("THIRDWEB_SECRET_KEY not set");
  const personalAccount = twPrivateKeyToAccount({ client: twClient, privateKey: ASSET_OWNER_PRIVATE_KEY });
  const wallet = smartWallet({ chain: twSepolia, sponsorGas: true });
  return wallet.connect({ client: twClient, personalAccount });
}

// Returns the ThirdWeb ERC-4337 smart wallet address of the asset owner (A).
export async function getAssetOwnerAddress(): Promise<`0x${string}`> {
  const account = await createAssetOwnerSmartAccount();
  return account.address as `0x${string}`;
}

// Phase 2 step 1: send JPYC from A (ThirdWeb smart wallet) → B (Kernel SCW) via gasless UserOp.
export async function fundKernel(
  kernelAddress: `0x${string}`,
  tokenAddress: `0x${string}`,
  amount: string,
  decimals: number,
): Promise<Hex> {
  const account = await createAssetOwnerSmartAccount();
  // account.address is the ThirdWeb ERC-4337 smart wallet address (A), NOT the raw EOA.
  // JPYC.transfer() will see msg.sender = A (smart wallet), so JPYC is deducted from A.
  console.log(`[fund-kernel] ${amount} token from A(SCW)=${account.address} → B=${kernelAddress}`);
  const { transactionHash } = await account.sendTransaction({
    to: tokenAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [kernelAddress, parseUnits(amount, decimals)],
    }),
    chainId: SEPOLIA_CHAIN_ID,
  });
  // Wait for the funding tx to confirm before the session key transfer starts.
  await publicClient.waitForTransactionReceipt({ hash: transactionHash as `0x${string}` });
  return transactionHash as `0x${string}`;
}

export type TransferCall =
  | { kind: "native"; recipient: `0x${string}`; amount: string }
  | { kind: "erc20"; tokenAddress: `0x${string}`; recipient: `0x${string}`; amount: string; decimals: number }
  | { kind: "transferFrom"; tokenAddress: `0x${string}`; source: `0x${string}`; recipient: `0x${string}`; amount: string; decimals: number };

export async function executeViaRemoteSigner(
  serializedSessionKey: string,
  transfer: TransferCall,
): Promise<Hex> {
  if (!ZERODEV_PROJECT_ID) throw new Error("ZERODEV_PROJECT_ID not set");
  if (!REMOTE_SIGNER_PRIVATE_KEY) throw new Error("REMOTE_SIGNER_PRIVATE_KEY not set");

  const remoteAccount = privateKeyToAccount(REMOTE_SIGNER_PRIVATE_KEY);
  const sessionKeySigner = await toECDSASigner({ signer: remoteAccount });

  const sessionKeyAccount = await deserializePermissionAccount(
    publicClient,
    ENTRY_POINT,
    KERNEL_VERSION,
    serializedSessionKey,
    sessionKeySigner,
  );

  const rpcUrl = `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${SEPOLIA_CHAIN_ID}`;
  const zerodevTransport = http(rpcUrl);

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

  let calls: { to: `0x${string}`; value: bigint; data: Hex }[];

  if (transfer.kind === "native") {
    calls = [{ to: transfer.recipient, value: parseEther(transfer.amount), data: "0x" }];
  } else if (transfer.kind === "erc20") {
    calls = [{
      to: transfer.tokenAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [transfer.recipient, parseUnits(transfer.amount, transfer.decimals)],
      }),
    }];
  } else {
    calls = [{
      to: transfer.tokenAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transferFrom",
        args: [transfer.source, transfer.recipient, parseUnits(transfer.amount, transfer.decimals)],
      }),
    }];
  }

  const send = kernelClient as unknown as {
    sendUserOperation(a: { calls: typeof calls }): Promise<Hex>;
    waitForUserOperationReceipt(a: { hash: Hex }): Promise<{ receipt: { transactionHash: Hex } }>;
  };

  const userOpHash = await send.sendUserOperation({ calls });
  const { receipt } = await send.waitForUserOperationReceipt({ hash: userOpHash });
  return receipt.transactionHash;
}
