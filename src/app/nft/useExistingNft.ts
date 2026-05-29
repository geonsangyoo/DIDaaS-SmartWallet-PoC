"use client";

import { useState } from "react";
import { sendAndConfirmTransaction, getContract } from "thirdweb";
import { sepolia } from "thirdweb/chains";
import { mintTo as mintTo721, transferFrom } from "thirdweb/extensions/erc721";
import { mintTo as mintTo1155, safeTransferFrom } from "thirdweb/extensions/erc1155";
import { useActiveAccount } from "thirdweb/react";
import { client } from "../client";

function friendlyTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("-32507") || msg.includes("paymaster signature") || msg.includes("account signature")) {
    return "Session expired — please disconnect and reconnect your wallet, then try again.";
  }
  return msg || "Transaction failed";
}

export type ContractType = "erc721" | "erc1155";

export interface MintResult {
  txHash: string;
  timestamp: number;
}

export interface TransferResult {
  txHash: string;
  timestamp: number;
}

export interface ExistingNftState {
  // ── contract targeting ──────────────────────────────────────────────────────
  contractAddress: string;
  contractType: ContractType;

  // ── mint form ───────────────────────────────────────────────────────────────
  mintRecipient: string;      // defaults to connected account
  mintNftName: string;
  mintSupply: string;         // ERC-1155 only
  minting: boolean;
  mintResults: MintResult[];
  mintError: string | null;

  // ── transfer form ───────────────────────────────────────────────────────────
  transferTokenId: string;
  transferRecipient: string;
  transferAmount: string;     // ERC-1155 only
  transferring: boolean;
  transferResults: TransferResult[];
  transferError: string | null;
}

const initState: ExistingNftState = {
  contractAddress: "",
  contractType: "erc721",
  mintRecipient: "",
  mintNftName: "",
  mintSupply: "1",
  minting: false,
  mintResults: [],
  mintError: null,
  transferTokenId: "",
  transferRecipient: "",
  transferAmount: "1",
  transferring: false,
  transferResults: [],
  transferError: null,
};

export function useExistingNft() {
  const [state, setState] = useState<ExistingNftState>(initState);
  const account = useActiveAccount();

  const set = (patch: Partial<ExistingNftState>) =>
    setState((s) => ({ ...s, ...patch }));

  const reset = () => setState(initState);

  // ── Mint to existing contract ─────────────────────────────────────────────

  const mintExisting = async () => {
    if (!account || !state.contractAddress) return;
    const to = (state.mintRecipient.trim() || account.address) as `0x${string}`;
    set({ minting: true, mintError: null });
    try {
      const contract = getContract({ client, chain: sepolia, address: state.contractAddress as `0x${string}` });

      let txHash: string;
      if (state.contractType === "erc721") {
        const receipt = await sendAndConfirmTransaction({
          account,
          transaction: mintTo721({
            contract,
            to,
            nft: { name: state.mintNftName || "NFT" },
          }),
        });
        txHash = receipt.transactionHash;
      } else {
        const supply = BigInt(state.mintSupply || "1");
        const receipt = await sendAndConfirmTransaction({
          account,
          transaction: mintTo1155({
            contract,
            to,
            supply,
            nft: { name: state.mintNftName || "Edition NFT" },
          }),
        });
        txHash = receipt.transactionHash;
      }

      set({
        minting: false,
        mintResults: [{ txHash, timestamp: Date.now() }, ...state.mintResults],
      });
    } catch (err) {
      set({ minting: false, mintError: friendlyTxError(err) });
    }
  };

  // ── Transfer from existing contract ──────────────────────────────────────

  const transferExisting = async () => {
    if (!account || !state.contractAddress || !state.transferTokenId || !state.transferRecipient) return;
    set({ transferring: true, transferError: null });
    try {
      const contract = getContract({ client, chain: sepolia, address: state.contractAddress as `0x${string}` });
      const tokenId = BigInt(state.transferTokenId);
      const to = state.transferRecipient as `0x${string}`;

      let txHash: string;
      if (state.contractType === "erc721") {
        const receipt = await sendAndConfirmTransaction({
          account,
          transaction: transferFrom({ contract, from: account.address, to, tokenId }),
        });
        txHash = receipt.transactionHash;
      } else {
        const value = BigInt(state.transferAmount || "1");
        const receipt = await sendAndConfirmTransaction({
          account,
          transaction: safeTransferFrom({ contract, from: account.address, to, tokenId, value, data: "0x" }),
        });
        txHash = receipt.transactionHash;
      }

      set({
        transferring: false,
        transferResults: [{ txHash, timestamp: Date.now() }, ...state.transferResults],
        transferError: null,
      });
    } catch (err) {
      set({ transferring: false, transferError: friendlyTxError(err) });
    }
  };

  return { state, set, reset, mintExisting, transferExisting, account };
}
