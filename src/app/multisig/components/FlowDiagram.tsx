const STEPS = [
  { step: "①", label: "社員",       sub: "申請署名",      color: "blue"   },
  null,
  { step: "②", label: "上長",       sub: "承認署名",      color: "amber"  },
  null,
  { step: "③", label: "経理担当",   sub: "最終承認・実行", color: "green"  },
  null,
  { step: "④", label: "会社SW→個人SW", sub: "ETH送金",    color: "purple" },
] as const;

const BORDER: Record<string, string> = {
  blue:   "border-blue-500/30   bg-blue-500/10",
  amber:  "border-amber-500/30  bg-amber-500/10",
  green:  "border-green-500/30  bg-green-500/10",
  purple: "border-purple-500/30 bg-purple-500/10",
};

export function FlowDiagram() {
  return (
    <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
        Approval Flow
      </p>
      <div className="flex items-center gap-2 flex-wrap text-sm">
        {STEPS.map((item, i) =>
          item === null ? (
            <span key={i} className="text-zinc-700 text-lg">→</span>
          ) : (
            <div
              key={i}
              className={`px-3 py-2 rounded-lg border text-center ${BORDER[item.color]}`}
            >
              <div className="font-bold">{item.step} {item.label}</div>
              <div className="text-xs text-zinc-400">{item.sub}</div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
