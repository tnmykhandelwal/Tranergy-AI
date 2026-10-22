"use client";

export function AnomalyGauge({ score, size = 120 }: { score?: number | null; size?: number }) {
  const value = typeof score === "number" && !Number.isNaN(score) ? Math.min(1, Math.max(0, score)) : null;
  const color = value === null ? "#64789f" : value < 0.5 ? "#2ddfa6" : value < 0.7 ? "#fbbf24" : "#f87171";
  const r = 40;
  const cx = 50;
  const cy = 50;
  const pathLength = Math.PI * r;
  const dash = value === null ? 0 : pathLength * value;

  return (
    <div className="flex shrink-0 flex-col items-center" style={{ width: size }}>
      <svg viewBox="0 0 100 60" width={size} height={size * 0.6} aria-hidden="true">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="currentColor"
          className="text-slate-800/80"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${pathLength}`}
          style={{
            transition: "stroke-dasharray 700ms cubic-bezier(0.22, 1, 0.36, 1)",
            filter: `drop-shadow(0 0 6px ${color}55)`,
          }}
        />
        <circle cx={cx} cy={cy} r="2.5" className="fill-slate-600" />
      </svg>
      <p className="-mt-1 text-lg font-semibold tabular-nums" style={{ color }}>
        {value === null ? "n/a" : value.toFixed(2)}
      </p>
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">anomaly score</p>
    </div>
  );
}
