"use client";

import { useEffect, useState } from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type Listener = (t: ToastItem) => void;

const listeners: Listener[] = [];
let nextId = 1;

export function toast(message: string, tone: ToastTone = "info"): void {
  const item: ToastItem = { id: nextId++, message, tone };
  listeners.forEach((l) => l(item));
}

const STYLES: Record<ToastTone, string> = {
  success: "border-emerald-500/40 bg-emerald-950/85 text-emerald-100",
  error: "border-red-500/40 bg-red-950/85 text-red-100",
  info: "border-violet-500/40 bg-slate-950/85 text-slate-100",
};

const ACCENTS: Record<ToastTone, string> = {
  success: "from-emerald-400 to-cyan-400",
  error: "from-red-400 to-rose-500",
  info: "from-violet-400 to-cyan-400",
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (t) => {
      setItems((prev) => [...prev, t]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, 5000);
    };
    listeners.push(listener);
    return () => {
      const i = listeners.indexOf(listener);
      if (i >= 0) listeners.splice(i, 1);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto relative overflow-hidden rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur animate-pop ${STYLES[t.tone]}`}
        >
          <span className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${ACCENTS[t.tone]}`} />
          <p className="whitespace-pre-wrap break-words pl-1.5">{t.message}</p>
        </div>
      ))}
    </div>
  );
}
