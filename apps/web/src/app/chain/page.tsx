"use client";

import { useState } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import { getChainStatus, getTrades, type ChainStatus, type Trade } from "@/lib/api";
import { mintTestSettlementToken } from "@/lib/escrow";
import { useAsyncData } from "@/lib/useAsyncData";
import { useSession } from "@/lib/session";
import { formatTs, formatWei, shortHex } from "@/lib/format";
import { ApiBanner } from "@/components/ApiBanner";
import { Badge } from "@/components/Badge";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toast";
import { Callout, FieldLabel, buttonPrimary, buttonSecondary, cardClass, inputClass } from "@/components/ui";

const RPC_URL = process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const BALANCE_OF_ABI = ["function balanceOf(address owner) view returns (uint256)"];

function CopyableHex({ value, chars = 10 }: { value?: string | null; chars?: number }) {
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
      {shortHex(value, chars, 6)}
    </button>
  );
}

function ChainStatusCard({ status }: { status: ChainStatus }) {
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Chain status</h2>
        <div className="flex items-center gap-2">
          {!status.enabled ? (
            <Badge label="disabled" status="UNKNOWN" />
          ) : status.connected ? (
            <Badge label="connected" status="VERIFIED" />
          ) : (
            <Badge label="RPC down" status="INVALID" />
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">chainId</span>
            <span className="font-mono text-slate-200">{status.chainId ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">blockNumber</span>
            <span className="font-mono text-slate-200">{status.blockNumber ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">deployment file</span>
            <span className="font-mono text-[11px] text-slate-300">{status.deploymentFile ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">rpc</span>
            <span className="font-mono text-[11px] text-slate-300">{RPC_URL}</span>
          </div>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">EnergyTrade</span>
            <CopyableHex value={status.contracts?.energyTrade} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">GreenRewardToken</span>
            <CopyableHex value={status.contracts?.greenRewardToken} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">
              Settlement token{status.settlementTokenSymbol ? ` (${status.settlementTokenSymbol})` : ""}
            </span>
            <CopyableHex value={status.contracts?.settlementToken} />
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">settlement decimals</span>
            <span className="font-mono text-slate-200">{status.settlementTokenDecimals ?? "—"}</span>
          </div>
        </div>
      </div>
      {status.error ? (
        <div className="mt-3">
          <Callout tone="error" title="Chain error">{status.error}</Callout>
        </div>
      ) : null}
    </div>
  );
}

export default function ChainPage() {
  const { userId, walletAddress } = useSession();
  const chain = useAsyncData(() => getChainStatus(), [], { refreshMs: 10000 });
  const trades = useAsyncData(() => getTrades(), [userId], { refreshMs: 20000 });

  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [balanceErr, setBalanceErr] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);

  const tokenAddress = chain.data?.contracts?.greenRewardToken ?? null;
  const settlementToken = chain.data?.contracts?.settlementToken ?? null;
  const faucet = async () => {
    if (!settlementToken) {
      toast("Settlement token address unknown — deploy the chain first.", "error");
      return;
    }
    setFaucetBusy(true);
    try {
      const tx = await mintTestSettlementToken(settlementToken);
      toast(`Minted 1,000,000 test tokens · tx ${shortHex(tx, 8, 6)}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setFaucetBusy(false);
    }
  };

  const lookup = async () => {
    setBalance(null);
    setBalanceErr(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address.trim())) {
      setBalanceErr("Enter a valid 0x address.");
      return;
    }
    if (!tokenAddress) {
      setBalanceErr("GreenRewardToken address unknown — is the chain deployed?");
      return;
    }
    setBalanceBusy(true);
    try {
      const provider = new JsonRpcProvider(RPC_URL);
      const token = new Contract(tokenAddress, BALANCE_OF_ABI, provider);
      const raw = (await token.balanceOf(address.trim())) as bigint;
      setBalance(formatWei(raw.toString()));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBalanceErr(`RPC unreachable at ${RPC_URL}: ${msg.split("\n")[0]}`);
    } finally {
      setBalanceBusy(false);
    }
  };

  const onChainTrades = (trades.data?.trades ?? []).filter((t) => t.chainTxHash || t.settlementTxHash);

  const columns: Column<Trade>[] = [
    { key: "id", header: "Trade", render: (t) => <span className="font-mono text-xs text-emerald-300">{t.id}</span> },
    { key: "state", header: "State", render: (t) => <Badge label={t.state} status={t.state} /> },
    { key: "chainId", header: "Chain trade id", align: "right", render: (t) => t.chainTradeId ?? "—" },
    {
      key: "tx",
      header: "Evidence tx",
      render: (t) =>
        t.chainTxHash ? (
          <span title={t.chainTxHash} className="font-mono text-[11px] text-cyan-300">
            {shortHex(t.chainTxHash, 10, 6)}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        ),
    },
    {
      key: "settle",
      header: "Settlement tx",
      render: (t) =>
        t.settlementTxHash ? (
          <span title={t.settlementTxHash} className="font-mono text-[11px] text-emerald-300">
            {shortHex(t.settlementTxHash, 10, 6)}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        ),
    },
    { key: "updated", header: "Updated", render: (t) => formatTs(t.updatedAt ?? t.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Chain"
        description="Local devnet status, deployed contracts and on-chain settlement activity."
        actions={
          <button
            type="button"
            onClick={() => {
              chain.reload();
              trades.reload();
            }}
            className={buttonSecondary}
          >
            Refresh
          </button>
        }
      />

      <ApiBanner
        message={chain.offline ? "Cannot reach the API — chain status unavailable until the backend is running." : chain.error}
        onRetry={chain.reload}
      />

      <div className="space-y-5">
        {chain.data ? (
          <ChainStatusCard status={chain.data} />
        ) : (
          <div className={`${cardClass} p-8`}>
            <Spinner label="Loading chain status…" />
          </div>
        )}

        <div className={`${cardClass} p-4`}>
          <h2 className="text-sm font-semibold text-slate-100">Recent on-chain events</h2>
          <p className="mb-3 text-xs text-slate-500">
            Trades carrying chain transaction hashes (evidence submission and settlement).
          </p>
          <DataTable
            columns={columns}
            rows={onChainTrades}
            rowKey={(t) => t.id}
            emptyMessage="No on-chain activity yet — submit delivery evidence and settle a trade to see transactions here."
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className={`${cardClass} p-4`}>
            <h2 className="text-sm font-semibold text-slate-100">GreenRewardToken balance</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Read-only <code className="text-slate-400">balanceOf</code> via ethers JsonRpcProvider ({RPC_URL})
              — no signing involved.
            </p>
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <FieldLabel>Wallet address</FieldLabel>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="0x…"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <button type="button" onClick={lookup} disabled={balanceBusy} className={buttonPrimary}>
                {balanceBusy ? <Spinner /> : null} Lookup
              </button>
            </div>
            {balanceBusy ? (
              <p className="mt-3 text-xs text-slate-500">querying RPC…</p>
            ) : null}
            {balance !== null ? (
              <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-emerald-400">Balance (GRT)</p>
                <p className="mt-0.5 font-mono text-lg tabular-nums text-emerald-200">{balance}</p>
              </div>
            ) : null}
            {balanceErr ? <div className="mt-3"><Callout tone="error" title="Lookup failed">{balanceErr}</Callout></div> : null}
          </div>

          <div className={`${cardClass} p-4`}>
            <h2 className="text-sm font-semibold text-slate-100">Test settlement token</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Mutual escrow uses {chain.data?.settlementTokenSymbol ?? "TSTR"} with{" "}
              {chain.data?.settlementTokenDecimals ?? 6} decimals. Mint test funds to the connected wallet
              ({walletAddress ? shortHex(walletAddress, 6, 4) : "not connected"}).
            </p>
            <button type="button" onClick={faucet} disabled={faucetBusy || !walletAddress} className={`${buttonPrimary} mt-3`}>
              {faucetBusy ? <Spinner /> : null} Faucet 1,000,000 {chain.data?.settlementTokenSymbol ?? "TSTR"}
            </button>
            <p className="mt-3 text-[11px] text-slate-500">
              Test asset only — no monetary value. Each escrow deposit requires an ERC-20 approval followed by the deposit transaction.
            </p>
          </div>

          <div className={`${cardClass} p-4`}>
            <h2 className="text-sm font-semibold text-slate-100">Local stack</h2>
            <p className="mt-0.5 text-xs text-slate-500">Start everything in this order:</p>
            <ol className="mt-3 space-y-2">
              {[
                { cmd: "anvil --host 127.0.0.1 --port 8545", desc: "local chain (npm run chain:anvil)" },
                { cmd: "bash scripts/deploy-chain.sh", desc: "deploy EnergyTrade + GreenRewardToken + MockSettlementToken" },
                { cmd: "npm run dev -w services/api", desc: "API on :4000 (uses your Postgres database)" },
                { cmd: "bash scripts/run-ml.sh", desc: "ML service on :8000" },
                { cmd: "open http://localhost:3000/setup", desc: "create facilities, meters and certificates" },
              ].map((step, i) => (
                <li key={step.cmd} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-[10px] font-semibold text-emerald-300">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-slate-200">{step.cmd}</p>
                    <p className="text-[11px] text-slate-500">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] text-slate-500">
              Escrow-capable deployments refuse to create trades while the chain/operator is unavailable; actions
              return 503 and are safe to retry. Legacy deployments without a settlement token still use the off-chain path.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
