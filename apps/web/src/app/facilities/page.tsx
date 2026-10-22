"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getFacilities,
  getFacilityEnergy,
  importReadingsCsv,
  runSimulator,
  type EnergyInterval,
  type Facility,
  type ImportResult,
} from "@/lib/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { defaultRange, formatNum, formatTs, isoFromLocal } from "@/lib/format";
import { ApiBanner } from "@/components/ApiBanner";
import { Badge } from "@/components/Badge";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toast";
import { Callout, FieldLabel, buttonPrimary, buttonSecondary, cardClass, inputClass } from "@/components/ui";

interface TooltipProps {
  active?: boolean;
  payload?: {
    payload: EnergyInterval;
  }[];
}

function EnergyTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]!.payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-slate-200">{formatTs(d.intervalStart)}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-300">
        <span>generation</span>
        <span className="text-right tabular-nums">{formatNum(d.generationKwh)}</span>
        <span>load</span>
        <span className="text-right tabular-nums">{formatNum(d.loadKwh)}</span>
        <span>export</span>
        <span className="text-right tabular-nums">{formatNum(d.exportKwh)}</span>
        <span>import</span>
        <span className="text-right tabular-nums">{formatNum(d.importKwh)}</span>
        <span>battery charge</span>
        <span className="text-right tabular-nums">{formatNum(d.batteryChargeKwh)}</span>
        <span>battery discharge</span>
        <span className="text-right tabular-nums">{formatNum(d.batteryDischargeKwh)}</span>
        <span className="text-emerald-300">estimated surplus</span>
        <span className="text-right tabular-nums text-emerald-300">{formatNum(d.estimatedSurplusKwh)}</span>
        <span className="text-cyan-300">offerable</span>
        <span className="text-right tabular-nums text-cyan-300">{formatNum(d.offerableKwh)}</span>
        <span>balance residual</span>
        <span className="text-right tabular-nums">{formatNum(d.balanceResidualKwh)}</span>
        <span>claim status</span>
        <span className="text-right">{d.claimStatus ?? "—"}</span>
      </div>
    </div>
  );
}

export default function FacilitiesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const range = useRef(defaultRange());
  const [fromLocal, setFromLocal] = useState(range.current.fromLocal);
  const [toLocal, setToLocal] = useState(range.current.toLocal);
  const [appliedFrom, setAppliedFrom] = useState(range.current.fromLocal);
  const [appliedTo, setAppliedTo] = useState(range.current.toLocal);
  const [simBusy, setSimBusy] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const facilities = useAsyncData(() => getFacilities(), [], { refreshMs: 60000 });
  const activeId = selectedId ?? facilities.data?.facilities[0]?.id ?? null;
  const energy = useAsyncData(
    () =>
      activeId
        ? getFacilityEnergy(
            activeId,
            isoFromLocal(appliedFrom) ?? undefined,
            isoFromLocal(appliedTo) ?? undefined,
          )
        : Promise.reject(new Error("No facility selected")),
    [activeId, appliedFrom, appliedTo],
    { refreshMs: 60000 },
  );

  const offline = facilities.offline || energy.offline;
  const banner = offline
    ? "Cannot reach the API — facility data is unavailable until the backend is running."
    : energy.error && activeId
      ? energy.error
      : facilities.error
        ? facilities.error
        : null;

  const applyRange = () => {
    setAppliedFrom(fromLocal);
    setAppliedTo(toLocal);
  };

  const intervals = useMemo(() => energy.data?.intervals ?? [], [energy.data]);

  const chartData = useMemo(
    () =>
      intervals.map((i) => ({
        ...i,
        label: formatTs(i.intervalStart),
        generation: i.generationKwh ?? null,
        load: i.loadKwh ?? null,
        exportKw: i.exportKwh ?? null,
        importKw: i.importKwh ?? null,
      })),
    [intervals],
  );

  const columns: Column<EnergyInterval>[] = [
    { key: "start", header: "Interval start", render: (i) => formatTs(i.intervalStart) },
    { key: "gen", header: "Gen (kWh)", align: "right", render: (i) => formatNum(i.generationKwh) },
    { key: "load", header: "Load (kWh)", align: "right", render: (i) => formatNum(i.loadKwh) },
    { key: "exp", header: "Export (kWh)", align: "right", render: (i) => formatNum(i.exportKwh) },
    { key: "imp", header: "Import (kWh)", align: "right", render: (i) => formatNum(i.importKwh) },
    {
      key: "surplus",
      header: "Est. surplus (kWh)",
      align: "right",
      className: "text-emerald-300",
      render: (i) => formatNum(i.estimatedSurplusKwh),
    },
    {
      key: "offerable",
      header: "Offerable (kWh)",
      align: "right",
      className: "text-cyan-300",
      render: (i) => formatNum(i.offerableKwh),
    },
    {
      key: "residual",
      header: "Residual (kWh)",
      align: "right",
      render: (i) => formatNum(i.balanceResidualKwh),
    },
    {
      key: "claim",
      header: "Claim",
      render: (i) =>
        i.claimStatus ? <Badge label={i.claimStatus} status={i.claimStatus} /> : <span className="text-slate-600">—</span>,
    },
  ];

  const handleSimulator = async () => {
    setSimBusy(true);
    try {
      const res = await runSimulator({ days: 7, injectAnomalies: true });
      toast(
        `Generated ${res.readingsWritten} readings over ${res.days}d` +
          (res.anomaliesInjected.length
            ? ` (anomalies: ${res.anomaliesInjected.join(", ")})`
            : ""),
        "success",
      );
      energy.reload();
      facilities.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSimBusy(false);
    }
  };

  const importCsv = async () => {
    if (!csvText.trim()) {
      toast("Paste or load a CSV first.", "error");
      return;
    }
    setCsvBusy(true);
    setCsvError(null);
    try {
      const res = await importReadingsCsv(csvText);
      setCsvResult(res);
      toast(`Imported ${res.imported} readings`, "success");
      energy.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCsvError(msg);
      setCsvResult(null);
      toast(msg, "error");
    } finally {
      setCsvBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  return (
    <div>
      <PageHeader
        title="Facilities & energy"
        description="Metered balances, surplus estimation and offerable kWh per interval."
        actions={
          <button type="button" onClick={handleSimulator} disabled={simBusy} className={buttonPrimary}>
            {simBusy ? <Spinner /> : null}
            Generate meter data (7d)
          </button>
        }
      />

      <ApiBanner message={banner} onRetry={() => { facilities.reload(); energy.reload(); }} />

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className={`${cardClass} h-fit p-3`}>
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Facilities
          </p>
          {facilities.loading && !facilities.data ? (
            <div className="p-3">
              <Spinner label="Loading…" />
            </div>
          ) : (
            <ul className="space-y-1">
              {(facilities.data?.facilities ?? []).map((f: Facility) => {
                const active = f.id === activeId;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(f.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition ${
                        active
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-transparent hover:bg-slate-800/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">{f.name}</span>
                        <Badge label={f.type} status={f.type} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-mono">{f.id}</span>
                        <span>{f.installedCapacityKw} kW</span>
                      </div>
                    </button>
                  </li>
                );
              })}
              {facilities.data && facilities.data.facilities.length === 0 ? (
                <li className="px-2 py-4 text-xs text-slate-500">
                  No facilities yet — create one on the{" "}
                  <Link href="/setup" className="text-emerald-300 hover:underline">
                    Setup
                  </Link>{" "}
                  page.
                </li>
              ) : null}
            </ul>
          )}
        </div>

        <div className="space-y-5">
          <div className={`${cardClass} p-4`}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  {facilities.data?.facilities.find((f) => f.id === activeId)?.name ?? "Facility"}
                </h2>
                <p className="text-xs text-slate-500">Generation vs load vs grid exchange per interval</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <FieldLabel>From</FieldLabel>
                  <input
                    type="datetime-local"
                    value={fromLocal}
                    onChange={(e) => setFromLocal(e.target.value)}
                    className={`${inputClass} w-52`}
                  />
                </div>
                <div>
                  <FieldLabel>To</FieldLabel>
                  <input
                    type="datetime-local"
                    value={toLocal}
                    onChange={(e) => setToLocal(e.target.value)}
                    className={`${inputClass} w-52`}
                  />
                </div>
                <button type="button" onClick={applyRange} className={buttonSecondary}>
                  Apply range
                </button>
              </div>
            </div>

            {energy.loading ? (
              <div className="flex h-72 items-center justify-center">
                <Spinner label="Loading energy data…" />
              </div>
            ) : intervals.length === 0 ? (
              <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 text-center">
                <p className="text-sm text-slate-300">No readings in this window</p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Widen the date range, generate meter data for the last 7 days, or import meter CSV data below.
                </p>
              </div>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                    <defs>
                      <linearGradient id="genFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2ddfa6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#2ddfa6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1d2a44" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64789f", fontSize: 10 }}
                      tickFormatter={(v: string) => v.split(", ")[1] ?? v}
                      minTickGap={24}
                    />
                    <YAxis tick={{ fill: "#64789f", fontSize: 10 }} width={44} />
                    <Tooltip content={<EnergyTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="generation"
                      name="Generation"
                      stroke="#2ddfa6"
                      fill="url(#genFill)"
                      strokeWidth={2}
                      connectNulls
                    />
                    <Line type="monotone" dataKey="load" name="Load" stroke="#22d3ee" strokeWidth={1.5} dot={false} connectNulls />
                    <Line type="monotone" dataKey="exportKw" name="Export" stroke="#818cf8" strokeWidth={1.5} dot={false} connectNulls />
                    <Line type="monotone" dataKey="importKw" name="Import" stroke="#f472b6" strokeWidth={1.5} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Generation</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-400" /> Load</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-400" /> Export</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-pink-400" /> Import</span>
            </div>

            {energy.data?.assumptions?.length ? (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Assumptions (from API)
                </p>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-400">
                  {energy.data.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <DataTable
            columns={columns}
            rows={intervals}
            rowKey={(i) => `${i.intervalStart}-${i.intervalEnd}`}
            emptyMessage="No intervals in the selected window."
            className="text-xs"
          />

          <div className={`${cardClass} p-4`}>
            <h2 className="text-sm font-semibold text-slate-100">Import meter readings (CSV)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Header: <code className="text-slate-400">meterId,facilityId,meterType,intervalStart,intervalEnd,energyKwh</code>
            </p>
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => onFile(e.target.files?.[0])}
                  className="text-xs text-slate-400 file:mr-3 file:rounded-md file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
                />
                <button type="button" onClick={importCsv} disabled={csvBusy} className={buttonPrimary}>
                  {csvBusy ? <Spinner /> : null} Import CSV
                </button>
              </div>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder={"meterId,facilityId,meterType,intervalStart,intervalEnd,energyKwh\nm-solar-gen,fac-solar-1,generation,2026-10-17T10:00:00Z,2026-10-17T11:00:00Z,42.5"}
                className={`${inputClass} font-mono text-xs`}
              />
              {csvResult ? (
                <Callout tone="success" title="Import finished">
                  <div className="flex flex-wrap gap-4">
                    <span>imported: <strong>{csvResult.imported}</strong></span>
                    <span>skippedDuplicates: <strong>{csvResult.skippedDuplicates}</strong></span>
                    <span>invalid: <strong>{csvResult.invalid}</strong></span>
                  </div>
                  {csvResult.errors?.length ? (
                    <ul className="mt-2 list-inside list-disc">
                      {csvResult.errors.slice(0, 10).map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                  ) : null}
                </Callout>
              ) : null}
              {csvError ? <Callout tone="error" title="Import failed">{csvError}</Callout> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
