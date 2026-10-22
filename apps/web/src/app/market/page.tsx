"use client";

import Link from "next/link";
import { useState } from "react";
import {
  createOffer,
  createRequest,
  getOffers,
  getRequests,
  matchesPreview,
  matchesRun,
  withdrawOffer,
  type MatchPreviewResult,
  type MatchRunResult,
  type Offer,
  type EnergyRequest,
} from "@/lib/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { canCreateOffer, canCreateRequest, canRunMatching, useSession } from "@/lib/session";
import { defaultRange, formatKwh, formatNum, formatPrice, formatTs, isoFromLocal } from "@/lib/format";
import { ApiBanner } from "@/components/ApiBanner";
import { Badge } from "@/components/Badge";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toast";
import {
  Callout,
  EmptyState,
  FieldLabel,
  buttonPrimary,
  buttonSecondary,
  cardClass,
  inputClass,
} from "@/components/ui";

export default function MarketPage() {
  const { userId, role } = useSession();
  const offers = useAsyncData(() => getOffers(), [userId], { refreshMs: 20000 });
  const requests = useAsyncData(() => getRequests(), [userId], { refreshMs: 20000 });

  const [offerErr, setOfferErr] = useState<string | null>(null);
  const [offerBusy, setOfferBusy] = useState(false);
  const [claimId, setClaimId] = useState("");
  const [offerKwh, setOfferKwh] = useState("20");
  const [offerPrice, setOfferPrice] = useState("0.12");

  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqKwh, setReqKwh] = useState("15");
  const [reqMaxPrice, setReqMaxPrice] = useState("0.15");
  const range = defaultRange();
  const [reqStart, setReqStart] = useState(range.toLocal);
  const [reqEnd, setReqEnd] = useState(range.toLocal);

  const [preview, setPreview] = useState<MatchPreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<MatchRunResult | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);

  const offline = offers.offline || requests.offline;
  const banner = offline
    ? "Cannot reach the API — the marketplace is unavailable until the backend is running."
    : offers.error ?? requests.error;

  const mayOffer = canCreateOffer(role);
  const mayRequest = canCreateRequest(role);
  const mayRun = canRunMatching(role);

  const refresh = () => {
    offers.reload();
    requests.reload();
  };

  const submitOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setOfferErr(null);
    const qty = Number(offerKwh);
    const price = Number(offerPrice);
    if (!claimId.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      toast("claimId, quantityKwh and pricePerKwh are required.", "error");
      return;
    }
    setOfferBusy(true);
    try {
      const offer = await createOffer({ claimId: claimId.trim(), quantityKwh: qty, pricePerKwh: price });
      toast(`Offer ${offer.id} created (${formatKwh(offer.quantityKwh)} @ ${formatPrice(offer.pricePerKwh)}/kWh)`, "success");
      setClaimId("");
      refresh();
      setPreview(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOfferErr(msg);
      toast(msg, "error");
    } finally {
      setOfferBusy(false);
    }
  };

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqErr(null);
    const qty = Number(reqKwh);
    const max = Number(reqMaxPrice);
    const start = isoFromLocal(reqStart);
    const end = isoFromLocal(reqEnd);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(max) || max <= 0 || !start || !end) {
      toast("quantityKwh, maxPricePerKwh and interval are required.", "error");
      return;
    }
    setReqBusy(true);
    try {
      const req = await createRequest({
        quantityKwh: qty,
        maxPricePerKwh: max,
        intervalStart: start,
        intervalEnd: end,
      });
      toast(`Request ${req.id} created`, "success");
      refresh();
      setPreview(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setReqErr(msg);
      toast(msg, "error");
    } finally {
      setReqBusy(false);
    }
  };

  const runPreview = async () => {
    setPreviewBusy(true);
    setPreviewErr(null);
    setRunResult(null);
    setRunErr(null);
    try {
      const res = await matchesPreview();
      setPreview(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPreviewErr(msg);
      toast(msg, "error");
    } finally {
      setPreviewBusy(false);
    }
  };

  const runMatch = async () => {
    setRunBusy(true);
    setRunErr(null);
    try {
      const res = await matchesRun();
      setRunResult(res);
      toast(`Created ${res.createdTrades.length} trade(s)`, "success");
      refresh();
      if (preview) runPreview();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunErr(msg);
      toast(msg, "error");
    } finally {
      setRunBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    try {
      await withdrawOffer(id);
      toast(`Offer ${id} withdrawn`, "success");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const offerColumns: Column<Offer>[] = [
    { key: "id", header: "Offer", render: (o) => <span className="font-mono text-xs text-emerald-300">{o.id}</span> },
    { key: "status", header: "Status", render: (o) => <Badge label={o.status} status={o.status} /> },
    { key: "facility", header: "Facility", render: (o) => <span className="text-xs">{o.facilityId}</span> },
    {
      key: "qty",
      header: "Qty / remaining",
      align: "right",
      render: (o) => (
        <span className="tabular-nums">
          {formatNum(o.quantityKwh)} / {formatNum(o.remainingKwh)}
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (o) => <span className="tabular-nums">{formatPrice(o.pricePerKwh)}</span>,
    },
    { key: "interval", header: "Interval", render: (o) => <span className="text-xs">{formatTs(o.intervalStart)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (o) =>
        mayOffer && o.status === "OPEN" && o.reservedKwh === 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              withdraw(o.id);
            }}
            className="text-xs text-red-300 hover:underline"
          >
            withdraw
          </button>
        ) : null,
    },
  ];

  const requestColumns: Column<EnergyRequest>[] = [
    { key: "id", header: "Request", render: (r) => <span className="font-mono text-xs text-cyan-300">{r.id}</span> },
    { key: "status", header: "Status", render: (r) => <Badge label={r.status} status={r.status} /> },
    {
      key: "qty",
      header: "Qty / allocated",
      align: "right",
      render: (r) => (
        <span className="tabular-nums">
          {formatNum(r.quantityKwh)} / {formatNum(r.allocatedKwh)}
        </span>
      ),
    },
    {
      key: "max",
      header: "Max price",
      align: "right",
      render: (r) => <span className="tabular-nums">{formatPrice(r.maxPricePerKwh)}</span>,
    },
    { key: "interval", header: "Interval", render: (r) => <span className="text-xs">{formatTs(r.intervalStart)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Marketplace"
        description="Verified surplus offers, consumer requests and explainable double-auction matching."
      />

      <ApiBanner message={banner} onRetry={refresh} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={`${cardClass} p-4`}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Offers</h2>
              <p className="text-xs text-slate-500">Verified surplus listed for sale</p>
            </div>
            <button type="button" onClick={offers.reload} className="text-xs text-slate-400 hover:text-slate-200">
              refresh
            </button>
          </div>
          <DataTable
            columns={offerColumns}
            rows={offers.data?.offers ?? []}
            rowKey={(o) => o.id}
            emptyMessage="No offers yet — verify a claim (Claims tab) then publish surplus here as a producer."
          />
          <form onSubmit={submitOffer} className="mt-4 space-y-3 border-t border-slate-800 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">New offer</p>
            {!mayOffer ? (
              <Callout tone="warning" title="Role gated">
                Creating an offer requires the <strong>producer</strong> or <strong>admin</strong> role.
              </Callout>
            ) : null}
            <div>
              <FieldLabel>Claim ID</FieldLabel>
              <input
                value={claimId}
                onChange={(e) => setClaimId(e.target.value)}
                placeholder="clm-… (must be a verified claim)"
                className={`${inputClass} font-mono`}
                disabled={!mayOffer}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Quantity (kWh)</FieldLabel>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={offerKwh}
                  onChange={(e) => setOfferKwh(e.target.value)}
                  className={inputClass}
                  disabled={!mayOffer}
                />
              </div>
              <div>
                <FieldLabel>Price / kWh</FieldLabel>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  className={inputClass}
                  disabled={!mayOffer}
                />
              </div>
            </div>
            <button type="submit" disabled={offerBusy || !mayOffer} className={buttonPrimary}>
              {offerBusy ? <Spinner /> : null} Publish offer
            </button>
            {offerErr ? <Callout tone="error" title="Offer rejected">{offerErr}</Callout> : null}
            <p className="text-[11px] text-slate-500">
              Eligibility is enforced server-side: the claim must be verified and 0 &lt; quantity ≤
              offerable kWh for the interval.
            </p>
          </form>
        </section>

        <section className={`${cardClass} p-4`}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Requests</h2>
              <p className="text-xs text-slate-500">Buy-side demand in the market</p>
            </div>
            <button type="button" onClick={requests.reload} className="text-xs text-slate-400 hover:text-slate-200">
              refresh
            </button>
          </div>
          <DataTable
            columns={requestColumns}
            rows={requests.data?.requests ?? []}
            rowKey={(r) => r.id}
            emptyMessage="No requests yet — publish demand from a consumer or admin account."
          />
          <form onSubmit={submitRequest} className="mt-4 space-y-3 border-t border-slate-800 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">New request</p>
            {!mayRequest ? (
              <Callout tone="warning" title="Role gated">
                Creating a request requires the <strong>consumer</strong> or <strong>admin</strong> role.
              </Callout>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Quantity (kWh)</FieldLabel>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={reqKwh}
                  onChange={(e) => setReqKwh(e.target.value)}
                  className={inputClass}
                  disabled={!mayRequest}
                />
              </div>
              <div>
                <FieldLabel>Max price / kWh</FieldLabel>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={reqMaxPrice}
                  onChange={(e) => setReqMaxPrice(e.target.value)}
                  className={inputClass}
                  disabled={!mayRequest}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Interval start</FieldLabel>
                <input
                  type="datetime-local"
                  value={reqStart}
                  onChange={(e) => setReqStart(e.target.value)}
                  className={inputClass}
                  disabled={!mayRequest}
                />
              </div>
              <div>
                <FieldLabel>Interval end</FieldLabel>
                <input
                  type="datetime-local"
                  value={reqEnd}
                  onChange={(e) => setReqEnd(e.target.value)}
                  className={inputClass}
                  disabled={!mayRequest}
                />
              </div>
            </div>
            <button type="submit" disabled={reqBusy || !mayRequest} className={buttonPrimary}>
              {reqBusy ? <Spinner /> : null} Publish request
            </button>
            {reqErr ? <Callout tone="error" title="Request rejected">{reqErr}</Callout> : null}
          </form>
        </section>
      </div>

      <section className={`${cardClass} mt-5 p-4`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Matching</h2>
            <p className="text-xs text-slate-500">
              Preview is a pure computation — run matching transactionally creates trades in MATCHED state and
              reserves offer quantity.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={runPreview} disabled={previewBusy} className={buttonSecondary}>
              {previewBusy ? <Spinner /> : null} Preview matches
            </button>
            <button type="button" onClick={runMatch} disabled={runBusy || !mayRun} className={buttonPrimary}>
              {runBusy ? <Spinner /> : null} Run matching
            </button>
          </div>
        </div>

        {!mayRun ? (
          <div className="mb-3">
            <Callout tone="warning" title="Role gated">
              Running the matcher requires the <strong>verifier</strong> or <strong>admin</strong> role. Preview is available to everyone.
            </Callout>
          </div>
        ) : null}

        {previewErr ? <Callout tone="error" title="Preview failed">{previewErr}</Callout> : null}
        {runErr ? <Callout tone="error" title="Matching failed">{runErr}</Callout> : null}

        {preview ? (
          <div className="space-y-4">
            {preview.matches.length === 0 ? (
              <EmptyState
                title="No compatible matches"
                hint="No open offer/request pairs share the exact interval with price ≤ max. Publish a request whose interval matches an open offer."
              />
            ) : (
              <DataTable
                columns={[
                  { key: "offer", header: "Offer", render: (m) => <span className="font-mono text-xs">{m.offerId}</span> },
                  { key: "req", header: "Request", render: (m) => <span className="font-mono text-xs">{m.requestId}</span> },
                  { key: "kwh", header: "Agreed", align: "right", render: (m) => formatKwh(m.agreedKwh) },
                  { key: "price", header: "Price", align: "right", render: (m) => formatPrice(m.pricePerKwh) },
                  { key: "reason", header: "Reason", render: (m) => <span className="text-xs text-slate-400">{m.reason}</span> },
                ]}
                rows={preview.matches}
                rowKey={(m) => `${m.offerId}-${m.requestId}-${m.intervalStart}`}
              />
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Unmatched offers</p>
                {preview.unmatchedOffers.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">none — every open offer matched.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs">
                    {preview.unmatchedOffers.map((u) => (
                      <li key={u.offerId} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-slate-300">{u.offerId}</span>
                        <span className="text-amber-300">{u.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Unmatched requests</p>
                {preview.unmatchedRequests.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">none — every open request matched.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs">
                    {preview.unmatchedRequests.map((u) => (
                      <li key={u.requestId} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-slate-300">{u.requestId}</span>
                        <span className="text-amber-300">{u.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Click “Preview matches” to run the deterministic matcher without writing anything.
          </p>
        )}

        {runResult ? (
          <div className="mt-4 space-y-3">
            <Callout tone="success" title={`Matching executed — ${runResult.createdTrades.length} trade(s) created`}>
              {runResult.skipped?.length ? (
                <p>{runResult.skipped.length} skipped (insufficient remaining quantity or invalid state).</p>
              ) : null}
            </Callout>
            {runResult.createdTrades.length > 0 ? (
              <DataTable
                columns={[
                  {
                    key: "id",
                    header: "Trade",
                    render: (t) => (
                      <Link href={`/trades?trade=${encodeURIComponent(t.tradeId)}`} className="font-mono text-xs text-emerald-300 hover:underline">
                        {t.tradeId}
                      </Link>
                    ),
                  },
                  { key: "offer", header: "Offer", render: (t) => <span className="font-mono text-xs">{t.offerId}</span> },
                  { key: "req", header: "Request", render: (t) => <span className="font-mono text-xs">{t.requestId}</span> },
                  { key: "kwh", header: "Agreed", align: "right", render: (t) => formatKwh(t.agreedKwh) },
                  { key: "price", header: "Price", align: "right", render: (t) => formatPrice(t.pricePerKwh) },
                  { key: "state", header: "State", render: (t) => <Badge label={t.state} status={t.state} /> },
                ]}
                rows={runResult.createdTrades}
                rowKey={(t) => t.tradeId}
              />
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
