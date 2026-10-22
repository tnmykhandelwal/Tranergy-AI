import fs from "node:fs";
import path from "node:path";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  keccak256,
  toUtf8Bytes,
  type Log,
  type Provider,
} from "ethers";
import { apiRoot, config } from "../config";

export interface ChainDeployment {
  network: string;
  chainId: number;
  energyTrade: string;
  greenRewardToken: string;
  deployer?: string;
  deployedAt?: string;
}

export interface ChainStatus {
  enabled: boolean;
  connected: boolean;
  chainId: number | null;
  blockNumber: number | null;
  contracts: { energyTrade: string | null; greenRewardToken: string | null };
  deploymentFile: string;
  error?: string;
}

const ENERGY_TRADE_INTERFACE = new Interface([
  "function createTrade(uint256 tradeId, address producer, address consumer, uint96 quantityKwh, uint96 pricePerKwhWei)",
  "function submitEvidence(uint256 tradeId, bytes32 evidenceHash)",
  "function attestAndSettle(uint256 tradeId)",
  "function dispute(uint256 tradeId, bytes32 reason)",
  "function getTrade(uint256 tradeId) view returns (tuple(address producer, address consumer, uint96 quantityKwh, uint96 pricePerKwhWei, uint8 state, bytes32 evidenceHash, address attestedBy, uint64 createdAt, uint64 settledAt))",
  "event TradeCreated(uint256 indexed tradeId, address producer, address consumer, uint96 quantityKwh, uint96 pricePerKwhWei)",
  "event EvidenceSubmitted(uint256 indexed tradeId, bytes32 evidenceHash, address submittedBy)",
  "event TradeSettled(uint256 indexed tradeId, address attestedBy)",
  "event RewardMinted(uint256 indexed tradeId, address producer, uint256 amount)",
  "event TradeDisputed(uint256 indexed tradeId, bytes32 reason)",
]);

const GREEN_REWARD_INTERFACE = new Interface([
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const TRADE_STATE_NAMES = ["None", "Matched", "EvidenceSubmitted", "Settled", "Disputed"] as const;

let cachedDeployment: ChainDeployment | null | undefined;
let cachedProvider: JsonRpcProvider | null = null;
let lastAvailabilityCheck = { at: 0, ok: false };

function deploymentPath(): string {
  return path.isAbsolute(config.CONTRACTS_DEPLOYMENT_FILE)
    ? config.CONTRACTS_DEPLOYMENT_FILE
    : path.resolve(apiRoot, config.CONTRACTS_DEPLOYMENT_FILE);
}

export function loadDeployment(): ChainDeployment | null {
  if (cachedDeployment !== undefined) return cachedDeployment;
  try {
    const file = deploymentPath();
    if (!fs.existsSync(file)) {
      cachedDeployment = null;
      return null;
    }
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as ChainDeployment;
    if (!parsed.energyTrade || !parsed.greenRewardToken) {
      cachedDeployment = null;
      return null;
    }
    cachedDeployment = parsed;
    return parsed;
  } catch {
    cachedDeployment = null;
    return null;
  }
}

function getProvider(): JsonRpcProvider {
  if (!cachedProvider) {
    cachedProvider = new JsonRpcProvider(config.ANVIL_RPC_URL, undefined, { staticNetwork: true });
  }
  return cachedProvider;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function rpcReachable(timeoutMs = 2000): Promise<boolean> {
  try {
    await withTimeout(getProvider().getBlockNumber(), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export async function isAvailable(): Promise<boolean> {
  if (!config.CHAIN_ENABLED) return false;
  const now = Date.now();
  if (now - lastAvailabilityCheck.at < 10_000) return lastAvailabilityCheck.ok;
  const deployment = loadDeployment();
  const ok = Boolean(deployment && config.OPERATOR_PRIVATE_KEY) && (await rpcReachable());
  lastAvailabilityCheck = { at: now, ok };
  return ok;
}

export async function getChainStatus(): Promise<ChainStatus> {
  const deployment = loadDeployment();
  const contracts = {
    energyTrade: deployment?.energyTrade ?? null,
    greenRewardToken: deployment?.greenRewardToken ?? null,
  };
  if (!config.CHAIN_ENABLED) {
    return {
      enabled: false,
      connected: false,
      chainId: deployment?.chainId ?? null,
      blockNumber: null,
      contracts,
      deploymentFile: config.CONTRACTS_DEPLOYMENT_FILE,
    };
  }
  if (!deployment) {
    return {
      enabled: true,
      connected: false,
      chainId: null,
      blockNumber: null,
      contracts,
      deploymentFile: config.CONTRACTS_DEPLOYMENT_FILE,
      error: `deployment file not found or invalid: ${config.CONTRACTS_DEPLOYMENT_FILE}`,
    };
  }
  try {
    const blockNumber = await withTimeout(getProvider().getBlockNumber(), 2000);
    return {
      enabled: true,
      connected: true,
      chainId: deployment.chainId,
      blockNumber,
      contracts,
      deploymentFile: config.CONTRACTS_DEPLOYMENT_FILE,
    };
  } catch (err) {
    return {
      enabled: true,
      connected: false,
      chainId: deployment.chainId,
      blockNumber: null,
      contracts,
      deploymentFile: config.CONTRACTS_DEPLOYMENT_FILE,
      error: err instanceof Error ? err.message : "rpc unreachable",
    };
  }
}

function operatorWallet(): Wallet | null {
  if (!config.OPERATOR_PRIVATE_KEY) return null;
  return new Wallet(config.OPERATOR_PRIVATE_KEY, getProvider());
}

function attestorWallet(): Wallet | null {
  if (!config.ATTESTOR_PRIVATE_KEY) return null;
  return new Wallet(config.ATTESTOR_PRIVATE_KEY, getProvider());
}

function energyTradeContract(runner: Provider | Wallet): Contract {
  const deployment = loadDeployment();
  if (!deployment) throw new Error("deployment file unavailable");
  return new Contract(deployment.energyTrade, ENERGY_TRADE_INTERFACE, runner);
}

function greenRewardTokenContract(runner: Provider | Wallet): Contract {
  const deployment = loadDeployment();
  if (!deployment) throw new Error("deployment file unavailable");
  return new Contract(deployment.greenRewardToken, GREEN_REWARD_INTERFACE, runner);
}

export function userAddressFromId(userId: string): string {
  const hash = keccak256(toUtf8Bytes(`tranergy:${userId}`));
  return `0x${hash.slice(-40)}`;
}

function numericTradeId(dbTradeId: string): bigint {
  const hash = keccak256(toUtf8Bytes(dbTradeId));
  return BigInt(hash) % 1_000_000_000n;
}

function priceToWei(pricePerKwh: number): bigint {
  return BigInt(Math.floor(pricePerKwh * 1e6)) * 10n ** 12n;
}

function parseTradeCreated(log: Log): number | null {
  const parsed = ENERGY_TRADE_INTERFACE.parseLog({
    topics: [...log.topics],
    data: log.data,
  });
  if (!parsed || parsed.name !== "TradeCreated") return null;
  return Number(parsed.args.tradeId);
}

function isNonceError(err: unknown): boolean {
  const code = err as { code?: string };
  const message = err instanceof Error ? err.message : "";
  return code?.code === "NONCE_EXPIRED" || message.toLowerCase().includes("nonce");
}

async function sendWithNonceRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isNonceError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await fn();
  }
}

export async function createTradeOnChain(
  dbTradeId: string,
  producerAddress: string,
  consumerAddress: string,
  quantityKwh: number,
  pricePerKwh: number,
): Promise<{ chainTradeId: number | null; txHash: string | null }> {
  if (!(await isAvailable())) return { chainTradeId: null, txHash: null };
  const wallet = operatorWallet();
  if (!wallet) return { chainTradeId: null, txHash: null };
  const contract = energyTradeContract(wallet);
  const tradeId = numericTradeId(dbTradeId);
  const tx = await sendWithNonceRetry(() =>
    contract.createTrade(
      tradeId,
      producerAddress,
      consumerAddress,
      Math.round(quantityKwh),
      priceToWei(pricePerKwh),
    ),
  );
  const receipt = await tx.wait();
  let chainTradeId = Number(tradeId);
  for (const log of receipt.logs as Log[]) {
    try {
      const parsedId = parseTradeCreated(log);
      if (parsedId !== null) {
        chainTradeId = parsedId;
        break;
      }
    } catch {
      continue;
    }
  }
  return { chainTradeId, txHash: receipt.hash };
}

export async function submitEvidenceOnChain(
  chainTradeId: number,
  evidenceHash: string,
): Promise<string | null> {
  if (!(await isAvailable())) return null;
  const wallet = operatorWallet();
  if (!wallet) return null;
  const contract = energyTradeContract(wallet);
  const tx = await sendWithNonceRetry(() => contract.submitEvidence(chainTradeId, evidenceHash));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function attestAndSettleOnChain(chainTradeId: number): Promise<string | null> {
  if (!(await isAvailable())) return null;
  const wallet = attestorWallet();
  if (!wallet) return null;
  const contract = energyTradeContract(wallet);
  const tx = await sendWithNonceRetry(() => contract.attestAndSettle(chainTradeId));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function disputeOnChain(chainTradeId: number, reason: string): Promise<string | null> {
  if (!(await isAvailable())) return null;
  const wallet = attestorWallet();
  if (!wallet) return null;
  const contract = energyTradeContract(wallet);
  const reasonHash = keccak256(toUtf8Bytes(reason));
  const tx = await sendWithNonceRetry(() => contract.dispute(chainTradeId, reasonHash));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function getStateOnChain(chainTradeId: number): Promise<string | null> {
  if (!(await isAvailable())) return null;
  const provider = getProvider();
  const contract = energyTradeContract(provider);
  const trade = await contract.getTrade(chainTradeId);
  const index = Number(trade.state);
  return TRADE_STATE_NAMES[index] ?? null;
}

export async function getTokenBalance(address: string): Promise<{ symbol: string; decimals: number; balance: string } | null> {
  if (!(await isAvailable())) return null;
  const contract = greenRewardTokenContract(getProvider());
  const [symbol, decimals, balance] = await Promise.all([
    contract.symbol(),
    contract.decimals(),
    contract.balanceOf(address),
  ]);
  return { symbol, decimals: Number(decimals), balance: balance.toString() };
}

export function resetChainCaches(): void {
  cachedDeployment = undefined;
  cachedProvider = null;
  lastAvailabilityCheck = { at: 0, ok: false };
}
