const TONES: Record<string, string> = {
  MATCHED: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  EVIDENCE_SUBMITTED: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  SETTLED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  DISPUTED: "bg-red-500/15 text-red-300 border-red-500/30",
  REVIEW_REQUIRED: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  PENDING: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  VERIFIED_FOR_PROTOTYPE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  REJECTED_BY_RULE: "bg-red-500/15 text-red-300 border-red-500/30",
  OPEN: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  PARTIALLY_RESERVED: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  FILLED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  WITHDRAWN: "bg-slate-500/15 text-slate-400 border-slate-600/40",
  BLOCKED: "bg-red-500/15 text-red-300 border-red-500/30",
  APPROVED_BY_REVIEWER: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  REJECTED_BY_REVIEWER: "bg-red-500/15 text-red-300 border-red-500/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  TRANSFERRED: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  RETIRED: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  INVALID: "bg-red-500/15 text-red-300 border-red-500/30",
  UNKNOWN: "bg-slate-500/15 text-slate-400 border-slate-600/40",
  producer: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  consumer: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  storage: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  mixed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  coordinator: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  verifier: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  admin: "bg-red-500/15 text-red-300 border-red-500/30",
  ATTESTED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ANOMALY_FLAGGED: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  NORMAL: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  UNAVAILABLE: "bg-slate-500/15 text-slate-400 border-slate-600/40",
  VERIFIED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const DISPLAY: Record<string, string> = {
  VERIFIED_FOR_PROTOTYPE: "verified",
  REJECTED_BY_RULE: "rejected",
  REVIEW_REQUIRED: "review",
  APPROVED_BY_REVIEWER: "approved",
  REJECTED_BY_REVIEWER: "rejected",
  EVIDENCE_SUBMITTED: "evidence",
  ANOMALY_FLAGGED: "flagged",
  PARTIALLY_RESERVED: "partial",
};

const LIVELY = new Set(["OPEN", "ANOMALY_FLAGGED", "REVIEW_REQUIRED", "EVIDENCE_SUBMITTED"]);

const FALLBACK = "bg-slate-500/15 text-slate-300 border-slate-600/40";

export interface BadgeProps {
  label: string;
  status?: string | null;
  tone?: string;
  className?: string;
}

export function Badge({ label, status, tone, className = "" }: BadgeProps) {
  const key = status ?? label;
  const cls = tone ?? TONES[key] ?? FALLBACK;
  const text = DISPLAY[key] ?? label;
  const live = LIVELY.has(key);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide ${cls} ${className}`}
    >
      <span className={`relative flex h-1.5 w-1.5 ${live ? "" : "opacity-60"}`}>
        {live ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
        ) : null}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {text}
    </span>
  );
}
