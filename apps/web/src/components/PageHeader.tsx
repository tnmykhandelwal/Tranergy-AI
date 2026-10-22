import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-1 w-6 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Tranergy workspace
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-[1.7rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
