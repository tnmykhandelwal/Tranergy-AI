"use client";

import {
  createCertificate,
  createFacility,
  createMeter,
  getCertificates,
  getFacilities,
  getUsers,
  updateUserRole,
  type Certificate,
  type Facility,
  type Role,
  type User,
} from "@/lib/api";
import { useState } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import { canManageUsers, useSession } from "@/lib/session";
import { shortAddress } from "@/lib/wallet";
import { ApiBanner } from "@/components/ApiBanner";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toast";
import { FieldLabel, buttonPrimary, buttonSecondary, cardClass, inputClass } from "@/components/ui";

const ROLES: Role[] = ["producer", "consumer", "verifier", "admin"];
const FACILITY_TYPES = ["producer", "consumer", "storage", "mixed"] as const;
const METER_TYPES = [
  "generation",
  "load",
  "grid_import",
  "grid_export",
  "battery_charge",
  "battery_discharge",
] as const;
const CERT_STATUSES = ["ACTIVE", "TRANSFERRED", "RETIRED", "INVALID"] as const;

export default function SetupPage() {
  const { user, role, walletAddress } = useSession();
  const users = useAsyncData(() => getUsers(), [user?.id]);
  const facilities = useAsyncData(() => getFacilities(), []);
  const certificates = useAsyncData(() => getCertificates(), []);

  return (
    <div>
      <PageHeader
        title="Admin &amp; setup"
        description="Manage the workspace your wallet operates in: facilities, meters, certificates and team roles. Wallet sign-in replaces shared demo accounts."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800/70 bg-slate-900/30 px-4 py-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <p className="text-sm text-slate-300">
          Connected as <span className="font-medium text-slate-100">{user?.name ?? "wallet user"}</span>{" "}
          <span className="font-mono text-xs text-slate-500">{shortAddress(walletAddress)}</span>
        </p>
        {role ? <Badge label={role} status={role} /> : null}
      </div>

      <ApiBanner
        message={
          users.offline || facilities.offline
            ? "Cannot reach the API — start it with npm run dev -w services/api."
            : null
        }
        onRetry={() => {
          users.reload();
          facilities.reload();
          certificates.reload();
        }}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <TeamCard
          users={users.data?.users ?? []}
          loading={users.loading}
          canManage={canManageUsers(role)}
          currentUserId={user?.id ?? null}
          onChanged={() => users.reload()}
        />
        <FacilitiesCard
          facilities={facilities.data?.facilities ?? []}
          loading={facilities.loading}
          onCreated={() => facilities.reload()}
        />
        <MetersCard facilities={facilities.data?.facilities ?? []} onCreated={() => facilities.reload()} />
        <CertificatesCard
          certificates={certificates.data?.certificates ?? []}
          loading={certificates.loading}
          onCreated={() => certificates.reload()}
        />
      </div>
    </div>
  );
}

function TeamCard({
  users,
  loading,
  canManage,
  currentUserId,
  onChanged,
}: {
  users: User[];
  loading: boolean;
  canManage: boolean;
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Record<string, Role>>({});

  const save = async (target: User) => {
    const nextRole = draftRoles[target.id] ?? target.role;
    if (nextRole === target.role) return;
    setBusyId(target.id);
    try {
      await updateUserRole(target.id, { role: nextRole });
      toast(`${target.name} is now ${nextRole}`, "success");
      setDraftRoles((d) => {
        const copy = { ...d };
        delete copy[target.id];
        return copy;
      });
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Team &amp; roles</h2>
          <p className="text-xs text-slate-500">Wallets register themselves; admins grant verifier access.</p>
        </div>
        <span className="text-xs text-slate-500">{users.length} total</span>
      </div>

      {!canManage ? (
        <p className="mb-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-300">
          Only an <strong>admin</strong> can change roles. Ask an admin to promote verifiers.
        </p>
      ) : null}

      <ul className="space-y-1">
        {users.map((u) => {
          const draft = draftRoles[u.id] ?? u.role;
          const isSelf = u.id === currentUserId;
          return (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-2 py-2 transition hover:bg-slate-800/40"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">
                  {u.name}
                  {isSelf ? <span className="ml-2 text-[10px] text-emerald-300">you</span> : null}
                </p>
                <p className="truncate font-mono text-[11px] text-slate-500">
                  {shortAddress(u.walletAddress) !== "—" ? shortAddress(u.walletAddress) : u.id}
                </p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-1.5">
                  <select
                    value={draft}
                    onChange={(e) =>
                      setDraftRoles((d) => ({ ...d, [u.id]: e.target.value as Role }))
                    }
                    className="rounded-lg border border-slate-700/70 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500/60"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => save(u)}
                    disabled={busyId === u.id || draft === u.role}
                    className={`${buttonSecondary} px-2 py-1 text-xs`}
                  >
                    {busyId === u.id ? <Spinner /> : "Save"}
                  </button>
                </div>
              ) : (
                <Badge label={u.role} status={u.role} />
              )}
            </li>
          );
        })}
        {loading && users.length === 0 ? (
          <li className="px-2 py-3">
            <Spinner label="Loading team…" />
          </li>
        ) : null}
        {!loading && users.length === 0 ? (
          <li className="px-2 py-3 text-xs text-slate-500">No wallets have registered yet.</li>
        ) : null}
      </ul>
    </section>
  );
}

function FacilitiesCard({
  facilities,
  loading,
  onCreated,
}: {
  facilities: Facility[];
  loading: boolean;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof FACILITY_TYPES)[number]>("producer");
  const [capacity, setCapacity] = useState("100");
  const [exportLimit, setExportLimit] = useState("80");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cap = Number(capacity);
    const exp = Number(exportLimit);
    if (!name.trim() || !Number.isFinite(cap) || cap <= 0 || !Number.isFinite(exp) || exp < 0) {
      toast("Name and a positive capacity are required.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await createFacility({
        name: name.trim(),
        type,
        installedCapacityKw: cap,
        exportLimitKw: exp,
      });
      toast(`Facility ${res.facility.id} created`, "success");
      setName("");
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Facilities</h2>
        <span className="text-xs text-slate-500">{facilities.length} total</span>
      </div>

      <ul className="mb-4 space-y-1">
        {facilities.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition hover:bg-slate-800/40">
            <div className="min-w-0">
              <p className="truncate text-sm text-slate-200">{f.name}</p>
              <p className="truncate font-mono text-[11px] text-slate-500">
                {f.id} · {f.installedCapacityKw} kW · {f.meters?.length ?? 0} meters
              </p>
            </div>
            <Badge label={f.type} status={f.type} />
          </li>
        ))}
        {loading && facilities.length === 0 ? (
          <li>
            <Spinner label="Loading facilities…" />
          </li>
        ) : null}
        {!loading && facilities.length === 0 ? (
          <li className="px-2 py-3 text-xs text-slate-500">No facilities yet — create the first one.</li>
        ) : null}
      </ul>

      <form onSubmit={submit} className="space-y-3 border-t border-slate-800 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">New facility</p>
        <div>
          <FieldLabel>Name</FieldLabel>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="North Solar Farm" className={inputClass} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <FieldLabel>Type</FieldLabel>
            <select value={type} onChange={(e) => setType(e.target.value as (typeof FACILITY_TYPES)[number])} className={inputClass}>
              {FACILITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Capacity kW</FieldLabel>
            <input type="number" step="1" min="0" value={capacity} onChange={(e) => setCapacity(e.target.value)} className={inputClass} />
          </div>
          <div>
            <FieldLabel>Export limit kW</FieldLabel>
            <input type="number" step="1" min="0" value={exportLimit} onChange={(e) => setExportLimit(e.target.value)} className={inputClass} />
          </div>
        </div>
        <button type="submit" disabled={busy} className={buttonPrimary}>
          {busy ? <Spinner /> : null} Create facility
        </button>
      </form>
    </section>
  );
}

function MetersCard({ facilities, onCreated }: { facilities: Facility[]; onCreated: () => void }) {
  const [facilityId, setFacilityId] = useState("");
  const [meterType, setMeterType] = useState<(typeof METER_TYPES)[number]>("generation");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityId) {
      toast("Select a facility.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await createMeter({ facilityId, meterType });
      toast(`Meter ${res.meter.id} created`, "success");
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${cardClass} p-4`}>
      <h2 className="mb-3 text-sm font-semibold text-slate-100">Meters</h2>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        Meters record interval energy per stream. The meter id defaults to{" "}
        <code className="text-slate-400">{"{facilityId}-{meterType}"}</code> — the CSV importer and the data
        generator both key off it.
      </p>
      {facilities.length === 0 ? (
        <p className="text-xs text-slate-500">Create a facility first.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Facility</FieldLabel>
              <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={inputClass}>
                <option value="">Select…</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Meter type</FieldLabel>
              <select
                value={meterType}
                onChange={(e) => setMeterType(e.target.value as (typeof METER_TYPES)[number])}
                className={inputClass}
              >
                {METER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" disabled={busy} className={buttonPrimary}>
            {busy ? <Spinner /> : null} Add meter
          </button>
        </form>
      )}
    </section>
  );
}

function CertificatesCard({
  certificates,
  loading,
  onCreated,
}: {
  certificates: Certificate[];
  loading: boolean;
  onCreated: () => void;
}) {
  const [externalId, setExternalId] = useState("");
  const [quantityMwh, setQuantityMwh] = useState("1");
  const [status, setStatus] = useState<(typeof CERT_STATUSES)[number]>("ACTIVE");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(quantityMwh);
    if (!externalId.trim() || !Number.isFinite(qty) || qty <= 0) {
      toast("External id and a positive quantity are required.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await createCertificate({ externalId: externalId.trim(), quantityMwh: qty, status });
      toast(`Certificate ${res.certificate.externalId} registered`, "success");
      setExternalId("");
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Certificates</h2>
        <span className="text-xs text-slate-500">{certificates.length} total</span>
      </div>

      <ul className="mb-4 space-y-1">
        {certificates.map((c) => (
          <li key={c.externalId} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition hover:bg-slate-800/40">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-emerald-300">{c.externalId}</p>
              <p className="truncate text-[11px] text-slate-500">
                {c.quantityMwh} MWh · {c.issuer}
              </p>
            </div>
            <Badge label={c.status} status={c.status} />
          </li>
        ))}
        {loading && certificates.length === 0 ? (
          <li>
            <Spinner label="Loading certificates…" />
          </li>
        ) : null}
        {!loading && certificates.length === 0 ? (
          <li className="px-2 py-3 text-xs text-slate-500">No certificates registered yet.</li>
        ) : null}
      </ul>

      <form onSubmit={submit} className="space-y-3 border-t border-slate-800 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Register certificate</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <FieldLabel>External ID</FieldLabel>
            <input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="CERT-0001"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <FieldLabel>Quantity MWh</FieldLabel>
            <input type="number" step="0.01" min="0" value={quantityMwh} onChange={(e) => setQuantityMwh(e.target.value)} className={inputClass} />
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <select value={status} onChange={(e) => setStatus(e.target.value as (typeof CERT_STATUSES)[number])} className={inputClass}>
              {CERT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" disabled={busy} className={buttonPrimary}>
          {busy ? <Spinner /> : null} Register
        </button>
      </form>
    </section>
  );
}
