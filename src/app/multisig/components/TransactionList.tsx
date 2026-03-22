import { shorten, weiToEth, getOwnerLabel } from "../config";
import type { SafeTransaction } from "../types";

interface Props {
  pending: SafeTransaction[];
  executed: SafeTransaction[];
}

export function TransactionList({ pending, executed }: Props) {
  return (
    <>
      {/* Pending summary */}
      <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">
          Pending ({pending.length})
        </h3>
        {pending.length === 0 && (
          <p className="text-xs text-zinc-500 italic">None</p>
        )}
        {pending.map((tx) => (
          <div
            key={tx.safeTxHash}
            className="flex justify-between items-center py-2 border-b border-zinc-800 last:border-0"
          >
            <div>
              <p className="font-mono text-xs text-zinc-400">{shorten(tx.safeTxHash)}</p>
              <p className="text-xs text-zinc-500">
                {getOwnerLabel(tx.to)} · {weiToEth(tx.value)} ETH
              </p>
            </div>
            <div className="flex gap-1 items-center">
              {tx.confirmations.map((c) => (
                <span key={c.owner} className="text-green-400 text-sm">✓</span>
              ))}
              {Array.from({ length: tx.confirmationsRequired - tx.confirmations.length }).map((_, i) => (
                <span key={i} className="text-zinc-600 text-sm">○</span>
              ))}
              <span className="text-xs text-zinc-500 ml-1">
                {tx.confirmations.length}/{tx.confirmationsRequired}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Executed */}
      {executed.length > 0 && (
        <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">
            Executed ({executed.length})
          </h3>
          {executed.map((tx) => (
            <div
              key={tx.safeTxHash}
              className="flex justify-between items-center py-2 border-b border-zinc-800 last:border-0"
            >
              <div>
                <p className="font-mono text-xs text-zinc-400">{shorten(tx.safeTxHash)}</p>
                <p className="text-xs text-zinc-500">
                  {getOwnerLabel(tx.to)} · {weiToEth(tx.value)} ETH
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs border border-green-500/30 bg-green-500/10 text-green-400 px-2 py-0.5 rounded">
                  Executed ✓
                </span>
                {tx.transactionHash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${tx.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-blue-400 hover:underline mt-1"
                  >
                    Etherscan →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
