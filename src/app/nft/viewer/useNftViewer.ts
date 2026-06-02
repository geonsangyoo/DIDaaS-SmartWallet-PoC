"use client";

import { useState } from "react";
import { getContract, getContractEvents, prepareEvent } from "thirdweb";
import { sepolia } from "thirdweb/chains";
import {
  getNFTs as getNFTs721,
  getOwnedNFTs as getOwnedNFTs721,
  totalSupply as totalSupply721,
} from "thirdweb/extensions/erc721";
import {
  getNFTs as getNFTs1155,
  getOwnedNFTs as getOwnedNFTs1155,
} from "thirdweb/extensions/erc1155";
import { getContractMetadata } from "thirdweb/extensions/common";
import { getDeployedCloneFactoryContract } from "thirdweb/contract";
import { client } from "../../client";

export type ContractType = "erc721" | "erc1155";

export interface ContractMeta {
  name: string;
  symbol: string;
  description?: string;
  totalSupply?: bigint;
}

export interface NftItem {
  tokenId: bigint;
  name?: string;
  description?: string;
  image?: string;
  owner?: string | null;
  supply?: bigint;
  quantityOwned?: bigint;
}

export interface DiscoveredContract {
  proxy: string;
  implementation: string;
}

export interface NftViewerState {
  contractAddress: string;
  contractType: ContractType;
  ownerFilter: string;
  loading: boolean;
  error: string | null;
  contractMeta: ContractMeta | null;
  nfts: NftItem[];

  // ── Discovery (factory event scan) ─────────────────────────────────────────
  discoveryAddress: string;
  discovering: boolean;
  discoveryError: string | null;
  discoveredContracts: DiscoveredContract[];
}

const initState: NftViewerState = {
  contractAddress: "",
  contractType: "erc721",
  ownerFilter: "",
  loading: false,
  error: null,
  contractMeta: null,
  nfts: [],
  discoveryAddress: "",
  discovering: false,
  discoveryError: null,
  discoveredContracts: [],
};

// Convert ipfs:// URIs to a public HTTP gateway URL.
function toHttpUrl(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  }
  return uri;
}

// ThirdWeb's autofactory emits this event for every proxy deployment (SDK v5).
// `proxy` (indexed) is the deployed contract address; `deployer` (indexed) is the caller.
const PROXY_DEPLOYED_V2 = prepareEvent({
  signature:
    "event ProxyDeployedV2(address indexed implementation, address indexed proxy, address indexed deployer, bytes32 inputSalt, bytes data, bytes extraData)",
});

const MAX_TOKENS = 50;

export function useNftViewer() {
  const [state, setState] = useState<NftViewerState>(initState);

  const set = (patch: Partial<NftViewerState>) =>
    setState((s) => ({ ...s, ...patch }));

  const reset = () => setState(initState);

  // ── Contract info + token list ────────────────────────────────────────────

  const fetchNfts = async () => {
    const addr = state.contractAddress.trim();
    if (!addr) return;
    set({ loading: true, error: null, nfts: [], contractMeta: null });

    try {
      const contract = getContract({
        client,
        chain: sepolia,
        address: addr as `0x${string}`,
      });

      // Contract metadata
      const meta = await getContractMetadata({ contract });
      let totalSupply: bigint | undefined;
      if (state.contractType === "erc721") {
        try {
          totalSupply = await totalSupply721({ contract });
        } catch {
          // contract may not implement totalSupply
        }
      }

      const contractMeta: ContractMeta = {
        name: (meta as { name?: string }).name ?? "Unknown",
        symbol: (meta as { symbol?: string }).symbol ?? "",
        description: (meta as { description?: string }).description ?? undefined,
        totalSupply,
      };

      // Token list
      const ownerAddr = state.ownerFilter.trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rawNfts: any[];

      if (state.contractType === "erc721") {
        rawNfts = ownerAddr
          ? await getOwnedNFTs721({ contract, owner: ownerAddr })
          : await getNFTs721({ contract, start: 0, count: MAX_TOKENS });
      } else {
        // ERC-1155 getOwnedNFTs uses `address` (not `owner`) for the wallet filter
        rawNfts = ownerAddr
          ? await getOwnedNFTs1155({ contract, address: ownerAddr })
          : await getNFTs1155({ contract, start: 0, count: MAX_TOKENS });
      }

      const nfts: NftItem[] = rawNfts.map((nft, i) => ({
        tokenId: nft.metadata?.id ?? BigInt(i),
        name: nft.metadata?.name,
        description: nft.metadata?.description,
        image: toHttpUrl(nft.metadata?.image),
        owner: nft.owner,
        supply: nft.supply,
        quantityOwned: nft.quantityOwned,
      }));

      setState((s) => ({ ...s, loading: false, contractMeta, nfts }));
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch contract data",
      });
    }
  };

  // ── Discover contracts via ThirdWeb factory events ────────────────────────
  //
  // ThirdWeb's autofactory (TWCloneFactory) emits ProxyDeployedV2 for every
  // contract deployed through the SDK. Querying those events by deployer address
  // reveals all contracts the wallet has ever deployed via the ThirdWeb SDK.
  // ThirdWeb's Insight indexer handles the full history efficiently.

  const discoverContracts = async () => {
    const deployer = state.discoveryAddress.trim() as `0x${string}`;
    if (!deployer) return;
    set({ discovering: true, discoveryError: null, discoveredContracts: [] });

    try {
      // Resolve the TWCloneFactory address on Sepolia dynamically.
      // It's deployed at a deterministic CREATE2 address that the SDK computes
      // from ThirdWeb's published contract metadata on Polygon.
      const factory = await getDeployedCloneFactoryContract({ client, chain: sepolia });
      if (!factory) {
        throw new Error("ThirdWeb clone factory not found on Sepolia — the chain may not be supported.");
      }

      // Query ProxyDeployedV2 events filtered by deployer (indexed topic).
      // ThirdWeb's Insight API handles the full history without block-range limits.
      const events = await getContractEvents({
        contract: factory,
        events: [
          prepareEvent({
            filters: { deployer },
            signature:
              "event ProxyDeployedV2(address indexed implementation, address indexed proxy, address indexed deployer, bytes32 inputSalt, bytes data, bytes extraData)",
          }),
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const discovered: DiscoveredContract[] = events.map((e: any) => ({
        proxy: e.args.proxy as string,
        implementation: e.args.implementation as string,
      }));

      set({ discovering: false, discoveredContracts: discovered });
    } catch (err) {
      set({
        discovering: false,
        discoveryError: err instanceof Error ? err.message : "Discovery failed",
      });
    }
  };

  return { state, set, reset, fetchNfts, discoverContracts };
}
