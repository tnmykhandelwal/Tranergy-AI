"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSession, type RegisterRole } from "@/lib/session";
import { shortAddress } from "@/lib/wallet";
import { Badge } from "@/components/Badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toast";

const GROUPS = [
  {
    label: "Overview",
    links: [
      { href: "/", label: "Dashboard" },
      { href: "/facilities", label: "Facilities" },
    ],
  },
  {
    label: "Trust",
    links: [{ href: "/claims", label: "Claims & verification" }],
  },
  {
    label: "Market",
    links: [
      { href: "/market", label: "Marketplace" },
      { href: "/trades", label: "Trades" },
    ],
  },
  {
    label: "Network",
    links: [
      { href: "/chain", label: "Chain" },
      { href: "/setup", label: "Admin" },
    ],
  },
];

const ALL_LINKS = GROUPS.flatMap((g) => g.links);

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.links.map((l) => {
              const active = pathname === l.href;
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={onNavigate}
                    className={`group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                      active
                        ? "bg-gradient-to-r from-emerald-400/15 via-cyan-400/10 to-transparent text-slate-50 shadow-[inset_0_0_0_1px_rgba(45,223,166,0.18)]"
                        : "text-slate-400 hover:translate-x-0.5 hover:bg-slate-800/50 hover:text-slate-100"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full transition-all ${
                        active
                          ? "bg-emerald-400 shadow-[0_0_10px_2px_rgba(45,223,166,0.55)]"
                          : "bg-slate-700 group-hover:bg-cyan-400/70"
                      }`}
                    />
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function WalletButton() {
  const { user, role, walletAddress, logout } = useSession();
  if (!user) return null;

  const label = user.name || shortAddress(walletAddress);

  return (
    <div className="flex items-center gap-2">
      {role ? <Badge label={role} status={role} className="hidden sm:inline-flex" /> : null}
      <div className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/60 px-2.5 py-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <div className="hidden leading-tight sm:block">
          <p className="max-w-[140px] truncate text-xs font-medium text-slate-100">{label}</p>
          <p className="font-mono text-[10px] text-slate-500">{shortAddress(walletAddress)}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            logout();
            toast("Wallet disconnected", "info");
          }}
          title="Disconnect wallet"
          aria-label="Disconnect wallet"
          className="rounded-lg p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 17l5-5-5-5M20 12H9M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function LoginScreen() {
  const { login, authLoading, authError } = useSession();
  const [role, setRole] = useState<RegisterRole>("producer");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await login({ role, name: name.trim() || undefined });
      toast(`Signed in as ${user.name}`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-10 h-72 w-72 animate-float rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-80 w-80 animate-float-slow rounded-full bg-violet-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 animate-float rounded-full bg-cyan-400/15 blur-3xl" />
      </div>

      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="relative grid w-full max-w-4xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="hidden flex-col justify-center lg:flex">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 via-cyan-400 to-violet-500 text-lg font-black text-slate-950 shadow-[0_10px_30px_-10px_rgba(45,223,166,0.8)]">
              T
            </span>
            <div>
              <p className="text-lg font-semibold tracking-tight text-slate-50">Tranergy AI</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                energy · verify · settle
              </p>
            </div>
          </div>
          <h1 className="mt-8 text-4xl font-semibold leading-tight tracking-tight text-slate-50">
            Verified energy,{" "}
            <span className="text-gradient">trusted settlement.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
            Certificates and meter evidence are verified before energy is matched, escrowed and
            settled. Connect a wallet to act as a producer, consumer, verifier or admin.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            {[
              ["Certificate checks", "Registry status + duplicate-use guards"],
              ["Anomaly triage", "Isolation Forest flags suspicious intervals"],
              ["Escrow matching", "Verified surplus reserved against demand"],
              ["On-chain receipts", "Evidence hashes and settlement proofs"],
            ].map(([title, hint]) => (
              <div
                key={title}
                className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-3 backdrop-blur transition hover:-translate-y-0.5 hover:border-emerald-400/30"
              >
                <p className="text-xs font-semibold text-slate-200">{title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel relative overflow-hidden p-6">
          <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />
          <div className="flex items-center gap-3 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-cyan-400 to-violet-500 text-sm font-black text-slate-950">
              T
            </span>
            <p className="text-sm font-semibold text-slate-50">Tranergy AI</p>
          </div>

          <h2 className="mt-4 text-xl font-semibold tracking-tight text-slate-50 lg:mt-0">
            Sign in with your wallet
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            No password. Sign a gas-free message to prove you own the wallet. The first wallet to
            register becomes the workspace admin (or set <code>ADMIN_WALLETS</code> on the API);
            every later wallet joins as a producer or consumer and an admin can grant verifier
            access.
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                I am joining as
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["producer", "consumer"] as RegisterRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`rounded-xl border px-3 py-2 text-sm capitalize transition ${
                      role === r
                        ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                        : "border-slate-700/80 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="wallet-name"
                className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400"
              >
                Display name <span className="normal-case text-slate-600">(optional)</span>
              </label>
              <input
                id="wallet-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="North Solar Farm"
                className="w-full rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20"
              />
            </div>

            <button
              type="button"
              onClick={connect}
              disabled={busy || authLoading}
              className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-emerald-400 via-cyan-400 to-violet-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_-12px_rgba(45,223,166,0.9)] transition hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy || authLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950" />
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1H6.5A3.5 3.5 0 0 0 3 11.5v-4Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M3 11.5A2.5 2.5 0 0 1 5.5 9H21v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-6Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                  <circle cx="17" cy="13.5" r="1.2" fill="currentColor" />
                </svg>
              )}
              {busy ? "Waiting for signature…" : "Connect wallet & sign in"}
            </button>

            {error || authError ? (
              <div className="rounded-xl border border-red-500/35 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                {error ?? authError}
              </div>
            ) : null}

            <p className="text-center text-[11px] leading-relaxed text-slate-600">
              A local EVM wallet (MetaMask, Rabby, Frame) works with the bundled Anvil chain.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { isAuthenticated, authLoading } = useSession();
  const current = ALL_LINKS.find((l) => l.href === pathname);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="panel flex items-center gap-3 px-6 py-4">
          <Spinner />
          <span className="text-sm text-slate-400">Checking wallet session…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-800/80 bg-slate-950/75 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-800/80 px-5">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-cyan-400 to-violet-500 text-sm font-black text-slate-950 shadow-[0_8px_24px_-10px_rgba(45,223,166,0.9)]">
            T
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_8px_2px_rgba(45,223,166,0.6)]" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-slate-50">Tranergy AI</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">energy · verify · settle</p>
          </div>
        </div>
        <NavLinks />
        <div className="border-t border-slate-800/80 px-5 py-3 text-[11px] leading-relaxed text-slate-500">
          Certificate verification &amp; escrowed microgrid settlement
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 animate-slide-in flex-col border-r border-slate-800/80 bg-slate-950">
            <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-5">
              <span className="text-sm font-semibold text-slate-50">Tranergy AI</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:text-slate-200"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-slate-800/70 bg-slate-950/70 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-2 text-slate-300 lg:hidden"
              aria-label="Open menu"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <div className="hidden items-center gap-2 text-sm text-slate-500 sm:flex">
              <span>Tranergy</span>
              <span className="text-slate-700">/</span>
              <span className="text-slate-200">{current?.label ?? "Dashboard"}</span>
            </div>
            <div className="ml-auto flex items-center gap-2.5">
              <ThemeToggle />
              <WalletButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl animate-rise px-4 py-7 pb-20 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
