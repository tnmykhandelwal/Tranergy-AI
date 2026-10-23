"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  attestTrade,
  cancelEscrow,
  disputeTrade,
  getChainStatus,
  getReceipt,
  getTrades,
  postEscrowDeposit,
  postEscrowDispute,
  postEvidence,
  postPartialSettlement,
  postResolveDefault,
  postResolveDispute,
  type AttestResult,
  type EscrowDepositKind,
  type EscrowDisputeOutcome,
  type EscrowView,
  type EvidenceResult,
  type Trade,
} from "@/lib/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { canDecideCases, useSession } from "@/lib/session";
import { formatKwh, formatNum, formatPrice, formatTs, formatWei, shortHex } from "@/lib/format";
import { depositEscrow, raiseEscrowDisputeOnChain } from "@/lib/escrow";
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

function formatUnits(value: string | null | undefined, decimals: number): string {
  if (value === null || value === undefined || value === "") return "0";
  try {
    const raw = BigInt(value);
    const scale = 10n ** BigInt(decimals);
    const whole = raw / scale;
    const frac = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${whole.toString()}.${frac}` : whole.toString();
  } catch {
    return value;
  }
}

function EscrowDepositRow({
  label,
  deposit,
  decimals,
  symbol,
}: {
  label: string;
  deposit: EscrowView["deposits"]["consumerPayment"];
  decimals: number;
  symbol: string;
}) {
  return (
    <div className="rounded border border-slate-800/70 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-300">{label}</span>
        <Badge label={deposit.confirmed ? "funded" : "outstanding"} status={deposit.confirmed ? "VERIFIED" : "PENDING"} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {formatUnits(deposit.fundedUnits, decimals)} / {formatUnits(deposit.requiredUnits, decimals)} {symbol}
        </span>
        <CopyableHex value={deposit.txHash} />
      </div>
    </div>
  );
}

function EscrowSection({ escrow }: { escrow: EscrowView }) {
  const decimals = escrow.settlementToken?.decimals ?? 6;
  const symbol = escrow.settlementToken?.symbol ?? "TSTR";
  const settlement = escrow.settlement;
  return (
    <Section title={`Mutual escrow · ${symbol}`}>
      <KeyValue k="state" v={<Badge label={escrow.escrowState} status={escrow.escrowState} />} />
      <KeyValue k="token" v={<CopyableHex value={escrow.settlementToken?.address} />} />
      <KeyValue
        k="trade value"
        v={<span className="tabular-nums">{formatUnits(escrow.tradeValueUnits, decimals)} {symbol}</span>}
      />
      <KeyValue
        k="funding"
        v={
          <span className="tabular-nums">
            {formatUnits(escrow.totals.fundedUnits, decimals)} / {formatUnits(escrow.totals.requiredUnits, decimals)} {symbol} ({formatNum(escrow.totals.fundingPct, 1)}%)
          </span>
        }
      />
      <KeyValue k="collateral ratio" v={`${((escrow.collateralRatioBps ?? 0) / 100).toFixed(2)}%`} />
      <div className="mt-2 grid gap-1.5 md:grid-cols-3">
        <EscrowDepositRow label="Consumer payment" deposit={escrow.deposits.consumerPayment} decimals={decimals} symbol={symbol} />
        <EscrowDepositRow label="Consumer collateral" deposit={escrow.deposits.consumerCollateral} decimals={decimals} symbol={symbol} />
        <EscrowDepositRow label="Producer collateral" deposit={escrow.deposits.producerCollateral} decimals={decimals} symbol={symbol} />
      </div>
      <div className="mt-2 grid gap-1 md:grid-cols-2">
        <div>
          <KeyValue k="funding deadline" v={formatTs(escrow.deadlines.fundingDeadline)} />
          <KeyValue k="delivery deadline" v={formatTs(escrow.deadlines.deliveryDeadline)} />
          <KeyValue k="grace period" v={escrow.deadlines.gracePeriodSeconds ? `${escrow.deadlines.gracePeriodSeconds}s` : "—"} />
        </div>
        <div>
          <KeyValue k="delivered" v={escrow.verification.deliveredKwh !== null && escrow.verification.deliveredKwh !== undefined ? formatKwh(escrow.verification.deliveredKwh) : "—"} />
          <KeyValue k="outcome" v={settlement.outcome ?? "—"} />
          <KeyValue k="final settlement tx" v={<CopyableHex value={settlement.finalSettlementTxHash} />} />
        </div>
      </div>
      {settlement.outcome ? (
        <div className="mt-2 rounded border border-slate-800/70 px-2 py-1.5 text-[11px] text-slate-300">
          <div className="flex justify-between"><span className="text-slate-500">paid to producer</span><span className="tabular-nums">{formatUnits(settlement.paymentToProducerUnits, decimals)} {symbol}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">consumer refund</span><span className="tabular-nums">{formatUnits(settlement.paymentRefundedUnits, decimals)} {symbol}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">producer collateral returned</span><span className="tabular-nums">{formatUnits(settlement.producerCollateralReturnedUnits, decimals)} {symbol}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">producer collateral slashed</span><span className="tabular-nums">{formatUnits(settlement.producerCollateralSlashedUnits, decimals)} {symbol}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">consumer collateral returned</span><span className="tabular-nums">{formatUnits(settlement.consumerCollateralReturnedUnits, decimals)} {symbol}</span></div>
        </div>
      ) : null}
      {escrow.dispute.reason ? (
        <div className="mt-2 rounded border border-red-900/50 bg-red-950/20 px-2 py-1.5 text-[11px] text-red-200">
          <div>dispute: {escrow.dispute.reason}</div>
          {escrow.dispute.resolutionOutcome ? (
            <div>resolution: {escrow.dispute.resolutionOutcome} — {escrow.dispute.resolutionReason ?? "—"}</div>
          ) : null}
          <CopyableHex value={escrow.dispute.txHash} />
        </div>
      ) : null}
    </Section>
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
  const { role, walletAddress } = useSession();
  const mayDecide = canDecideCases(role);
  const receipt = useAsyncData(
    () => (tradeId ? getReceipt(tradeId) : Promise.resolve(null)),
    [tradeId],
  );
  const chain = useAsyncData(() => getChainStatus(), []);
  const [action, setAction] = useState<
    "none" | "evidence" | "dispute" | "partial" | "default" | "resolve" | "escrowDispute"
  >("none");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; title: string; body: string } | null>(null);
  const [producerExport, setProducerExport] = useState("");
  const [consumerImport, setConsumerImport] = useState("");
  const [notes, setNotes] = useState("");
  const [refs, setRefs] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [deliveredKwh, setDeliveredKwh] = useState("");
  const [resolveOutcome, setResolveOutcome] = useState<EscrowDisputeOutcome>("full_delivery");
  const [resolveReason, setResolveReason] = useState("");
  const [evidenceHash, setEvidenceHash] = useState("");
  const [pendingDeposit, setPendingDeposit] = useState<{ kind: EscrowDepositKind; txHash: string } | null>(null);
  const [pendingDispute, setPendingDispute] = useState<{ reason: string; txHash: string } | null>(null);

  const tradeState = receipt.data?.trade?.state;
  const resetAction = useCallback(() => {
    setAction("none");
    setProducerExport("");
    setConsumerImport("");
    setNotes("");
    setRefs("");
    setDisputeReason("");
    setDeliveredKwh("");
    setResolveReason("");
    setEvidenceHash("");
    setResolveOutcome("full_delivery");
    setPendingDeposit(null);
    setPendingDispute(null);
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

  const escrow = receipt.data?.escrow ?? null;
  const escrowAddresses = chain.data?.contracts ?? null;
  const fundingDeadlinePassed = escrow?.deadlines.fundingDeadline
    ? Date.now() > new Date(escrow.deadlines.fundingDeadline).getTime()
    : false;
  const defaultWindowClosed = escrow?.deadlines.deliveryDeadline
    ? Date.now() >
      new Date(escrow.deadlines.deliveryDeadline).getTime() +
        (escrow.deadlines.gracePeriodSeconds ?? 0) * 1000
    : false;

  const runEscrowDeposit = async (kind: EscrowDepositKind) => {
    if (!tradeId || !escrow || escrow.chainTradeId === null || escrow.chainTradeId === undefined) return;
    if (!escrowAddresses?.energyTrade || !escrowAddresses.settlementToken) {
      toast("Escrow contract addresses are unavailable — deploy and configure the chain first.", "error");
      return;
    }
    const key =
      kind === "consumer_payment"
        ? escrow.deposits.consumerPayment
        : kind === "consumer_collateral"
          ? escrow.deposits.consumerCollateral
          : escrow.deposits.producerCollateral;
    if (key.confirmed) {
      toast("This escrow deposit is already funded.", "info");
      return;
    }
    setBusy(true);
    try {
      const txHash = await depositEscrow(
        {
          energyTrade: escrowAddresses.energyTrade,
          settlementToken: escrowAddresses.settlementToken,
        },
        escrow.chainTradeId,
        kind,
        key.requiredUnits,
      );
      try {
        const res = await postEscrowDeposit(tradeId, kind, txHash);
        setPendingDeposit(null);
        setResult({
          tone: "success",
          title: "Escrow deposit confirmed",
          body: `tx ${txHash} · escrow ${res.escrow?.escrowState ?? res.trade.escrowState ?? "updated"}`,
        });
      } catch (err) {
        setPendingDeposit({ kind, txHash });
        setResult({
          tone: "error",
          title: "Deposit sent but not recorded",
          body: `tx ${txHash} succeeded on-chain. API recording failed: ${
            err instanceof Error ? err.message : String(err)
          }. Use “Record confirmed deposit” to retry verification — do not send a second deposit.`,
        });
      }
      toast("Escrow deposit submitted", "success");
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Escrow deposit failed", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const raiseEscrowDispute = async () => {
    if (!tradeId || !escrow || escrow.chainTradeId === null || escrow.chainTradeId === undefined) return;
    if (!disputeReason.trim()) {
      toast("A dispute reason is required.", "error");
      return;
    }
    if (!escrowAddresses?.energyTrade) {
      toast("Escrow contract address is unavailable.", "error");
      return;
    }
    setBusy(true);
    try {
      const txHash = await raiseEscrowDisputeOnChain(
        { energyTrade: escrowAddresses.energyTrade },
        escrow.chainTradeId,
        disputeReason.trim(),
      );
      setPendingDispute({ reason: disputeReason.trim(), txHash });
      const res = await postEscrowDispute(tradeId, disputeReason.trim(), txHash);
      setPendingDispute(null);
      setResult({
        tone: "success",
        title: "Dispute raised on-chain",
        body: `tx ${txHash} · state ${res.trade.state}`,
      });
      toast("Escrow dispute raised", "success");
      resetAction();
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("on-chain dispute failed")) {
        setResult({ tone: "error", title: "Dispute failed", body: msg });
      } else {
        if (!pendingDispute) {
          const maybeTx = msg.match(/0x[0-9a-fA-F]{64}/)?.[0];
          if (maybeTx) setPendingDispute({ reason: disputeReason.trim(), txHash: maybeTx });
        }
        setResult({
          tone: "error",
          title: "Dispute raised but not recorded",
          body: `${msg}. Use “Record confirmed dispute” to retry verification.`,
        });
      }
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const recordPendingDeposit = async () => {
    if (!tradeId || !pendingDeposit) return;
    setBusy(true);
    try {
      const res = await postEscrowDeposit(tradeId, pendingDeposit.kind, pendingDeposit.txHash);
      setPendingDeposit(null);
      setResult({
        tone: "success",
        title: "Deposit recorded",
        body: `tx ${pendingDeposit.txHash} · escrow ${res.escrow?.escrowState ?? "updated"}`,
      });
      toast("Escrow deposit recorded", "success");
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Recording still failing", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const recordPendingDispute = async () => {
    if (!tradeId || !pendingDispute) return;
    setBusy(true);
    try {
      const res = await postEscrowDispute(tradeId, pendingDispute.reason, pendingDispute.txHash);
      const txHash = pendingDispute.txHash;
      setPendingDispute(null);
      setResult({
        tone: "success",
        title: "Dispute recorded",
        body: `tx ${txHash} · state ${res.trade.state}`,
      });
      toast("Escrow dispute recorded", "success");
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Recording still failing", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const cancelExpired = async () => {
    if (!tradeId) return;
    setBusy(true);
    try {
      const res = await cancelEscrow(tradeId);
      setResult({
        tone: "success",
        title: "Escrow cancelled and refunded",
        body: `outcome ${res.escrow?.settlement.outcome ?? "CANCELLED"} · settlement tx ${
          res.settlementTxHash ?? "—"
        }`,
      });
      toast("Escrow cancelled", "success");
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Cancellation failed", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const settlePartial = async () => {
    if (!tradeId) return;
    const delivered = Number(deliveredKwh);
    if (!Number.isFinite(delivered) || delivered <= 0) {
      toast("Enter the verified delivered kWh.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await postPartialSettlement(tradeId, delivered);
      setResult({
        tone: "success",
        title: "Partial delivery settled",
        body: `trade ${res.trade.state} · paid ${res.escrow?.settlement.paymentToProducer ?? "—"} ${
          res.escrow?.settlementToken.symbol ?? ""
        } · tx ${res.settlementTxHash ?? "—"}`,
      });
      toast("Partial delivery settled", "success");
      resetAction();
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Partial settlement failed", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const settleDefault = async () => {
    if (!tradeId) return;
    setBusy(true);
    try {
      const res = await postResolveDefault(tradeId, resolveReason.trim() || "verified non-delivery");
      setResult({
        tone: "success",
        title: "Producer default resolved",
        body: `slashed ${res.escrow?.settlement.producerCollateralSlashed ?? "—"} ${
          res.escrow?.settlementToken.symbol ?? ""
        } · tx ${res.settlementTxHash ?? "—"}`,
      });
      toast("Producer default resolved", "success");
      resetAction();
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Default resolution failed", body: msg });
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const resolveDispute = async () => {
    if (!tradeId) return;
    if (!resolveReason.trim()) {
      toast("A resolution reason is required.", "error");
      return;
    }
    const delivered = resolveOutcome === "partial_delivery" ? Number(deliveredKwh) : undefined;
    if (resolveOutcome === "partial_delivery" && (!Number.isFinite(delivered) || (delivered ?? 0) <= 0)) {
      toast("Enter the verified delivered kWh for a partial outcome.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await postResolveDispute(tradeId, {
        outcome: resolveOutcome,
        reason: resolveReason.trim(),
        ...(delivered ? { deliveredKwh: delivered } : {}),
        ...(evidenceHash.trim() ? { evidenceHash: evidenceHash.trim() } : {}),
      });
      setResult({
        tone: "success",
        title: "Dispute resolved",
        body: `outcome ${res.escrow?.settlement.outcome ?? "—"} · trade ${res.trade.state} · tx ${
          res.settlementTxHash ?? "—"
        }`,
      });
      toast("Dispute resolved", "success");
      resetAction();
      receipt.reload();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ tone: "error", title: "Dispute resolution failed", body: msg });
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

          {escrow ? <EscrowSection escrow={escrow} /> : null}

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
          {pendingDeposit ? (
            <button type="button" onClick={recordPendingDeposit} disabled={busy} className={buttonSecondary}>
              {busy ? <Spinner /> : null} Record confirmed deposit
            </button>
          ) : null}
          {pendingDispute ? (
            <button type="button" onClick={recordPendingDispute} disabled={busy} className={buttonSecondary}>
              {busy ? <Spinner /> : null} Record confirmed dispute
            </button>
          ) : null}

          <div className="border-t border-slate-800 pt-3">
            {!mayDecide && !escrow ? (
              <p className="mb-2 text-xs text-slate-500">
                Attest / dispute require the verifier or admin role — switch the acting user (top right).
              </p>
            ) : null}
            {escrow && !walletAddress ? (
              <p className="mb-2 text-xs text-amber-300">
                Sign in with a wallet to make escrow deposits or raise a participant dispute.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {escrow && !fundingDeadlinePassed && tradeState === "MATCHED" && role === "consumer" ? (
                <>
                  {!escrow.deposits.consumerPayment.confirmed ? (
                    <button
                      type="button"
                      onClick={() => runEscrowDeposit("consumer_payment")}
                      disabled={busy}
                      className={buttonPrimary}
                    >
                      {busy ? <Spinner /> : null} Deposit payment
                    </button>
                  ) : null}
                  {!escrow.deposits.consumerCollateral.confirmed ? (
                    <button
                      type="button"
                      onClick={() => runEscrowDeposit("consumer_collateral")}
                      disabled={busy}
                      className={buttonPrimary}
                    >
                      {busy ? <Spinner /> : null} Deposit consumer collateral
                    </button>
                  ) : null}
                </>
              ) : null}
              {escrow && !fundingDeadlinePassed && tradeState === "MATCHED" && role === "producer" ? (
                !escrow.deposits.producerCollateral.confirmed ? (
                  <button
                    type="button"
                    onClick={() => runEscrowDeposit("producer_collateral")}
                    disabled={busy}
                    className={buttonPrimary}
                  >
                    {busy ? <Spinner /> : null} Deposit producer collateral
                  </button>
                ) : null
              ) : null}
              {escrow && tradeState === "MATCHED" && fundingDeadlinePassed ? (
                <button type="button" onClick={cancelExpired} disabled={busy} className={buttonDanger}>
                  {busy ? <Spinner /> : null} Cancel expired escrow &amp; refund
                </button>
              ) : null}
              {(tradeState === "MATCHED" || tradeState === "REVIEW_REQUIRED" || tradeState === "DELIVERY_ACTIVE") && !escrow ? (
                <button
                  type="button"
                  onClick={() => setAction(action === "evidence" ? "none" : "evidence")}
                  disabled={busy}
                  className={buttonSecondary}
                >
                  Submit delivery evidence
                </button>
              ) : null}
              {escrow && tradeState === "DELIVERY_ACTIVE" ? (
                <button
                  type="button"
                  onClick={() => setAction(action === "evidence" ? "none" : "evidence")}
                  disabled={busy}
                  className={buttonSecondary}
                >
                  Submit delivery evidence
                </button>
              ) : null}
              {mayDecide && tradeState === "EVIDENCE_SUBMITTED" ? (
                <>
                  <button type="button" onClick={attest} disabled={busy} className={buttonPrimary}>
                    {busy ? <Spinner /> : null} Attest &amp; settle
                  </button>
                  {escrow ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setAction(action === "partial" ? "none" : "partial")}
                        disabled={busy}
                        className={buttonSecondary}
                      >
                        Partial delivery
                      </button>
                      {defaultWindowClosed ? (
                        <button
                          type="button"
                          onClick={() => setAction(action === "default" ? "none" : "default")}
                          disabled={busy}
                          className={buttonDanger}
                        >
                          Resolve producer default
                        </button>
                      ) : null}
                    </>
                  ) : null}
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
              {escrow &&
              (role === "producer" || role === "consumer") &&
              (tradeState === "DELIVERY_ACTIVE" || tradeState === "EVIDENCE_SUBMITTED") &&
              walletAddress ? (
                <button
                  type="button"
                  onClick={() => setAction(action === "escrowDispute" ? "none" : "escrowDispute")}
                  disabled={busy}
                  className={buttonDanger}
                >
                  Raise on-chain dispute
                </button>
              ) : null}
              {mayDecide && escrow && tradeState === "DELIVERY_ACTIVE" && defaultWindowClosed ? (
                <button
                  type="button"
                  onClick={() => setAction(action === "default" ? "none" : "default")}
                  disabled={busy}
                  className={buttonDanger}
                >
                  Resolve producer default
                </button>
              ) : null}
              {mayDecide && escrow && tradeState === "DISPUTED" ? (
                <button
                  type="button"
                  onClick={() => setAction(action === "resolve" ? "none" : "resolve")}
                  disabled={busy}
                  className={buttonPrimary}
                >
                  Resolve dispute
                </button>
              ) : null}
              {tradeState === "DISPUTED" && !mayDecide ? (
                <p className="text-xs text-red-300">
                  Trade is disputed — a verifier must resolve it; funds stay locked until then.
                </p>
              ) : null}
              {tradeState === "SETTLED" ? (
                <p className="text-xs text-emerald-300">Trade settled — receipt above is final.</p>
              ) : null}
              {tradeState === "PARTIALLY_SETTLED" ? (
                <p className="text-xs text-amber-300">
                  Partially settled — payment reflects verified delivery; slashed collateral covers the shortfall.
                </p>
              ) : null}
              {tradeState === "DEFAULTED" ? (
                <p className="text-xs text-red-300">
                  Producer default — consumer refunded and producer collateral slashed.
                </p>
              ) : null}
              {tradeState === "CANCELLED" ? (
                <p className="text-xs text-slate-400">Escrow cancelled before funding completed — deposits refunded.</p>
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

            {action === "escrowDispute" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div>
                  <FieldLabel>Dispute reason (signed by your wallet)</FieldLabel>
                  <input
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder="delivered energy does not match the agreed interval"
                    className={inputClass}
                  />
                </div>
                <button type="button" onClick={raiseEscrowDispute} disabled={busy} className={buttonDanger}>
                  {busy ? <Spinner /> : null} Sign &amp; raise dispute
                </button>
              </div>
            ) : null}

            {action === "partial" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div>
                  <FieldLabel>Verified delivered energy (kWh)</FieldLabel>
                  <input
                    type="number"
                    step="0.001"
                    value={deliveredKwh}
                    onChange={(e) => setDeliveredKwh(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <button type="button" onClick={settlePartial} disabled={busy} className={buttonPrimary}>
                  {busy ? <Spinner /> : null} Settle partial delivery
                </button>
              </div>
            ) : null}

            {action === "default" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div>
                  <FieldLabel>Evidence note for the default determination</FieldLabel>
                  <input
                    value={resolveReason}
                    onChange={(e) => setResolveReason(e.target.value)}
                    placeholder="no delivery recorded after the deadline and grace period"
                    className={inputClass}
                  />
                </div>
                <button type="button" onClick={settleDefault} disabled={busy} className={buttonDanger}>
                  {busy ? <Spinner /> : null} Resolve producer default
                </button>
              </div>
            ) : null}

            {action === "resolve" ? (
              <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <FieldLabel>Outcome</FieldLabel>
                    <select
                      value={resolveOutcome}
                      onChange={(e) => setResolveOutcome(e.target.value as EscrowDisputeOutcome)}
                      className={inputClass}
                    >
                      <option value="full_delivery">Full delivery</option>
                      <option value="partial_delivery">Partial delivery</option>
                      <option value="producer_default">Producer default</option>
                    </select>
                  </div>
                  {resolveOutcome === "partial_delivery" ? (
                    <div>
                      <FieldLabel>Verified delivered energy (kWh)</FieldLabel>
                      <input
                        type="number"
                        step="0.001"
                        value={deliveredKwh}
                        onChange={(e) => setDeliveredKwh(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  ) : null}
                </div>
                <div>
                  <FieldLabel>Resolution reason</FieldLabel>
                  <input
                    value={resolveReason}
                    onChange={(e) => setResolveReason(e.target.value)}
                    placeholder="evidence and meter reconciliation outcome"
                    className={inputClass}
                  />
                </div>
                <div>
                  <FieldLabel>Resolution evidence hash (optional)</FieldLabel>
                  <input
                    value={evidenceHash}
                    onChange={(e) => setEvidenceHash(e.target.value)}
                    placeholder="0x… (any text is hashed)"
                    className={`${inputClass} font-mono text-xs`}
                  />
                </div>
                <button type="button" onClick={resolveDispute} disabled={busy} className={buttonPrimary}>
                  {busy ? <Spinner /> : null} Resolve dispute
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
    {
      key: "escrow",
      header: "Escrow",
      render: (t) =>
        t.escrowEnabled ? (
          <Badge label={t.escrowState ?? "—"} status={t.escrowState ?? undefined} />
        ) : (
          <span className="text-slate-600">off-chain</span>
        ),
    },
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
