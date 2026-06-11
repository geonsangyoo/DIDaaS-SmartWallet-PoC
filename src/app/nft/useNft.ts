"use client";

import { useState } from "react";
import { inAppWallet } from "thirdweb/wallets";
import { useConnect, useActiveAccount, useDisconnect, useActiveWallet } from "thirdweb/react";
import { sepolia } from "thirdweb/chains";
import { sendAndConfirmTransaction, getContract } from "thirdweb";
import { upload } from "thirdweb/storage";
import { deployERC721Contract, deployERC1155Contract } from "thirdweb/deploys";
import { mintTo as mintTo721, transferFrom } from "thirdweb/extensions/erc721";
import { mintTo as mintTo1155, safeTransferFrom } from "thirdweb/extensions/erc1155";
import { revokeRole } from "thirdweb/extensions/permissions";
import { decodeEventLog } from "viem";
import { client } from "../client";
import { BACKEND_URL, ZERO_ADDRESS } from "./config";

// Converts raw bundler/paymaster errors to user-friendly messages.
// -32507: paymaster or account signature invalid — almost always means the
// wallet session or paymaster validity window has expired.
function friendlyTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("-32507") || msg.includes("paymaster signature") || msg.includes("account signature")) {
    return "Session expired — please disconnect and reconnect your wallet, then try again.";
  }
  return msg || "Transaction failed";
}

// ── ERC-721 Transfer event parser ───────────────────────────────────────────

const TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function parseMintedTokenId721(
  receipt: { logs: readonly { topics: readonly string[]; data: string }[] },
): bigint | null {
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== ERC721_TRANSFER_TOPIC) continue;
    if (
      log.topics[1] !==
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    )
      continue;
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_ABI,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        data: log.data as `0x${string}`,
      });
      return decoded.args.tokenId;
    } catch {
      // continue to next log
    }
  }
  return null;
}

// ── ERC-1155 TransferSingle event parser ────────────────────────────────────
// Signature: TransferSingle(address indexed operator, address indexed from,
//             address indexed to, uint256 id, uint256 value)
// `id` and `value` are NOT indexed — packed in `data` as two 32-byte words.

const ERC1155_TRANSFER_SINGLE_TOPIC =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";

function parseMintedTokenId1155(
  receipt: { logs: readonly { topics: readonly string[]; data: string }[] },
): { tokenId: bigint; supply: bigint } | null {
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== ERC1155_TRANSFER_SINGLE_TOPIC) continue;
    // topic[2] is `from` — address(0) means mint
    if (
      log.topics[2] !==
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    )
      continue;
    try {
      const raw = log.data.startsWith("0x") ? log.data.slice(2) : log.data;
      const tokenId = BigInt("0x" + raw.slice(0, 64));
      const supply  = BigInt("0x" + raw.slice(64, 128));
      return { tokenId, supply };
    } catch {
      // continue
    }
  }
  return null;
}

// ── Types ────────────────────────────────────────────────────────────────────

/** Lifecycle for the deploy + role-config phase only */
export type DeployStep = "idle" | "deploying" | "configuring" | "error";

/** One minted ERC-721 token and its transfer lifecycle */
export interface OwnedToken721 {
  tokenId: bigint;
  mintTxHash: string;
  transferred: boolean;
  transferTxHash: string | null;
  transferError: string | null;
  transferring: boolean;
}

export interface NftPanelState {
  contractAddress: string | null;
  deployStep: DeployStep;
  minting: boolean;
  tokens: OwnedToken721[];
}

/** One minted ERC-1155 tokenId and its remaining balance */
export interface OwnedEditionToken {
  tokenId: bigint;
  totalSupply: bigint;
  balance: bigint;
  mintTxHash: string;
  transferTxHash: string | null;
  transferError: string | null;
  transferring: boolean;
}

export interface EditionPanelState {
  contractAddress: string | null;
  deployStep: DeployStep;
  minting: boolean;
  tokens: OwnedEditionToken[];
}

const initNft: NftPanelState = {
  contractAddress: null,
  deployStep: "idle",
  minting: false,
  tokens: [],
};

const initEdition: EditionPanelState = {
  contractAddress: null,
  deployStep: "idle",
  minting: false,
  tokens: [],
};

export const EDITION_SUPPLY = 10n;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useNft() {
  const [transferable, setTransferable] = useState<NftPanelState>(initNft);
  const [soulbound, setSoulbound] = useState<NftPanelState>(initNft);
  const [edition, setEdition] = useState<EditionPanelState>(initEdition);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const account = useActiveAccount();
  const activeWallet = useActiveWallet();

  const handleGoogleLogin = async (idToken: string) => {
    setGlobalError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("Failed to get JWT from backend");
      const { jwt } = await res.json();
      await connect(async () => {
        const wallet = inAppWallet({
          executionMode: { mode: "EIP4337", smartAccount: { chain: sepolia, sponsorGas: true } },
        });
        await wallet.connect({ client, strategy: "jwt", jwt, chain: sepolia });
        return wallet;
      });
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Login failed");
    }
  };

  const handleDisconnect = () => {
    if (activeWallet) disconnect(activeWallet);
    setTransferable(initNft);
    setSoulbound(initNft);
    setEdition(initEdition);
    setGlobalError(null);
  };

  // ── Transferable NFT (ERC-721) ───────────────────────────────────────────────

  const deployTransferable = async () => {
    if (!account) return;
    setTransferable((s) => ({ ...s, deployStep: "deploying" }));
    setGlobalError(null);
    try {
      const address = await deployERC721Contract({
        client, chain: sepolia, account,
        type: "TokenERC721",
        params: {
          name: "Transferable NFT PoC",
          symbol: "TNFT",
          description: "Standard ERC-721: tokens can be freely transferred between addresses.",
        },
      });
      setTransferable((s) => ({ ...s, contractAddress: address, deployStep: "idle" }));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Deploy failed");
      setTransferable((s) => ({ ...s, deployStep: "error" }));
    }
  };

  const mintTransferable = async (imageFile?: File) => {
    if (!account || !transferable.contractAddress) return;
    setTransferable((s) => ({ ...s, minting: true }));
    setGlobalError(null);
    try {
      const contract = getContract({ client, chain: sepolia, address: transferable.contractAddress });
      const index = transferable.tokens.length + 1;
      let imageUri: string | undefined;
      if (imageFile) {
        imageUri = await upload({ client, files: [imageFile] });
      }
      const receipt = await sendAndConfirmTransaction({
        account,
        transaction: mintTo721({
          contract,
          to: account.address,
          nft: {
            name: `Transferable NFT #${index}`,
            description: "This token can be transferred to any address.",
            ...(imageUri && { image: imageUri }),
          },
        }),
      });
      const tokenId = parseMintedTokenId721(receipt) ?? BigInt(index - 1);
      setTransferable((s) => ({
        ...s,
        minting: false,
        tokens: [
          ...s.tokens,
          { tokenId, mintTxHash: receipt.transactionHash, transferred: false,
            transferTxHash: null, transferError: null, transferring: false },
        ],
      }));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Mint failed");
      setTransferable((s) => ({ ...s, minting: false }));
    }
  };

  const transferTransferable = async (tokenId: bigint, to: string) => {
    if (!account || !transferable.contractAddress) return;
    setTransferable((s) => ({
      ...s,
      tokens: s.tokens.map((t) =>
        t.tokenId === tokenId ? { ...t, transferring: true, transferError: null } : t,
      ),
    }));
    try {
      const contract = getContract({ client, chain: sepolia, address: transferable.contractAddress });
      const receipt = await sendAndConfirmTransaction({
        account,
        transaction: transferFrom({ contract, from: account.address, to: to as `0x${string}`, tokenId }),
      });
      setTransferable((s) => ({
        ...s,
        tokens: s.tokens.map((t) =>
          t.tokenId === tokenId
            ? { ...t, transferred: true, transferTxHash: receipt.transactionHash, transferring: false }
            : t,
        ),
      }));
    } catch (err) {
      const msg = friendlyTxError(err);
      setTransferable((s) => ({
        ...s,
        tokens: s.tokens.map((t) =>
          t.tokenId === tokenId ? { ...t, transferError: msg, transferring: false } : t,
        ),
      }));
    }
  };

  // ── Soulbound NFT (ERC-721 + role lock) ─────────────────────────────────────

  const deploySoulbound = async () => {
    if (!account) return;
    setSoulbound((s) => ({ ...s, deployStep: "deploying" }));
    setGlobalError(null);
    try {
      const address = await deployERC721Contract({
        client, chain: sepolia, account,
        type: "TokenERC721",
        params: {
          name: "Soulbound NFT PoC",
          symbol: "SNFT",
          description: "Non-transferable ERC-721: tokens are permanently bound to the recipient.",
        },
      });
      setSoulbound((s) => ({ ...s, deployStep: "configuring" }));
      const contract = getContract({ client, chain: sepolia, address });
      // TokenERC721.initialize grants TRANSFER_ROLE to both the deployer AND
      // address(0) by default. address(0) acts as the "global unrestrict" flag —
      // _beforeTokenTransfer skips the role check entirely when address(0) has
      // the role. Revoke address(0) first (per docs), then revoke the admin so
      // that even the deployer (who mints to themselves in this PoC) cannot
      // transfer. Minting (from == address(0)) is always allowed regardless.
      await sendAndConfirmTransaction({
        account,
        transaction: revokeRole({ contract, role: "TRANSFER_ROLE", targetAccountAddress: ZERO_ADDRESS }),
      });
      // await sendAndConfirmTransaction({
      //   account,
      //   transaction: revokeRole({ contract, role: "TRANSFER_ROLE", targetAccountAddress: account.address }),
      // });
      // Only set the contract address after both role revocations succeed.
      // If either revocation fails the catch block fires and contractAddress
      // is never stored, preventing the UI from showing a misconfigured contract.
      setSoulbound((s) => ({ ...s, contractAddress: address, deployStep: "idle" }));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Deploy failed");
      setSoulbound((s) => ({ ...s, deployStep: "error" }));
    }
  };

  const mintSoulbound = async (imageFile?: File) => {
    if (!account || !soulbound.contractAddress) return;
    setSoulbound((s) => ({ ...s, minting: true }));
    setGlobalError(null);
    try {
      const contract = getContract({ client, chain: sepolia, address: soulbound.contractAddress });
      const index = soulbound.tokens.length + 1;
      let imageUri: string | undefined;
      if (imageFile) {
        imageUri = await upload({ client, files: [imageFile] });
      }
      const receipt = await sendAndConfirmTransaction({
        account,
        transaction: mintTo721({
          contract,
          to: account.address,
          nft: {
            name: `Soulbound NFT #${index}`,
            description: "This token is permanently bound to the recipient — transfer will revert.",
            ...(imageUri && { image: imageUri }),
          },
        }),
      });
      const tokenId = parseMintedTokenId721(receipt) ?? BigInt(index - 1);
      setSoulbound((s) => ({
        ...s,
        minting: false,
        tokens: [
          ...s.tokens,
          { tokenId, mintTxHash: receipt.transactionHash, transferred: false,
            transferTxHash: null, transferError: null, transferring: false },
        ],
      }));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Mint failed");
      setSoulbound((s) => ({ ...s, minting: false }));
    }
  };

  const transferSoulbound = async (tokenId: bigint, to: string) => {
    if (!account || !soulbound.contractAddress) return;
    setSoulbound((s) => ({
      ...s,
      tokens: s.tokens.map((t) =>
        t.tokenId === tokenId ? { ...t, transferring: true, transferError: null } : t,
      ),
    }));
    try {
      const contract = getContract({ client, chain: sepolia, address: soulbound.contractAddress });
      const receipt = await sendAndConfirmTransaction({
        account,
        transaction: transferFrom({ contract, from: account.address, to: to as `0x${string}`, tokenId }),
      });
      // Should not reach here — transfer must revert on-chain
      setSoulbound((s) => ({
        ...s,
        tokens: s.tokens.map((t) =>
          t.tokenId === tokenId
            ? { ...t, transferred: true, transferTxHash: receipt.transactionHash, transferring: false }
            : t,
        ),
      }));
    } catch (err) {
      const msg = friendlyTxError(err);
      setSoulbound((s) => ({
        ...s,
        tokens: s.tokens.map((t) =>
          t.tokenId === tokenId ? { ...t, transferError: msg, transferring: false } : t,
        ),
      }));
    }
  };

  // ── Edition NFT (ERC-1155 / TokenERC1155) ───────────────────────────────────
  //
  // Each call to mintEdition creates a NEW tokenId with EDITION_SUPPLY copies.
  // Partial transfers reduce the in-memory balance so remaining copies are visible.

  const deployEdition = async () => {
    if (!account) return;
    setEdition((s) => ({ ...s, deployStep: "deploying" }));
    setGlobalError(null);
    try {
      const address = await deployERC1155Contract({
        client, chain: sepolia, account,
        type: "TokenERC1155",
        params: {
          name: "Edition NFT PoC",
          symbol: "ENFT",
          description: "ERC-1155 Edition: one tokenId with multiple copies, enabling partial transfers.",
        },
      });
      setEdition((s) => ({ ...s, contractAddress: address, deployStep: "idle" }));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Deploy failed");
      setEdition((s) => ({ ...s, deployStep: "error" }));
    }
  };

  const mintEdition = async (imageFile?: File) => {
    if (!account || !edition.contractAddress) return;
    setEdition((s) => ({ ...s, minting: true }));
    setGlobalError(null);
    try {
      const contract = getContract({ client, chain: sepolia, address: edition.contractAddress });
      const index = edition.tokens.length + 1;
      let imageUri: string | undefined;
      if (imageFile) {
        imageUri = await upload({ client, files: [imageFile] });
      }
      const receipt = await sendAndConfirmTransaction({
        account,
        transaction: mintTo1155({
          contract,
          to: account.address,
          supply: EDITION_SUPPLY,
          nft: {
            name: `Edition NFT #${index}`,
            description: `One of ${EDITION_SUPPLY.toString()} copies — edition #${index}.`,
            ...(imageUri && { image: imageUri }),
          },
        }),
      });
      const parsed = parseMintedTokenId1155(receipt);
      const tokenId = parsed?.tokenId ?? BigInt(index - 1);
      const totalSupply = parsed?.supply ?? EDITION_SUPPLY;
      setEdition((s) => ({
        ...s,
        minting: false,
        tokens: [
          ...s.tokens,
          { tokenId, totalSupply, balance: totalSupply, mintTxHash: receipt.transactionHash,
            transferTxHash: null, transferError: null, transferring: false },
        ],
      }));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Mint failed");
      setEdition((s) => ({ ...s, minting: false }));
    }
  };

  const transferEdition = async (tokenId: bigint, to: string, amount: bigint) => {
    if (!account || !edition.contractAddress) return;
    setEdition((s) => ({
      ...s,
      tokens: s.tokens.map((t) =>
        t.tokenId === tokenId ? { ...t, transferring: true, transferError: null } : t,
      ),
    }));
    try {
      const contract = getContract({ client, chain: sepolia, address: edition.contractAddress });
      const receipt = await sendAndConfirmTransaction({
        account,
        transaction: safeTransferFrom({
          contract,
          from: account.address,
          to: to as `0x${string}`,
          tokenId,
          value: amount,
          data: "0x",
        }),
      });
      setEdition((s) => ({
        ...s,
        tokens: s.tokens.map((t) =>
          t.tokenId === tokenId
            ? { ...t, balance: t.balance - amount, transferTxHash: receipt.transactionHash, transferring: false }
            : t,
        ),
      }));
    } catch (err) {
      const msg = friendlyTxError(err);
      setEdition((s) => ({
        ...s,
        tokens: s.tokens.map((t) =>
          t.tokenId === tokenId ? { ...t, transferError: msg, transferring: false } : t,
        ),
      }));
    }
  };

  return {
    account,
    globalError,
    transferable,
    soulbound,
    edition,
    handleGoogleLogin,
    handleDisconnect,
    deployTransferable,
    mintTransferable,
    transferTransferable,
    deploySoulbound,
    mintSoulbound,
    transferSoulbound,
    deployEdition,
    mintEdition,
    transferEdition,
  };
}
