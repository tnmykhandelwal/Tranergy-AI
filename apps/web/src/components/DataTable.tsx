"use client";

import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyMessage = "Nothing here yet.",
  className = "",
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div
        className={`relative overflow-hidden rounded-2xl border border-dashed border-slate-700/70 bg-slate-900/30 p-10 text-center ${className}`}
      >
        <div className="pointer-events-none absolute inset-0 mesh-bg opacity-30" />
        <p className="relative text-sm text-slate-400">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className={`panel overflow-x-auto ${className}`}>
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800/80 bg-slate-900/40 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-3 font-medium ${
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
                } ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
              className={`animate-fade-in border-b border-slate-800/40 transition-colors last:border-b-0 ${
                onRowClick ? "group cursor-pointer hover:bg-gradient-to-r hover:from-emerald-400/[0.06] hover:to-transparent" : "hover:bg-slate-800/25"
              }`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 text-slate-200 ${
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
                  } ${c.className ?? ""}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
