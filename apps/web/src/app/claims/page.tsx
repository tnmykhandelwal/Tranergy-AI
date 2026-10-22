"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  checkCertificate,
  createClaim,
  decideCase,
  getCertificates,
  getFacilities,
  getVerificationCases,
  verifyClaim,
  type CertificateCheck,
  type Claim,
  type Facility,
  type VerificationCase,
  type VerifyResponse,
} from "@/lib/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { canCreateOffer, canDecideCases, useSession } from "@/lib/session";
import { defaultRange, formatKwh, formatTs, isoFromLocal } from "@/lib/format";
import { ApiBanner } from "@/components/ApiBanner";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { AnomalyGauge } from "@/components/AnomalyGauge";
import { SeverityChip } from "@/components/SeverityChip";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toast";
import {
  Callout,
  FieldLabel,
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  cardClass,
  inputClass,
} from "@/components/ui";

type Tab = "claims" | "review";

export default function ClaimsPage() {
  const [tab, setTab] = useState<Tab>("claims");

  return (
    <div>
      <PageHeader
        title="Claims & verification"
        description="Submit energy claims against registry certificates, then review rule and ML verification cases."
      />
      <div className="mb-5 flex w-fit gap-1 rounded-xl border border-slate-800/80 bg-slate-900/70 p-1">
        {(
          [
            { id: "claims", label: "Claims" },
            { id: "review", label: "Review queue" },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-1.5 text-sm transition ${
              tab === t.id
                ? "bg-gradient-to-r from-emerald-400/20 to-cyan-400/10 text-emerald-200 shadow-[inset_0_0_0_1px_rgba(45,223,166,0.25)]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "claims" ? <ClaimsTab /> : <ReviewTab />}
    </div>
  );
}

function ClaimsTab() {
  const { userId, role } = useSession();
  const facilities = useAsyncData(() => getFacilities(), []);
  const certificates = useAsyncData(() => getCertificates(), []);
  const range = useMemo(() => defaultRange(), []);

  const [facilityId, setFacilityId] = useState("");
  const [startLocal, setStartLocal] = useState(range.toLocal);
  const [endLocal, setEndLocal] = useState(range.toLocal);
  const [claimedKwh, setClaimedKwh] = useState("100");
  const [certId, setCertId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ claim: Claim; case: VerificationCase } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [checkInput, setCheckInput] = useState("");
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<CertificateCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const offline = facilities.offline || certificates.offline;
  const banner = offline
    ? "Cannot reach the API — claims and certificates are unavailable until the backend is running."
    : facilities.error ?? certificates.error;

  const facilityOptions = facilities.data?.facilities ?? [];
  const certOptions = certificates.data?.certificates ?? [];
  const mayClaim = canCreateOffer(role);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityId || !certId) {
      toast("Select a facility and a certificate.", "error");
      return;
    }
    const start = isoFromLocal(startLocal);
    const end = isoFromLocal(endLocal);
    if (!start || !end) {
      toast("Invalid interval.", "error");
      return;
    }
    const kwh = Number(claimedKwh);
    if (!Number.isFinite(kwh) || kwh <= 0) {
      toast("claimedKwh must be a positive number.", "error");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const claim = await createClaim({
        facilityId,
        intervalStart: start,
        intervalEnd: end,
        claimedKwh: kwh,
        certificateExternalId: certId,
      });
      const verified: VerifyResponse = await verifyClaim(claim.id);
      setResult({ claim: verified.claim ?? claim, case: verified.case });
      toast(`Claim ${claim.id} verified → ${verified.claim.status}`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    if (!checkInput.trim()) {
      toast("Enter a certificate externalId.", "error");
      return;
    }
    setCheckBusy(true);
    setCheckError(null);
    setCheckResult(null);
    try {
      const res = await checkCertificate(checkInput.trim());
      setCheckResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCheckError(msg);
      toast(msg, "error");
    } finally {
      setCheckBusy(false);
    }
  };

  return (
    <div>
      <ApiBanner message={banner} onRetry={() => { facilities.reload(); certificates.reload(); }} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className={`${cardClass} p-4`}>
          <h2 className="text-sm font-semibold text-slate-100">New claim</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Creates the claim and immediately runs verification — deterministic rules, certificate check and
            anomaly score.
          </p>
          {!mayClaim ? (
            <div className="mt-3">
              <Callout tone="warning" title="Role gated">
                Creating a claim requires the <strong>producer</strong> or <strong>admin</strong> role.
                Switch the acting user (top right) to a producer or admin.
              </Callout>
            </div>
          ) : null}
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div>
              <FieldLabel>Facility</FieldLabel>
              <select
                value={facilityId}
                onChange={(e) => setFacilityId(e.target.value)}
                className={inputClass}
                disabled={!mayClaim}
              >
                <option value="">Select facility…</option>
                {facilityOptions.map((f: Facility) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.type}, {f.installedCapacityKw} kW)
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Interval start</FieldLabel>
                <input
                  type="datetime-local"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                  className={inputClass}
                  disabled={!mayClaim}
                />
              </div>
              <div>
                <FieldLabel>Interval end</FieldLabel>
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                  className={inputClass}
                  disabled={!mayClaim}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Claimed kWh</FieldLabel>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={claimedKwh}
                  onChange={(e) => setClaimedKwh(e.target.value)}
                  className={inputClass}
                  disabled={!mayClaim}
                />
              </div>
              <div>
                <FieldLabel>Certificate</FieldLabel>
                <select
                  value={certId}
                  onChange={(e) => setCertId(e.target.value)}
                  className={inputClass}
                  disabled={!mayClaim}
                >
                  <option value="">Select certificate…</option>
                  {certOptions.map((c) => (
                    <option key={c.externalId} value={c.externalId}>
                      {c.externalId} ({c.status}, {c.quantityMwh} MWh)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={busy || !mayClaim} className={buttonPrimary}>
                {busy ? <Spinner /> : null} Create &amp; verify claim
              </button>
              {certificates.loading ? <span className="text-xs text-slate-500">loading certificates…</span> : null}
            </div>
          </form>

          {error ? (
            <div className="mt-4">
              <Callout tone="error" title="Claim failed">{error}</Callout>
            </div>
          ) : null}
          {result ? (
            <div className="mt-4 space-y-3">
              <Callout tone="info" title={`Claim ${result.claim.id}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge label={result.claim.status} status={result.claim.status} />
                  <span>facility: {result.claim.facilityId}</span>
                  <span>claimed: {formatKwh(result.claim.claimedKwh)}</span>
                </div>
                <p className="mt-1">
                  interval {formatTs(result.claim.intervalStart)} → {formatTs(result.claim.intervalEnd)}
                </p>
              </Callout>
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Verification case {result.case.id}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge label={result.case.reviewStatus} status={result.case.reviewStatus} />
                      {result.case.mlStatus ? (
                        <Badge label={result.case.mlStatus} status={result.case.mlStatus} />
                      ) : null}
                      {(result.case.anomalyFlags ?? []).map((f) => (
                        <span
                          key={f}
                          className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] text-orange-300"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                  <AnomalyGauge score={result.case.anomalyScore} size={110} />
                </div>
                <ul className="mt-3 space-y-1.5">
                  {(result.case.ruleResults ?? []).map((r) => (
                    <li key={r.code} className="flex items-start gap-2 text-xs">
                      <SeverityChip severity={String(r.severity)} />
                      <span className="font-mono text-slate-300">{r.code}</span>
                      <span className="text-slate-400">{r.message}</span>
                    </li>
                  ))}
                  {(result.case.ruleResults ?? []).length === 0 ? (
                    <li className="text-xs text-slate-500">No rule results — clean pass.</li>
                  ) : null}
                </ul>
              </div>
            </div>
          ) : null}
        </div>

        <div className={`${cardClass} h-fit p-4`}>
          <h2 className="text-sm font-semibold text-slate-100">Certificate checker</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Registry status, usability and issue codes for a certificate external id.
          </p>
          <div className="mt-4 flex items-end gap-2">
            <div className="flex-1">
              <FieldLabel>External ID</FieldLabel>
              <input
                list="certificate-ids"
                value={checkInput}
                onChange={(e) => setCheckInput(e.target.value)}
                placeholder="CERT-ACTIVE-0001"
                className={`${inputClass} font-mono`}
              />
              <datalist id="certificate-ids">
                {certOptions.map((c) => (
                  <option key={c.externalId} value={c.externalId} />
                ))}
              </datalist>
            </div>
            <button type="button" onClick={runCheck} disabled={checkBusy} className={buttonSecondary}>
              {checkBusy ? <Spinner /> : null} Check
            </button>
          </div>
          {checkError ? (
            <div className="mt-3">
              <Callout tone="error" title="Check failed">{checkError}</Callout>
            </div>
          ) : null}
          {checkResult ? (
            <div className="mt-3 space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-300">{checkResult.externalId}</span>
                <Badge label={checkResult.status} status={checkResult.status} />
                <Badge
                  label={checkResult.usable ? "usable" : "not usable"}
                  status={checkResult.usable ? "VERIFIED" : "INVALID"}
                />
                {typeof checkResult.quantityMwh === "number" ? (
                  <span className="text-xs text-slate-400">{checkResult.quantityMwh} MWh</span>
                ) : null}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Issues</p>
                {checkResult.issues?.length ? (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {checkResult.issues.map((i) => (
                      <li
                        key={i}
                        className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300"
                      >
                        {i}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-emerald-300">none</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Used by claims</p>
                {checkResult.usedByClaimIds?.length ? (
                  <p className="mt-1 font-mono text-xs text-slate-300">{checkResult.usedByClaimIds.join(", ")}</p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">not attached to any claim</p>
                )}
              </div>
            </div>
          ) : null}
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Registry</p>
            <ul className="mt-1.5 space-y-1 text-xs text-slate-400">
              {certOptions.map((c) => (
                <li key={c.externalId} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setCheckInput(c.externalId)}
                    className="truncate font-mono text-left text-emerald-300/90 hover:underline"
                  >
                    {c.externalId}
                  </button>
                  <Badge label={c.status} status={c.status} />
                </li>
              ))}
              {certificates.loading && certOptions.length === 0 ? <li>loading…</li> : null}
              {!certificates.loading && certOptions.length === 0 ? (
                <li>
                  No certificates yet — register one on the{" "}
                  <Link href="/setup" className="text-emerald-300 hover:underline">
                    Setup
                  </Link>{" "}
                  page.
                </li>
              ) : null}
            </ul>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Acting as <span className="text-slate-300">{userId}</span> — claims are attributed via the
            x-user-id header.
          </p>
        </div>
      </div>
    </div>
  );
}

function ReviewTab() {
  const { userId, role } = useSession();
  const [filter, setFilter] = useState<string>("OPEN");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const cases = useAsyncData(
    () => getVerificationCases(filter === "ALL" ? undefined : filter),
    [userId, filter],
  );

  const banner = cases.offline
    ? "Cannot reach the API — the review queue is unavailable until the backend is running."
    : cases.error;

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusyId(id);
    try {
      await decideCase(id, { decision, note: notes[id]?.trim() || undefined });
      toast(`Case ${id} ${decision === "approve" ? "approved" : "rejected"}`, "success");
      setNotes((n) => ({ ...n, [id]: "" }));
      cases.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const all = cases.data?.cases ?? [];
  const openCases = all.filter((c) => c.reviewStatus === "OPEN");
  const decidedCases = all.filter((c) => c.reviewStatus !== "OPEN");
  const mayDecide = canDecideCases(role);

  return (
    <div>
      <ApiBanner message={banner} onRetry={cases.reload} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="case-filter" className="text-xs uppercase tracking-wider text-slate-500">
            Show
          </label>
          <select
            id="case-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={`${inputClass} w-56`}
          >
            <option value="OPEN">Open cases</option>
            <option value="ALL">All cases</option>
            <option value="APPROVED_BY_REVIEWER">Approved</option>
            <option value="REJECTED_BY_REVIEWER">Rejected</option>
          </select>
        </div>
        <button type="button" onClick={cases.reload} className={buttonSecondary}>
          Refresh
        </button>
      </div>

      {!mayDecide ? (
        <div className="mb-4">
          <Callout tone="warning" title="Read-only">
            Decisions require the <strong>verifier</strong> or <strong>admin</strong> role — switch the
            acting user to a verifier or admin to approve/reject.
          </Callout>
        </div>
      ) : null}

      {cases.loading ? (
        <div className={cardClass}>
          <div className="p-10">
            <Spinner label="Loading cases…" />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <CaseList
            cases={openCases}
            mayDecide={mayDecide}
            busyId={busyId}
            notes={notes}
            setNotes={setNotes}
            decide={decide}
            emptyTitle={filter === "OPEN" ? "Review queue is empty" : "No cases match this filter"}
            emptyHint="Verify a claim from the Claims tab — soft rule hits or ML flags land here for manual review."
          />
          {decidedCases.length > 0 ? (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Decided cases
              </h2>
              <div className="space-y-3 opacity-70">
                <CaseList
                  cases={decidedCases}
                  mayDecide={false}
                  busyId={null}
                  notes={{}}
                  setNotes={() => undefined}
                  decide={decide}
                  emptyTitle="No decided cases"
                  emptyHint=""
                />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CaseList({
  cases,
  mayDecide,
  busyId,
  notes,
  setNotes,
  decide,
  emptyTitle,
  emptyHint,
}: {
  cases: VerificationCase[];
  mayDecide: boolean;
  busyId: string | null;
  notes: Record<string, string>;
  setNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  decide: (id: string, decision: "approve" | "reject") => Promise<void>;
  emptyTitle: string;
  emptyHint: string;
}) {
  if (cases.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 px-6 py-10 text-center">
        <p className="text-sm font-medium text-slate-300">{emptyTitle}</p>
        {emptyHint ? <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{emptyHint}</p> : null}
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {cases.map((c) => (
        <div key={c.id} className={`${cardClass} p-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-emerald-300">{c.id}</span>
                <Badge label={c.reviewStatus} status={c.reviewStatus} />
              </div>
              <p className="mt-2 text-sm font-medium text-slate-100">{c.claim.facilityId}</p>
              <p className="text-xs text-slate-400">
                {formatTs(c.claim.intervalStart)} → {formatTs(c.claim.intervalEnd)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-300">claimed {formatKwh(c.claim.claimedKwh)}</span>
                <Badge label={c.claim.status} status={c.claim.status} />
                {c.mlStatus ? <Badge label={c.mlStatus} status={c.mlStatus} /> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(c.anomalyFlags ?? []).map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-300"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
            <AnomalyGauge score={c.anomalyScore} size={100} />
          </div>

          <ul className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
            {(c.ruleResults ?? []).map((r) => (
              <li key={r.code} className="flex items-start gap-2 text-xs">
                <SeverityChip severity={String(r.severity)} />
                <span className="font-mono text-slate-300">{r.code}</span>
                <span className="text-slate-400">{r.message}</span>
              </li>
            ))}
            {(c.ruleResults ?? []).length === 0 ? (
              <li className="text-xs text-slate-500">No rule hits recorded on this case.</li>
            ) : null}
          </ul>

          {mayDecide ? (
            <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
              <input
                value={notes[c.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                placeholder="Optional reviewer note…"
                className={inputClass}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => decide(c.id, "approve")}
                  disabled={busyId === c.id}
                  className={`${buttonPrimary} flex-1`}
                >
                  {busyId === c.id ? <Spinner /> : null} Approve
                </button>
                <button
                  type="button"
                  onClick={() => decide(c.id, "reject")}
                  disabled={busyId === c.id}
                  className={`${buttonDanger} flex-1`}
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
