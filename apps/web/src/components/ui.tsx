import type { ReactNode } from "react";

export interface CalloutProps {
  tone?: "success" | "error" | "info" | "warning";
  title?: string;
  children: ReactNode;
}

const TONES: Record<string, string> = {
  success: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  error: "border-red-500/35 bg-red-500/10 text-red-300",
  info: "border-cyan-500/35 bg-cyan-500/10 text-cyan-300",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-300",
};

const ACCENTS: Record<string, string> = {
  success: "from-emerald-400 to-cyan-400",
  error: "from-red-400 to-rose-500",
  info: "from-cyan-400 to-violet-400",
  warning: "from-amber-400 to-orange-500",
};

export function Callout({ tone = "info", title, children }: CalloutProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border px-3.5 py-3 text-sm ${TONES[tone] ?? TONES.info}`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${ACCENTS[tone] ?? ACCENTS.info}`}
      />
      {title ? <p className="mb-0.5 pl-1 font-semibold">{title}</p> : null}
      <div className="pl-1 text-xs leading-relaxed opacity-90 [&_pre]:whitespace-pre-wrap">{children}</div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-slate-700/70 bg-slate-900/30 px-6 py-12 text-center">
      <div className="pointer-events-none absolute inset-0 mesh-bg opacity-40" />
      <div className="relative">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/60 text-slate-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 7h16M4 12h10M4 17h7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <p className="mt-3 text-sm font-medium text-slate-300">{title}</p>
        {hint ? <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-700/70 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-violet-400/70 focus:bg-slate-950/70 focus:ring-2 focus:ring-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonPrimary =
  "group relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-gradient-to-r from-emerald-400 via-cyan-400 to-violet-400 bg-[length:200%_200%] px-3.5 py-2 text-sm font-semibold text-slate-950 shadow-[0_10px_28px_-14px_rgba(45,223,166,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[position:100%_50%] hover:shadow-[0_16px_34px_-16px_rgba(45,223,166,1)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";

export const buttonSecondary =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700/70 bg-slate-900/50 px-3.5 py-2 text-sm font-medium text-slate-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-600 hover:bg-slate-800/70 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40";

export const buttonDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-sm font-medium text-red-300 transition-all duration-200 hover:-translate-y-0.5 hover:bg-red-500/20 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40";

export const buttonGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40";

export const cardClass = "panel";
