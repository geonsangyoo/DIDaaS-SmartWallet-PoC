"use client";

import Link from "next/link";
import { useNftViewer, type NftItem, type ContractType, type DiscoveredContract } from "./useNftViewer";

function shorten(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function NftCard({ nft, type }: { nft: NftItem; type: ContractType }) {
  const isZero = nft.owner === "0x0000000000000000000000000000000000000000";
  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/50 flex flex-col">
      {/* Image */}
      <div className="aspect-square bg-zinc-800 flex items-center justify-center overflow-hidden">
        {nft.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={nft.image}
            alt={nft.name || `Token #${nft.tokenId}`}
            className="w-full h-full object-cover"
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = "none";
              el.parentElement!.innerHTML =
                '<span class="text-zinc-600 text-xs">No image</span>';
            }}
          />
        ) : (
          <span className="text-zinc-600 text-xs">No image</span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-1.5 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-mono text-zinc-500">
            #{nft.tokenId.toString()}
          </span>
          {type === "erc1155" && nft.supply !== undefined && (
            <span className="text-xs text-purple-400 font-mono shrink-0">
              supply: {nft.supply.toString()}
            </span>
          )}
          {type === "erc1155" && nft.quantityOwned !== undefined && (
            <span className="text-xs text-purple-400 font-mono shrink-0">
              owned: {nft.quantityOwned.toString()}
            </span>
          )}
        </div>

        <p className="text-sm font-medium text-zinc-100 truncate leading-tight">
          {nft.name || <span className="text-zinc-500 italic">Unnamed</span>}
        </p>

        {nft.description && (
          <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
            {nft.description}
          </p>
        )}

        {type === "erc721" && nft.owner && (
          <p className={`text-xs font-mono truncate ${isZero ? "text-red-500" : "text-zinc-600"}`}>
            {isZero ? "Burned" : shorten(nft.owner)}
          </p>
        )}
      </div>
    </div>
  );
}

function DiscoveryRow({
  entry,
  onSelect,
}: {
  entry: DiscoveredContract;
  onSelect: (addr: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-xs">
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="font-mono text-zinc-200 truncate">{entry.proxy}</p>
        <p className="text-zinc-600 truncate">impl: {entry.implementation}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <a
          href={`https://sepolia.etherscan.io/address/${entry.proxy}`}
          target="_blank"
          rel="noreferrer"
          className="text-zinc-500 hover:text-zinc-300 underline"
        >
          Etherscan ↗
        </a>
        <button
          onClick={() => onSelect(entry.proxy)}
          className="px-2.5 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
        >
          Inspect
        </button>
      </div>
    </div>
  );
}

export default function NftViewerPage() {
  const { state, set, reset, fetchNfts, discoverContracts } = useNftViewer();

  const isValidAddress =
    state.contractAddress.trim().startsWith("0x") &&
    state.contractAddress.trim().length === 42;

  const hasCapped = state.nfts.length === 50;

  return (
    <main className="min-h-[100vh] bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <Link href="/nft" className="text-zinc-500 hover:text-zinc-300 text-sm">
            ← NFT Deployment
          </Link>
          <h1 className="text-2xl font-bold mt-1">NFT Contract Viewer</h1>
          <p className="text-zinc-400 text-sm">
            NFTコントラクト情報照会 — Read-only, no wallet required
          </p>
        </div>

        {/* ── Discover deployed contracts ──────────────────────────────────── */}
        <div className="border border-teal-900/50 rounded-xl p-5 bg-zinc-900/30 space-y-4">
          <div>
            <p className="text-xs text-teal-400 uppercase tracking-wider">
              Discover Deployed Contracts
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Scans ThirdWeb's autofactory (TWCloneFactory) for{" "}
              <code className="bg-zinc-800 px-1 rounded text-zinc-300">ProxyDeployedV2</code>{" "}
              events emitted when deploying via the ThirdWeb SDK.
              Enter the deployer wallet address to find all contracts it has deployed.
            </p>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Deployer wallet address (0x…)"
              value={state.discoveryAddress}
              onChange={(e) => set({ discoveryAddress: e.target.value })}
              className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={discoverContracts}
              disabled={
                !state.discoveryAddress.trim().startsWith("0x") ||
                state.discoveryAddress.trim().length !== 42 ||
                state.discovering
              }
              className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-800 hover:bg-teal-700 text-teal-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {state.discovering ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border border-teal-400 border-t-white rounded-full animate-spin inline-block" />
                  Scanning…
                </span>
              ) : (
                "Scan"
              )}
            </button>
          </div>

          {state.discoveryError && (
            <p className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded px-3 py-2 break-words">
              {state.discoveryError}
            </p>
          )}

          {state.discoveredContracts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Found {state.discoveredContracts.length} contract
                {state.discoveredContracts.length !== 1 ? "s" : ""}
              </p>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {state.discoveredContracts.map((entry) => (
                  <DiscoveryRow
                    key={entry.proxy}
                    entry={entry}
                    onSelect={(addr) =>
                      set({ contractAddress: addr, contractMeta: null, nfts: [], error: null })
                    }
                  />
                ))}
              </div>
              <p className="text-xs text-zinc-600">
                Click <span className="text-zinc-400">Inspect</span> to load a contract's metadata and tokens in the query below.
              </p>
            </div>
          )}

          {!state.discovering &&
            state.discoveredContracts.length === 0 &&
            state.discoveryAddress.length > 10 &&
            state.discoveryError === null && (
              <p className="text-xs text-zinc-600 italic">
                No results yet — enter a wallet address and click Scan.
              </p>
            )}
        </div>

        {/* ── Contract query form ───────────────────────────────────────────── */}
        <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Contract Query</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs text-zinc-500">Contract Address</label>
              <input
                type="text"
                placeholder="0x…"
                value={state.contractAddress}
                onChange={(e) => set({ contractAddress: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Token Standard</label>
              <div className="flex gap-2 h-[38px]">
                {(["erc721", "erc1155"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set({ contractType: t })}
                    className={`flex-1 rounded-lg text-xs font-medium transition-colors ${
                      state.contractType === t
                        ? "bg-zinc-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {t === "erc721" ? "ERC-721" : "ERC-1155"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500">
              Owner Filter{" "}
              <span className="text-zinc-600">
                (optional — show only tokens owned by this address)
              </span>
            </label>
            <input
              type="text"
              placeholder="0x… (leave blank to show all tokens)"
              value={state.ownerFilter}
              onChange={(e) => set({ ownerFilter: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={fetchNfts}
              disabled={!isValidAddress || state.loading}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {state.loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border border-zinc-400 border-t-white rounded-full animate-spin inline-block" />
                  Fetching…
                </span>
              ) : (
                "Fetch Contract Data"
              )}
            </button>
            {(state.contractMeta || state.error) && (
              <button
                onClick={reset}
                className="px-4 py-2 rounded-lg text-sm border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {state.error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm break-words">
            {state.error}
          </div>
        )}

        {/* Contract metadata */}
        {state.contractMeta && (
          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/30 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Contract Info</p>

            <div className="flex flex-wrap gap-6 items-end">
              <div>
                <p className="text-xs text-zinc-500">Name</p>
                <p className="text-lg font-semibold text-zinc-100">{state.contractMeta.name}</p>
              </div>
              {state.contractMeta.symbol && (
                <div>
                  <p className="text-xs text-zinc-500">Symbol</p>
                  <p className="text-lg font-mono text-zinc-300">{state.contractMeta.symbol}</p>
                </div>
              )}
              {state.contractMeta.totalSupply !== undefined && (
                <div>
                  <p className="text-xs text-zinc-500">Total Minted</p>
                  <p className="text-lg font-mono text-green-400">
                    {state.contractMeta.totalSupply.toString()}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-zinc-500">Standard</p>
                <p className="text-sm font-mono text-zinc-400 uppercase">{state.contractType}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-zinc-600 font-mono break-all">
                  {state.contractAddress}
                </p>
                <a
                  href={`https://sepolia.etherscan.io/address/${state.contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                >
                  View on Etherscan ↗
                </a>
              </div>
            </div>

            {state.contractMeta.description && (
              <p className="text-sm text-zinc-400 border-t border-zinc-800 pt-3">
                {state.contractMeta.description}
              </p>
            )}
          </div>
        )}

        {/* Tokens */}
        {state.contractMeta && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                Tokens ({state.nfts.length}
                {hasCapped && " · capped at 50"})
              </p>
              {state.ownerFilter && (
                <p className="text-xs text-zinc-600">
                  Owner:{" "}
                  <span className="font-mono text-zinc-500">{state.ownerFilter}</span>
                </p>
              )}
            </div>

            {state.nfts.length === 0 && !state.loading && (
              <p className="text-sm text-zinc-600 italic">
                {state.ownerFilter
                  ? "No tokens found for this owner."
                  : "No tokens minted yet."}
              </p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {state.nfts.map((nft, i) => (
                <NftCard
                  key={`${nft.tokenId.toString()}-${i}`}
                  nft={nft}
                  type={state.contractType}
                />
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
