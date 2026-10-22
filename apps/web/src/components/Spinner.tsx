export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-400">
      <span className="relative inline-flex h-4 w-4">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-slate-600/50 border-t-emerald-400" />
        <span className="absolute inset-0 animate-ping rounded-full border border-emerald-400/20" />
      </span>
      {label ? <span className="text-sm">{label}</span> : null}
    </div>
  );
}

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-4 p-12">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-bounce rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
      <Spinner label={label} />
    </div>
  );
}
