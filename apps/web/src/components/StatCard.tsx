import type { ReactNode } from "react";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: string;
}

export function StatCard({ label, value, hint, accent = "text-emerald-300" }: StatCardProps) {
  return (
    <div className="panel-interactive group relative overflow-hidden p-4">
      <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
      <span className="pointer-events-none absolute -right-8 -top-10 h-20 w-20 rounded-full bg-gradient-to-br from-emerald-400/20 to-violet-500/10 blur-2xl transition group-hover:scale-125" />
      <p className="relative text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`relative mt-2 text-2xl font-semibold tabular-nums tracking-tight ${accent}`}>
        {value}
      </p>
      {hint ? <p className="relative mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}
