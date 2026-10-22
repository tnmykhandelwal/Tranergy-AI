"use client";

import Link from "next/link";
import { getChainStatus, getHealth, getOffers, getRequests, getTrades, getVerificationCases, type Trade } from "@/lib/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { useSession } from "@/lib/session";
import { formatKwh, formatPrice, formatTs } from "@/lib/format";
import { ApiBanner } from "@/components/ApiBanner";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column } from "@/components/DataTable";
import { PageLoading } from "@/components/Spinner";
import { cardClass } from "@/components/ui";

const REFRESH_MS = 15000;

export default function DashboardPage() {
  const { userId } = useSession();
  const offers = useAsyncData(() => getOffers("OPEN"), [userId], { refreshMs: REFRESH_MS });
  const requests = useAsyncData(() => getRequests("OPEN"), [userId], { refreshMs: REFRESH_MS });
  const trades = useAsyncData(() => getTrades(), [userId], { refreshMs: REFRESH_MS });
  const health = useAsyncData(() => getHealth(), [], { refreshMs: REFRESH_MS });
  const chain = useAsyncData(() => getChainStatus(), [], { refreshMs: 20000 });
  const cases = useAsyncData(() => getVerificationCases("OPEN"), [userId], { refreshMs: REFRESH_MS });

  const loading =
    offers.loading && requests.loading && trades.loading && health.loading && chain.loading && cases.loading;
  const offlineSource = [offers, requests, trades, health, chain, cases].find((s) => s.offline);
  const anyError = [offers, requests, trades, health, chain, cases].find((s) => s.error);
  const bannerMessage = offlineSource
    ? `${offlineSource.error ?? "API unreachable"} — start the API (npm run dev -w services/api) then retry.`
    : anyError
      ? anyError.error
      : null;

  const reloadAll = () => {
    offers.reload();
    requests.reload();
    trades.reload();
    health.reload();
    chain.reload();
    cases.reload();
  };

  const tradeRows = [...(trades.data?.trades ?? [])]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 8);

  const stateCounts = new Map<string, number>();
  for (const t of trades.data?.trades ?? []) {
    stateCounts.set(t.state, (stateCounts.get(t.state) ?? 0) + 1);
  }

  const columns: Column<Trade>[] = [
    {
      key: "id",
      header: "Trade",
      render: (t) => (
        <Link href={`/trades?trade=${encodeURIComponent(t.id)}`} className="font-mono text-xs text-emerald-300 hover:underline">
          {t.id}
        </Link>
      ),
    },
    { key: "state", header: "State", render: (t) => <Badge label={t.state} status={t.state} /> },
    { key: "kwh", header: "Agreed", align: "right", render: (t) => formatKwh(t.agreedKwh) },
    {
      key: "price",
      header: "Price /kWh",
      align: "right",
      render: (t) => formatPrice(t.pricePerKwh),
    },
    { key: "created", header: "Created", render: (t) => formatTs(t.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live overview of offers, requests, trades and system health — auto-refreshes every 15s."
        actions={
          <button
            type="button"
            onClick={reloadAll}
            className="rounded-lg border border-slate-700/80 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
          >
            Refresh
          </button>
        }
      />

      <ApiBanner message={bannerMessage} onRetry={reloadAll} />

      {loading ? (
        <PageLoading label="Loading dashboard…" />
      ) : (
        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/30 p-5">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -right-10 -top-16 h-48 w-48 animate-float rounded-full bg-violet-500/20 blur-3xl" />
              <div className="absolute -bottom-20 left-1/4 h-44 w-44 animate-float-slow rounded-full bg-emerald-400/15 blur-3xl" />
              <div className="absolute inset-0 mesh-bg opacity-30" />
            </div>
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
                  Trust pipeline
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-50">
                  Evidence in. <span className="text-gradient">Verified settlement out.</span>
                </h2>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
                  Certificates and meter intervals are checked before energy is matched into escrow.
                  Suspicious evidence waits for a verifier instead of silently trading.
                </p>
              </div>
              <Link
                href="/claims"
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:-translate-y-0.5 hover:bg-emerald-400/15"
              >
                Review evidence
                <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="relative mt-5 grid gap-2 sm:grid-cols-4">
              {[
                { n: "01", label: "Evidence", tone: "from-emerald-400 to-cyan-400" },
                { n: "02", label: "Verification", tone: "from-cyan-400 to-violet-400" },
                { n: "03", label: "Escrow match", tone: "from-violet-400 to-fuchsia-400" },
                { n: "04", label: "Settlement", tone: "from-fuchsia-400 to-amber-400" },
              ].map((step) => (
                <div
                  key={step.n}
                  className="group flex items-center gap-2.5 rounded-xl border border-slate-800/70 bg-slate-950/40 px-3 py-2 transition hover:-translate-y-0.5 hover:border-slate-700"
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${step.tone} text-[10px] font-bold text-slate-950`}
                  >
                    {step.n}
                  </span>
                  <span className="text-xs font-medium text-slate-300">{step.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="Open offers"
              value={offers.data?.offers.length ?? 0}
              accent="text-cyan-300"
              hint="Verified surplus listed for sale"
            />
            <StatCard
              label="Open requests"
              value={requests.data?.requests.length ?? 0}
              accent="text-violet-300"
              hint="Buy-side demand in the market"
            />
            <StatCard
              label="Trades"
              value={trades.data?.trades.length ?? 0}
              accent="text-emerald-300"
              hint={
                stateCounts.size
                  ? Array.from(stateCounts.entries())
                      .map(([s, n]) => `${s} ${n}`)
                      .join(" · ")
                  : "Run matching in the Marketplace to create trades"
              }
            />
            <StatCard
              label="Chain"
              value={
                chain.data?.connected
                  ? `block ${chain.data.blockNumber ?? "—"}`
                  : chain.data?.enabled
                    ? "RPC down"
                    : "disabled"
              }
              accent={
                chain.data?.connected ? "text-emerald-300" : chain.data?.enabled ? "text-amber-300" : "text-slate-400"
              }
              hint={
                chain.data?.error
                  ? chain.data.error
                  : health.data?.ok
                    ? `API ok · ML ${health.data.mlUrl ? "configured" : "—"}`
                    : "API health unknown"
              }
            />
            <StatCard
              label="Review queue"
              value={cases.data?.cases.length ?? 0}
              accent={(cases.data?.cases.length ?? 0) > 0 ? "text-orange-300" : "text-slate-300"}
              hint="Open verification cases"
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Recent trades
              </h2>
              <DataTable
                columns={columns}
                rows={tradeRows}
                rowKey={(t) => t.id}
                emptyMessage="No trades yet — verify a claim, publish an offer and a request, then run matching in the Marketplace."
              />
            </div>
            <div className={`${cardClass} p-4`}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Review queue
              </h2>
              <p className="mt-3 text-3xl font-semibold text-orange-300">
                {cases.data?.cases.length ?? 0}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Claims flagged by deterministic rules or the anomaly model await a verifier decision.
              </p>
              <Link
                href="/claims"
                className="mt-4 inline-flex rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-sm text-emerald-300 transition hover:border-emerald-500/40 hover:bg-slate-800"
              >
                Open review queue →
              </Link>
              <div className="mt-5 space-y-2 border-t border-slate-800 pt-4 text-xs text-slate-400">
                <div className="flex items-center justify-between">
                  <span>API</span>
                  <Badge
                    label={health.data?.ok ? "healthy" : "unknown"}
                    status={health.data?.ok ? "VERIFIED" : "UNKNOWN"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Chain enabled</span>
                  <Badge
                    label={health.data?.chainEnabled ? "yes" : "no"}
                    status={health.data?.chainEnabled ? "VERIFIED" : "UNKNOWN"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Chain connected</span>
                  <Badge
                    label={chain.data?.connected ? "yes" : "no"}
                    status={chain.data?.connected ? "VERIFIED" : "UNKNOWN"}
                  />
                </div>
                {health.data?.time ? (
                  <p className="text-slate-500">Last API heartbeat: {formatTs(health.data.time)}</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
