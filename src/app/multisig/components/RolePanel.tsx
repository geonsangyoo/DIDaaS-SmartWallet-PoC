"use client";

import { useState } from "react";
import { ROLE_CONFIG, RING, BTN, OWNER_ADDRESSES, shorten, weiToEth, getOwnerLabel } from "../config";
import type { Role, SafeTransaction } from "../types";

// ── Shared transaction card ───────────────────────────────────────────────────
interface TxCardProps {
  tx: SafeTransaction;
  role: Role;
  cfg: typeof ROLE_CONFIG[Role];
  actionLoading: boolean;
  isSafeDeployed: boolean;
  alreadySigned: boolean;
  onConfirm: (hash: string) => void;
  onExecute: (hash: string) => void;
}

function TxCard({ tx, role, cfg, actionLoading, isSafeDeployed, alreadySigned, onConfirm, onExecute }: TxCardProps) {
  const fullyApproved = tx.confirmations.length >= tx.confirmationsRequired;

  return (
    <div className="border border-zinc-700 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs text-zinc-500">safeTxHash</p>
          <p className="font-mono text-xs text-zinc-300">{shorten(tx.safeTxHash)}</p>
        </div>
        {fullyApproved ? (
          <span className="text-xs border border-purple-500/30 bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded">
            Ready to execute
          </span>
        ) : (
          <span className="text-xs border border-amber-500/30 bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded">
            Pending
          </span>
        )}
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-zinc-500">To: </span>
          <span className="font-mono text-zinc-300">{shorten(tx.to)}</span>
          <span className="text-zinc-500 ml-1">({getOwnerLabel(tx.to)})</span>
        </div>
        <div>
          <span className="text-zinc-500">Amount: </span>
          <span className="text-zinc-300">{weiToEth(tx.value)} ETH</span>
        </div>
      </div>

      {/* Signature badges */}
      <div>
        <p className="text-xs text-zinc-500 mb-1.5">
          Signatures ({tx.confirmations.length}/{tx.confirmationsRequired})
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {tx.confirmations.map((c) => (
            <span key={c.owner} className="text-xs border border-green-500/30 bg-green-500/10 text-green-400 px-2 py-0.5 rounded">
              {getOwnerLabel(c.owner)} ✓
            </span>
          ))}
          {Array.from({ length: tx.confirmationsRequired - tx.confirmations.length }).map((_, i) => (
            <span key={i} className="text-xs border border-zinc-700 bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded">
              Pending…
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      {tx.isExecuted ? (
        <p className="text-xs text-green-400">✓ Already executed on-chain</p>
      ) : fullyApproved ? (
        // All signatures collected — any owner can execute
        <button
          onClick={() => onExecute(tx.safeTxHash)}
          disabled={actionLoading || !isSafeDeployed}
          className="w-full py-2 px-4 rounded-lg bg-purple-700 hover:bg-purple-600 text-white text-sm font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500"
        >
          {actionLoading ? "Executing…" : "⚡ Execute On-Chain"}
        </button>
      ) : alreadySigned ? (
        <p className={`text-xs ${
          role === "admin1" ? "text-amber-400" :
          role === "admin2" ? "text-green-400" : "text-blue-400"
        }`}>
          ✓ Already signed by {cfg.labelJa}
        </p>
      ) : role !== "employee" ? (
        <button
          onClick={() => onConfirm(tx.safeTxHash)}
          disabled={actionLoading || !isSafeDeployed}
          className={`w-full py-2 px-4 rounded-lg text-white text-sm font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 ${BTN[cfg.color]}`}
        >
          {actionLoading
            ? "Processing…"
            : role === "admin1"
            ? "② 承認する (Approve)"
            : "③ 最終承認 (Final Approve)"}
        </button>
      ) : null}
    </div>
  );
}

interface Props {
  role: Role;
  pending: SafeTransaction[];
  actionLoading: boolean;
  ownersConfigured: boolean;
  isSafeDeployed: boolean;
  isEmployeeDelegate: boolean;
  accountAddress?: string;
  onPropose: (amount: string) => void;
  onConfirm: (safeTxHash: string) => void;
  onExecute: (safeTxHash: string) => void;
  onAddEmployeeDelegate: () => void;
}

export function RolePanel({
  role,
  pending,
  actionLoading,
  ownersConfigured,
  isSafeDeployed,
  isEmployeeDelegate,
  accountAddress,
  onPropose,
  onConfirm,
  onExecute,
  onAddEmployeeDelegate,
}: Props) {
  const [amount, setAmount]           = useState("0.001");
  const [description, setDescription] = useState("交通費精算 (Transportation Expense)");

  const cfg = ROLE_CONFIG[role];

  function alreadySigned(tx: SafeTransaction): boolean {
    if (!accountAddress) return false;
    const myAddr = accountAddress.toLowerCase();
    return tx.confirmations.some((c) => c.owner.toLowerCase() === myAddr);
  }

  return (
    <div
      className={`border rounded-xl p-5 space-y-4 ${RING[cfg.color].split(" ")[0]} bg-zinc-900/40`}
    >
      <h2 className={`font-semibold ${
        role === "employee" ? "text-blue-400" :
        role === "admin1"   ? "text-amber-400" : "text-green-400"
      }`}>
        {cfg.step} {cfg.labelJa} ({cfg.label})
      </h2>

      {/* ① Employee: propose */}
      {role === "employee" && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            交通費申請 (Propose Expense Reimbursement)
          </p>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Amount (ETH)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.001"
              min="0"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <p className="text-xs text-zinc-500">
            Recipient (個人EOA):{" "}
            {OWNER_ADDRESSES.employee ? shorten(OWNER_ADDRESSES.employee) : "not configured"}
          </p>
          {!isEmployeeDelegate && isSafeDeployed && (
            <p className="text-xs text-amber-400 border border-amber-700/50 bg-amber-900/10 rounded-lg px-3 py-2">
              申請を提出する前にOwnerから委任者として登録する必要があります。
            </p>
          )}
          <button
            onClick={() => onPropose(amount)}
            disabled={actionLoading || !ownersConfigured || !isSafeDeployed || !isEmployeeDelegate}
            className={`w-full py-2 px-4 rounded-lg text-white text-sm font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 ${BTN.blue}`}
          >
            {actionLoading ? "Submitting…" : "① 交通費申請を提出 (Submit Request)"}
          </button>
        </div>
      )}

      {/* ② ③ Admin: confirm pending TXs */}
      {(role === "admin1" || role === "admin2") && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            申請を確認し署名します。(Review and sign)
          </p>

          {/* Delegate setup */}
          <div className="border border-zinc-700 rounded-lg p-3 bg-zinc-800/50">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
              Employee Delegation
            </p>
            {isEmployeeDelegate ? (
              <p className="text-xs text-green-400">
                ✓ Employee is already registered as a delegate and can propose transactions.
              </p>
            ) : (
              <>
                <p className="text-xs text-zinc-400 mb-3">
                  社員を委任者として登録することで、申請の提出を許可します。
                </p>
                <button
                  onClick={onAddEmployeeDelegate}
                  disabled={actionLoading || !ownersConfigured || !isSafeDeployed}
                  className={`w-full py-2 px-4 rounded-lg text-white text-sm font-medium transition-colors disabled:bg-zinc-700 disabled:text-zinc-500 ${BTN[cfg.color]}`}
                >
                  {actionLoading ? "Setting up…" : "Add Employee as Delegate"}
                </button>
              </>
            )}
          </div>

          {pending.length === 0 && (
            <p className="text-sm text-zinc-500 italic">
              No pending transactions. Employee must submit a request first.
            </p>
          )}

          {pending.map((tx) => (
            <TxCard
              key={tx.safeTxHash}
              tx={tx}
              role={role}
              cfg={cfg}
              actionLoading={actionLoading}
              isSafeDeployed={isSafeDeployed}
              alreadySigned={alreadySigned(tx)}
              onConfirm={onConfirm}
              onExecute={onExecute}
            />
          ))}
        </div>
      )}

      {/* See fully-signed transactions that need manual execution */}
      {role === "employee" && pending.some((t) => t.confirmations.length >= t.confirmationsRequired) && (
        <div className="space-y-3 pt-2 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            承認済み・未実行 (Approved — awaiting execution)
          </p>
          {pending
            .filter((t) => t.confirmations.length >= t.confirmationsRequired)
            .map((tx) => (
              <TxCard
                key={tx.safeTxHash}
                tx={tx}
                role={role}
                cfg={cfg}
                actionLoading={actionLoading}
                isSafeDeployed={isSafeDeployed}
                alreadySigned={alreadySigned(tx)}
                onConfirm={onConfirm}
                onExecute={onExecute}
              />
            ))}
        </div>
      )}
    </div>
  );
}
