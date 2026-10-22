"use client";

export interface ApiBannerProps {
  message?: string | null;
  onRetry?: () => void;
}

export function ApiBanner({ message, onRetry }: ApiBannerProps) {
  if (!message) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 animate-fade-in">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-[10px] font-bold text-slate-950">
          !
        </span>
        <div>
          <p className="text-sm font-medium text-amber-300">API unreachable</p>
          <p className="text-xs text-amber-300/80">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:-translate-y-0.5 hover:bg-amber-500/10"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
