"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  attestTrade,
  disputeTrade,
  getReceipt,
  getTrades,
  postEvidence,
  type AttestResult,
  type EvidenceResult,
  type Trade,
} from "@/lib/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { canDecideCases, useSession } from "@/lib/session";
import { formatKwh, formatNum, formatPrice, formatTs, formatWei, shortHex } from "@/lib/format";
import { ApiBanner } from "@/components/ApiBanner";
import { Badge } from "@/components/Badge";
import { DataTable, type Column } from "@/components/DataTable";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { PageLoading, Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toast";
import {
  Callout,
  FieldLabel,
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from "@/components/ui";

function CopyableHex({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-600">—</span>;
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        toast("Copied to clipboard", "info");
      }}
      className="font-mono text-xs text-cyan-300 hover:underline"
    >
      {shortHex(value, 8, 6)}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function KeyValue({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-0.5 text-xs">
      <span className="text-slate-500">{k}</span>
      <span className="text-right text-slate-200">{v}</span>
    </div>
  );
}

function TradeDetailModal({
  tradeId,
  onClose,
  onChanged,
}: {
  tradeId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { role } = useSession();
  const mayDecide = canDecideCases(role);
  const receipt = useAsyncData(
    () => (tradeId ? getReceipt(tradeId) : Promise.resolve(null)),
    [tradeId],
  );
  const [action, setAction] = useState<"none" | "evidence" | "dispute">("none");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; title: string; body: string } | null>(null);
  const [producerExport, setProducerExport] = useState("");
  const [consumerImport, setConsumerImport] = useState("");
  const [notes, setNotes] = useState("");
  const [refs, setRefs] = useState("");
  const [disputeReason, setDisputeReason] = useState("");

  const tradeState = receipt.data?.trade?.state;
  const resetAction = useCallback(() => {
    setAction("none");
    setProducerExport("");
    setConsumerImport("");
    setNotes("");
    setRefs("");
    setDisputeReason("");
  }, []);

  useEffect(() => {
    setResult(null);
    resetAction();
  }, [tradeId, resetAction]);

  const submitEvidence = async () => {
    if (!tradeId) return;
    const p = Number(producerExport);
    const c = Number(consumerImport);
    if (!Number.isFinite(p) || !Number.isFinite(c)) {
      toast("Producer export and consumer import must be numbers.", "error");
      return;
    }
    setBusy(true);
    try {
      const res: EvidenceResult = await postEvidence(tradeId, {
        producerExportKwh: p,
        consumerImportKwh: c,
        notes: notes.trim() || undefined,
        recordReferences: refs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setResult({
        tone: "success",
        title: "Evidence submitted",
        body: `discrepancyPct ${formatNum(res.discrepancyPct)}% · withinTolerance ${
          res.withinTolerance === undefined ? "unknown" : res.withinTolerance
        } · chainTx ${res.chainTxHash ?? "none"} · trade now ${res.trade.state}`,
      });
      toast("Delivery evidence attached", "success");
      resetAction();
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Evidence failed", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const attest = async () => {
    if (!tradeId) return;
    setBusy(true);
    try {
      const res: AttestResult = await attestTrade(tradeId);
      setResult({
        tone: "success",
        title: "Attested & settled",
        body: res.chainDisabled
          ? `trade ${res.trade.state} (chain disabled — settled off-chain)`
          : `trade ${res.trade.state} · settlement tx ${res.settlementTxHash ?? res.trade.settlementTxHash ?? "—"}`,
      });
      toast("Trade settled", "success");
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Attest failed", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const dispute = async () => {
    if (!tradeId) return;
    if (!disputeReason.trim()) {
      toast("A dispute reason is required.", "error");
      return;
    }
    setBusy(true);
    try {
      const t = await disputeTrade(tradeId, disputeReason.trim());
      setResult({ tone: "success", title: "Trade disputed", body: `state is now ${t.state}` });
      toast("Trade disputed", "success");
      resetAction();
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Dispute failed", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const r = receipt.data;

  return (
    <Modal open={tradeId !== null} title={`Trade ${tradeId ?? ""}`} onClose={onClose} wide>
      {receipt.loading ? (
        <div className="p-8">
          <Spinner label="Loading receipt…" />
        </div>
      ) : receipt.error ? (
        <Callout tone="error" title="Could not load receipt">
          {receipt.error}
        </Callout>
      ) : r ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Section title="Trade">
              <KeyValue k="id" v={<span className="font-mono">{r.trade.id}</span>} />
              <KeyValue k="state" v={<Badge label={r.trade.state} status={r.trade.state} />} />
              <KeyValue k="agreed" v={formatKwh(r.trade.agreedKwh)} />
              <KeyValue k="price / kWh" v={formatPrice(r.trade.pricePerKwh)} />
              <KeyValue k="estimated value" v={formatNum(r.trade.estimatedValue, 4)} />
            </Section>
            <Section title="Offer / request">
              <KeyValue k="offer" v={<span className="font-mono">{r.offer.id}</span>} />
              <KeyValue k="facility" v={r.offer.facilityId} />
              <KeyValue k="request" v={<span className="font-mono">{r.request.id}</span>} />
              <KeyValue k="buyer" v={r.request.buyerId} />
            </Section>
          </div>

          <Section title="Evidence">
            {r.evidence ? (
              <>
                <KeyValue k="hash" v={<CopyableHex value={r.evidence.hash} />} />
                <KeyValue
                  k="discrepancy"
                  v={
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatNum(r.evidence.discrepancyPct)}%</span>
                      <Badge
                        label={r.evidence.withinTolerance ? "within tolerance" : "outside tolerance"}
                        status={r.evidence.withinTolerance ? "VERIFIED" : "REVIEW_REQUIRED"}
                      />
                    </span>
                  }
                />
                <KeyValue k="attestation" v={<Badge label={r.evidence.attestationStatus ?? "—"} status={r.evidence.attestationStatus} />} />
                {r.evidence.recordReferences?.length ? (
                  <div className="mt-1.5">
                    <p className="text-[11px] text-slate-500">record references</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {r.evidence.recordReferences.map((ref) => (
                        <li key={ref} className="font-mono text-[11px] text-slate-300">
                          {ref}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-slate-500">No delivery evidence attached yet.</p>
            )}
          </Section>

          <div className="grid gap-3 md:grid-cols-2">
            <Section title="Chain">
              {r.chain ? (
                <>
                  <KeyValue k="enabled" v={r.chain.enabled ? "yes" : "no"} />
                  <KeyValue k="chain trade id" v={r.chain.tradeId ?? "—"} />
                  <KeyValue k="tx hash" v={<CopyableHex value={r.chain.txHash} />} />
                  <KeyValue k="settlement tx" v={<CopyableHex value={r.chain.settlementTxHash} />} />
                  <KeyValue k="state on chain" v={r.chain.stateOnChain ?? "—"} />
                </>
              ) : (
                <p className="text-xs text-slate-500">Chain info unavailable on this receipt.</p>
              )}
            </Section>
            <Section title="Rewards">
              {r.rewards?.length ? (
                r.rewards.map((rw, i) => (
                  <div key={`${rw.recipient ?? i}-${i}`} className="py-1">
                    <KeyValue k="recipient" v={<CopyableHex value={rw.recipient} />} />
                    <KeyValue k="amount (GRT)" v={<span className="tabular-nums">{formatWei(rw.amount)}</span>} />
                    <KeyValue k="reason" v={rw.reason ?? "—"} />
                    <KeyValue k="tx" v={<CopyableHex value={rw.txHash} />} />
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">No reward events yet — settle the trade to mint rewards.</p>
              )}
            </Section>
          </div>

          {result ? <Callout tone={result.tone} title={result.title}>{result.body}</Callout> : null}

          <div className="border-t border-slate-800 pt-3">
            {!mayDecide ? (
              <p className="mb-2 text-xs text-slate-500">
                Attest / dispute require the verifier or admin role — switch the acting user (top right).
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {tradeState === "EVIDENCE_SUBMITTED" ? (
                <>
                  <button type="button" onClick={attest} disabled={busy} className={buttonPrimary}>
                    {busy ? <Spinner /> : null} Attest &amp; settle
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction(action === "dispute" ? "none" : "dispute")}
                    disabled={busy}
                    className={buttonDanger}
                  >
                    Dispute
                  </button>
                </>
              ) : null}
              {tradeState === "MATCHED" || tradeState === "REVIEW_REQUIRED" ? (
                <button
                  type="button"
                  onClick={() => setAction(action === "evidence" ? "none" : "evidence")}
                  disabled={busy}
                  className={buttonSecondary}
                >
                  Submit delivery evidence
                </button>
              ) : null}
              {tradeState === "DISPUTED" ? (
                <p className="text-xs text-red-300">Trade is disputed — no further actions are available.</p>
              ) : null}
              {tradeState === "SETTLED" ? (
                <p className="text-xs text-emerald-300">Trade settled — receipt above is final.</p>
              ) : null}
            </div>

            {action === "evidence" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Producer export (kWh)</FieldLabel>
                    <input
                      type="number"
                      step="0.1"
                      value={producerExport}
                      onChange={(e) => setProducerExport(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <FieldLabel>Consumer import (kWh)</FieldLabel>
                    <input
                      type="number"
                      step="0.1"
                      value={consumerImport}
                      onChange={(e) => setConsumerImport(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <FieldLabel>Notes</FieldLabel>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="meter pull notes"
                    className={inputClass}
                  />
                </div>
                <div>
                  <FieldLabel>Record references (comma separated)</FieldLabel>
                  <input
                    value={refs}
                    onChange={(e) => setRefs(e.target.value)}
                    placeholder="m-solar-export@2026-10-20T12:00Z, m-load@2026-10-20T12:00Z"
                    className={`${inputClass} font-mono text-xs`}
                  />
                </div>
                <button type="button" onClick={submitEvidence} disabled={busy} className={buttonPrimary}>
                  {busy ? <Spinner /> : null} Submit evidence
                </button>
              </div>
            ) : null}

            {action === "dispute" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div>
                  <FieldLabel>Dispute reason</FieldLabel>
                  <input
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder="meter mismatch vs contract interval"
                    className={inputClass}
                  />
                </div>
                <button type="button" onClick={dispute} disabled={busy} className={buttonDanger}>
                  {busy ? <Spinner /> : null} Confirm dispute
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function TradesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { userId } = useSession();
  const trades = useAsyncData(() => getTrades(), [userId], { refreshMs: 20000 });
  const [selected, setSelected] = useState<string | null>(searchParams.get("trade"));

  useEffect(() => {
    const fromUrl = searchParams.get("trade");
    if (fromUrl && fromUrl !== selected) setSelected(fromUrl);
  }, [searchParams, selected]);

  const close = useCallback(() => {
    setSelected(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("trade");
    router.replace(`/trades${params.toString() ? `?${params}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  const onSelect = useCallback(
    (t: Trade) => {
      setSelected(t.id);
      const params = new URLSearchParams(searchParams.toString());
      params.set("trade", t.id);
      router.replace(`/trades?${params}`, { scroll: false });
    },
    [router, searchParams],
  );

  const columns: Column<Trade>[] = [
    { key: "id", header: "Trade", render: (t) => <span className="font-mono text-xs text-emerald-300">{t.id}</span> },
    { key: "state", header: "State", render: (t) => <Badge label={t.state} status={t.state} /> },
    { key: "kwh", header: "Agreed", align: "right", render: (t) => formatKwh(t.agreedKwh) },
    { key: "price", header: "Price", align: "right", render: (t) => formatPrice(t.pricePerKwh) },
    {
      key: "evidence",
      header: "Evidence hash",
      render: (t) =>
        t.evidenceHash ? (
          <span title={t.evidenceHash} className="font-mono text-[11px] text-slate-300">
            {shortHex(t.evidenceHash, 10, 6)}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        ),
    },
    {
      key: "chain",
      header: "Chain tx",
      render: (t) => <CopyableHex value={t.settlementTxHash ?? t.chainTxHash} />,
    },
    { key: "updated", header: "Updated", render: (t) => formatTs(t.updatedAt ?? t.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Trades"
        description="Delivery evidence, on-chain attestation and settlement receipts."
        actions={
          <button type="button" onClick={trades.reload} className={buttonSecondary}>
            Refresh
          </button>
        }
      />

      <ApiBanner
        message={trades.offline ? "Cannot reach the API — trades are unavailable until the backend is running." : trades.error}
        onRetry={trades.reload}
      />

      {trades.loading ? (
        <PageLoading label="Loading trades…" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={trades.data?.trades ?? []}
            rowKey={(t) => t.id}
            onRowClick={onSelect}
            emptyMessage="No trades yet — preview and run matching from the Marketplace to create trades from open offers and requests."
          />
          <p className="mt-2 text-xs text-slate-500">Click a row to open the settlement receipt and actions.</p>
        </>
      )}

      <TradeDetailModal tradeId={selected} onClose={close} onChanged={trades.reload} />
    </div>
  );
}

export default function TradesPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading trades…" />}>
      <TradesContent />
    </Suspense>
  );
}
