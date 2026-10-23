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
  settlementToken?: string;
  settlementTokenSymbol?: string;
  settlementTokenDecimals?: number;
  collateralRatioBps?: number;
  defaultGracePeriod?: number;
  deployer?: string;
  deployedAt?: string;
}

export interface ChainStatus {
  enabled: boolean;
  connected: boolean;
  chainId: number | null;
  blockNumber: number | null;
  contracts: {
    energyTrade: string | null;
    greenRewardToken: string | null;
    settlementToken: string | null;
  };
  settlementTokenSymbol: string | null;
  settlementTokenDecimals: number | null;
  deploymentFile: string;
  error?: string;
}

export interface EscrowSnapshot {
  enabled: boolean;
  collateralRatioBps: number;
  fundingDeadline: number;
  deliveryDeadline: number;
  gracePeriod: number;
  activatedAt: number;
  settledAt: number;
  quantityKwhMilli: string;
  pricePerKwhUnits: string;
  tradeValue: string;
  paymentRequired: string;
  consumerCollateralRequired: string;
  producerCollateralRequired: string;
  paymentFunded: string;
  consumerCollateralFunded: string;
  producerCollateralFunded: string;
  deliveredKwhMilli: string;
  paymentToProducer: string;
  paymentRefunded: string;
  producerCollateralReturned: string;
  producerCollateralSlashed: string;
  consumerCollateralReturned: string;
  disputeReason: string;
  resolutionEvidenceHash: string;
  outcome: number;
  state: string;
}

export interface SettlementTokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

const ENERGY_TRADE_INTERFACE = new Interface([
  "function createTrade(uint256 tradeId, address producer, address consumer, uint96 quantityKwh, uint96 pricePerKwhWei)",
  "function createEscrowTrade(uint256 tradeId, address producer, address consumer, uint96 quantityKwhMilli, uint96 pricePerKwhUnits, uint64 fundingDeadline, uint64 deliveryDeadline)",
  "function depositConsumerPayment(uint256 tradeId)",
  "function depositConsumerCollateral(uint256 tradeId)",
  "function depositProducerCollateral(uint256 tradeId)",
  "function submitEvidence(uint256 tradeId, bytes32 evidenceHash)",
  "function attestAndSettle(uint256 tradeId)",
  "function attestPartialDelivery(uint256 tradeId, uint256 deliveredKwhMilli)",
  "function resolveProducerDefault(uint256 tradeId, bytes32 evidenceHash)",
  "function raiseDispute(uint256 tradeId, bytes32 reason)",
  "function dispute(uint256 tradeId, bytes32 reason)",
  "function resolveDispute(uint256 tradeId, uint8 outcome, uint256 deliveredKwhMilli, bytes32 reason, bytes32 evidenceHash)",
  "function cancelExpiredEscrow(uint256 tradeId)",
  "function getTrade(uint256 tradeId) view returns (tuple(address producer, address consumer, uint96 quantityKwh, uint96 pricePerKwhWei, uint8 state, bytes32 evidenceHash, address attestedBy, uint64 createdAt, uint64 settledAt, bool rewardMinted))",
  "function getEscrow(uint256 tradeId) view returns (tuple(bool enabled, uint16 collateralRatioBps, uint64 fundingDeadline, uint64 deliveryDeadline, uint64 gracePeriod, uint64 activatedAt, uint64 settledAt, uint96 quantityKwhMilli, uint96 pricePerKwhUnits, uint256 tradeValue, uint256 paymentRequired, uint256 consumerCollateralRequired, uint256 producerCollateralRequired, uint256 paymentFunded, uint256 consumerCollateralFunded, uint256 producerCollateralFunded, uint256 deliveredKwhMilli, uint256 paymentToProducer, uint256 paymentRefunded, uint256 producerCollateralReturned, uint256 producerCollateralSlashed, uint256 consumerCollateralReturned, bytes32 disputeReason, bytes32 resolutionEvidenceHash, uint8 outcome))",
  "function collateralRatioBps() view returns (uint16)",
  "function defaultGracePeriod() view returns (uint64)",
  "function settlementToken() view returns (address)",
  "event TradeCreated(uint256 indexed tradeId, address producer, address consumer, uint96 quantityKwh, uint96 pricePerKwhWei)",
  "event EscrowTradeCreated(uint256 indexed tradeId, address indexed producer, address indexed consumer, uint256 quantityKwhMilli, uint256 pricePerKwhUnits, uint256 tradeValue, uint256 consumerPaymentRequired, uint256 consumerCollateralRequired, uint256 producerCollateralRequired, uint64 fundingDeadline, uint64 deliveryDeadline, uint16 collateralRatioBps, uint64 gracePeriod)",
  "event EvidenceSubmitted(uint256 indexed tradeId, bytes32 evidenceHash, address submittedBy)",
  "event TradeSettled(uint256 indexed tradeId, address attestedBy)",
  "event RewardMinted(uint256 indexed tradeId, address producer, uint256 amount)",
  "event TradeDisputed(uint256 indexed tradeId, bytes32 reason)",
  "event EscrowDeposited(uint256 indexed tradeId, address indexed payer, uint8 indexed kind, uint256 amount, uint256 totalFunded)",
  "event EscrowFunded(uint256 indexed tradeId, uint256 totalLocked, uint64 activatedAt)",
  "event DeliveryActivated(uint256 indexed tradeId, uint64 activatedAt)",
  "event EscrowSettled(uint256 indexed tradeId, uint8 outcome, uint256 paymentToProducer, uint256 paymentRefunded, uint256 producerCollateralReturned, uint256 producerCollateralSlashed, uint256 consumerCollateralReturned, uint256 deliveredKwhMilli, address indexed attestedBy)",
  "event EscrowDisputeRaised(uint256 indexed tradeId, address indexed raisedBy, bytes32 reason)",
  "event EscrowDisputeResolved(uint256 indexed tradeId, uint8 outcome, bytes32 reason, bytes32 evidenceHash, address indexed attestedBy)",
  "event EscrowCancelled(uint256 indexed tradeId, uint256 refundedToConsumer, uint256 refundedToProducer)",
  "event EscrowRefunded(uint256 indexed tradeId, address indexed recipient, uint8 indexed kind, uint256 amount)",
]);

const GREEN_REWARD_INTERFACE = new Interface([
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const SETTLEMENT_TOKEN_INTERFACE = new Interface([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const TRADE_STATE_NAMES = [
  "None",
  "Matched",
  "EvidenceSubmitted",
  "Settled",
  "Disputed",
  "DeliveryActive",
  "Cancelled",
  "Defaulted",
  "PartiallySettled",
] as const;

const ESCROW_OUTCOME_NAMES = [
  "None",
  "FullDelivery",
  "PartialDelivery",
  "ProducerDefault",
  "Cancelled",
] as const;

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

/** Read-only availability: enough for verification and reconciliation endpoints. */
export async function isReadable(): Promise<boolean> {
  if (!config.CHAIN_ENABLED) return false;
  const deployment = loadDeployment();
  if (!deployment) return false;
  return rpcReachable();
}

/** Write availability for operator / attestor transactions. */
export async function isAvailable(): Promise<boolean> {
  if (!config.CHAIN_ENABLED) return false;
  const now = Date.now();
  if (now - lastAvailabilityCheck.at < 10_000) return lastAvailabilityCheck.ok;
  const deployment = loadDeployment();
  const ok = Boolean(deployment && config.OPERATOR_PRIVATE_KEY) && (await rpcReachable());
  lastAvailabilityCheck = { at: now, ok };
  return ok;
}

export function isEscrowConfigured(): boolean {
  const deployment = loadDeployment();
  return Boolean(
    config.CHAIN_ENABLED &&
      deployment?.energyTrade &&
      deployment?.settlementToken &&
      Number(deployment.settlementTokenDecimals) > 0,
  );
}

export async function getSettlementTokenInfo(): Promise<SettlementTokenInfo | null> {
  const deployment = loadDeployment();
  if (!deployment?.settlementToken) return null;
  const address = deployment.settlementToken;
  try {
    const contract = new Contract(address, SETTLEMENT_TOKEN_INTERFACE, getProvider());
    const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()]);
    return { address, symbol: String(symbol), decimals: Number(decimals) };
  } catch {
    if (deployment.settlementTokenSymbol && deployment.settlementTokenDecimals) {
      return {
        address,
        symbol: deployment.settlementTokenSymbol,
        decimals: Number(deployment.settlementTokenDecimals),
      };
    }
    return null;
  }
}

export async function getChainStatus(): Promise<ChainStatus> {
  const deployment = loadDeployment();
  const contracts = {
    energyTrade: deployment?.energyTrade ?? null,
    greenRewardToken: deployment?.greenRewardToken ?? null,
    settlementToken: deployment?.settlementToken ?? null,
  };
  const tokenMeta = {
    settlementTokenSymbol: deployment?.settlementTokenSymbol ?? null,
    settlementTokenDecimals: deployment?.settlementTokenDecimals ?? null,
  };
  if (!config.CHAIN_ENABLED) {
    return {
      enabled: false,
      connected: false,
      chainId: deployment?.chainId ?? null,
      blockNumber: null,
      contracts,
      ...tokenMeta,
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
      ...tokenMeta,
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
      ...tokenMeta,
      deploymentFile: config.CONTRACTS_DEPLOYMENT_FILE,
    };
  } catch (err) {
    return {
      enabled: true,
      connected: false,
      chainId: deployment.chainId,
      blockNumber: null,
      contracts,
      ...tokenMeta,
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

export function numericTradeId(dbTradeId: string): bigint {
  const hash = keccak256(toUtf8Bytes(dbTradeId));
  return BigInt(hash) % 1_000_000_000n;
}

function priceToWei(pricePerKwh: number): bigint {
  return BigInt(Math.floor(pricePerKwh * 1e6)) * 10n ** 12n;
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

function asNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

function asString(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

function parseTradeState(value: unknown): string {
  const index = asNumber(value);
  return TRADE_STATE_NAMES[index] ?? "Unknown";
}

function readEscrowFromContract(
  contract: Contract,
  chainTradeId: number,
): Promise<EscrowSnapshot> {
  return Promise.resolve()
    .then(async () => {
      const [trade, escrow] = await Promise.all([
        contract.getTrade(chainTradeId),
        contract.getEscrow(chainTradeId),
      ]);
      const snapshot: EscrowSnapshot = {
        enabled: Boolean(escrow.enabled),
        collateralRatioBps: asNumber(escrow.collateralRatioBps),
        fundingDeadline: asNumber(escrow.fundingDeadline),
        deliveryDeadline: asNumber(escrow.deliveryDeadline),
        gracePeriod: asNumber(escrow.gracePeriod),
        activatedAt: asNumber(escrow.activatedAt),
        settledAt: asNumber(escrow.settledAt),
        quantityKwhMilli: asString(escrow.quantityKwhMilli),
        pricePerKwhUnits: asString(escrow.pricePerKwhUnits),
        tradeValue: asString(escrow.tradeValue),
        paymentRequired: asString(escrow.paymentRequired),
        consumerCollateralRequired: asString(escrow.consumerCollateralRequired),
        producerCollateralRequired: asString(escrow.producerCollateralRequired),
        paymentFunded: asString(escrow.paymentFunded),
        consumerCollateralFunded: asString(escrow.consumerCollateralFunded),
        producerCollateralFunded: asString(escrow.producerCollateralFunded),
        deliveredKwhMilli: asString(escrow.deliveredKwhMilli),
        paymentToProducer: asString(escrow.paymentToProducer),
        paymentRefunded: asString(escrow.paymentRefunded),
        producerCollateralReturned: asString(escrow.producerCollateralReturned),
        producerCollateralSlashed: asString(escrow.producerCollateralSlashed),
        consumerCollateralReturned: asString(escrow.consumerCollateralReturned),
        disputeReason: asString(escrow.disputeReason),
        resolutionEvidenceHash: asString(escrow.resolutionEvidenceHash),
        outcome: asNumber(escrow.outcome),
        state: parseTradeState(trade.state),
      };
      return snapshot;
    });
}

export async function getEscrowOnChain(chainTradeId: number): Promise<EscrowSnapshot | null> {
  if (!(await isReadable())) return null;
  return readEscrowFromContract(energyTradeContract(getProvider()), chainTradeId);
}

export async function getTradeOnChain(chainTradeId: number): Promise<{
  producer: string;
  consumer: string;
  state: string;
  evidenceHash: string;
  attestedBy: string;
  settledAt: number;
} | null> {
  if (!(await isReadable())) return null;
  const contract = energyTradeContract(getProvider());
  const trade = await contract.getTrade(chainTradeId);
  return {
    producer: String(trade.producer),
    consumer: String(trade.consumer),
    state: parseTradeState(trade.state),
    evidenceHash: String(trade.evidenceHash),
    attestedBy: String(trade.attestedBy),
    settledAt: asNumber(trade.settledAt),
  };
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
  return { chainTradeId: Number(tradeId), txHash: receipt.hash };
}

export async function createEscrowTradeOnChain(
  dbTradeId: string,
  producerAddress: string,
  consumerAddress: string,
  quantityKwhMilli: bigint,
  pricePerKwhUnits: bigint,
  fundingDeadline: number,
  deliveryDeadline: number,
): Promise<{ chainTradeId: number; txHash: string; snapshot: EscrowSnapshot }> {
  if (!(await isAvailable())) throw new Error("chain write unavailable");
  const wallet = operatorWallet();
  if (!wallet) throw new Error("operator key unavailable");
  const contract = energyTradeContract(wallet);
  const tradeId = numericTradeId(dbTradeId);
  const tx = await sendWithNonceRetry(() =>
    contract.createEscrowTrade(
      tradeId,
      producerAddress,
      consumerAddress,
      quantityKwhMilli,
      pricePerKwhUnits,
      fundingDeadline,
      deliveryDeadline,
    ),
  );
  const receipt = await tx.wait();
  const snapshot = await readEscrowFromContract(energyTradeContract(getProvider()), Number(tradeId));
  return { chainTradeId: Number(tradeId), txHash: receipt.hash, snapshot };
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

export async function attestPartialDeliveryOnChain(
  chainTradeId: number,
  deliveredKwhMilli: bigint,
): Promise<string | null> {
  if (!(await isAvailable())) return null;
  const wallet = attestorWallet();
  if (!wallet) return null;
  const contract = energyTradeContract(wallet);
  const tx = await sendWithNonceRetry(() =>
    contract.attestPartialDelivery(chainTradeId, deliveredKwhMilli),
  );
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function resolveProducerDefaultOnChain(
  chainTradeId: number,
  evidenceHash: string,
): Promise<string | null> {
  if (!(await isAvailable())) return null;
  const wallet = attestorWallet();
  if (!wallet) return null;
  const contract = energyTradeContract(wallet);
  const tx = await sendWithNonceRetry(() =>
    contract.resolveProducerDefault(chainTradeId, evidenceHash),
  );
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function resolveDisputeOnChain(
  chainTradeId: number,
  outcome: number,
  deliveredKwhMilli: bigint,
  reason: string,
  evidenceHash: string,
): Promise<string | null> {
  if (!(await isAvailable())) return null;
  const wallet = attestorWallet();
  if (!wallet) return null;
  const contract = energyTradeContract(wallet);
  const reasonHash = keccak256(toUtf8Bytes(reason));
  const tx = await sendWithNonceRetry(() =>
    contract.resolveDispute(chainTradeId, outcome, deliveredKwhMilli, reasonHash, evidenceHash),
  );
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function cancelExpiredEscrowOnChain(chainTradeId: number): Promise<string | null> {
  if (!(await isAvailable())) return null;
  const wallet = operatorWallet();
  if (!wallet) return null;
  const contract = energyTradeContract(wallet);
  const tx = await sendWithNonceRetry(() => contract.cancelExpiredEscrow(chainTradeId));
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
  if (!(await isReadable())) return null;
  const provider = getProvider();
  const contract = energyTradeContract(provider);
  const trade = await contract.getTrade(chainTradeId);
  return parseTradeState(trade.state);
}

export async function getTokenBalance(
  address: string,
): Promise<{ symbol: string; decimals: number; balance: string } | null> {
  if (!(await isReadable())) return null;
  const contract = greenRewardTokenContract(getProvider());
  const [symbol, decimals, balance] = await Promise.all([
    contract.symbol(),
    contract.decimals(),
    contract.balanceOf(address),
  ]);
  return { symbol: String(symbol), decimals: Number(decimals), balance: balance.toString() };
}

async function waitForReceipt(
  txHash: string,
): Promise<NonNullable<Awaited<ReturnType<JsonRpcProvider["getTransactionReceipt"]>>>> {
  const receipt = await getProvider().waitForTransaction(txHash, 1, 60_000);
  if (!receipt) throw new Error(`transaction ${txHash} was not confirmed`);
  if (receipt.status !== 1) throw new Error(`transaction ${txHash} reverted`);
  return receipt;
}

export interface VerifiedDeposit {
  tradeId: bigint;
  payer: string;
  kind: number;
  amount: bigint;
  totalFunded: bigint;
  txHash: string;
}

export async function verifyEscrowDepositTx(
  txHash: string,
  expectedChainTradeId: number,
  expectedPayer: string,
  expectedKind: number,
  expectedAmount: string,
): Promise<VerifiedDeposit> {
  if (!(await isReadable())) throw new Error("chain unavailable");
  const deployment = loadDeployment();
  if (!deployment) throw new Error("deployment unavailable");
  const receipt = await waitForReceipt(txHash);
  if ((receipt.to ?? "").toLowerCase() !== deployment.energyTrade.toLowerCase()) {
    throw new Error("transaction did not target the EnergyTrade contract");
  }

  for (const log of receipt.logs as Log[]) {
    let parsed;
    try {
      parsed = ENERGY_TRADE_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== "EscrowDeposited") continue;
    const tradeId = parsed.args.tradeId as bigint;
    const payer = String(parsed.args.payer);
    const kind = asNumber(parsed.args.kind);
    const amount = parsed.args.amount as bigint;
    if (tradeId !== BigInt(expectedChainTradeId)) continue;
    if (payer.toLowerCase() !== expectedPayer.toLowerCase()) continue;
    if (kind !== expectedKind) continue;
    if (amount.toString() !== expectedAmount) continue;
    return {
      tradeId,
      payer,
      kind,
      amount,
      totalFunded: parsed.args.totalFunded as bigint,
      txHash: receipt.hash,
    };
  }
  throw new Error("confirmed transaction does not contain the expected EscrowDeposited event");
}

export async function verifyEscrowDisputeTx(
  txHash: string,
  expectedChainTradeId: number,
  expectedParty: string,
  reason: string,
): Promise<{ txHash: string; reason: string; raisedBy: string }> {
  if (!(await isReadable())) throw new Error("chain unavailable");
  const deployment = loadDeployment();
  if (!deployment) throw new Error("deployment unavailable");
  const receipt = await waitForReceipt(txHash);
  if ((receipt.to ?? "").toLowerCase() !== deployment.energyTrade.toLowerCase()) {
    throw new Error("transaction did not target the EnergyTrade contract");
  }
  const reasonHash = keccak256(toUtf8Bytes(reason));
  for (const log of receipt.logs as Log[]) {
    let parsed;
    try {
      parsed = ENERGY_TRADE_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== "EscrowDisputeRaised") continue;
    if (parsed.args.tradeId !== BigInt(expectedChainTradeId)) continue;
    if (String(parsed.args.raisedBy).toLowerCase() !== expectedParty.toLowerCase()) continue;
    if (String(parsed.args.reason) !== reasonHash) continue;
    return { txHash: receipt.hash, reason, raisedBy: String(parsed.args.raisedBy) };
  }
  throw new Error("confirmed transaction does not contain the expected EscrowDisputeRaised event");
}

export { ESCROW_OUTCOME_NAMES, TRADE_STATE_NAMES };

export function resetChainCaches(): void {
  cachedDeployment = undefined;
  cachedProvider = null;
  lastAvailabilityCheck = { at: 0, ok: false };
}
