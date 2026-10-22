const BASE_URL: string = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
const SESSION_KEY = "tranergy.actingUser";
const TOKEN_KEY = "tranergy.authToken";
const DEFAULT_USER_ID = "";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

let actingUserId: string | null = null;
let authToken: string | null = null;

export function setActingUserId(id: string | null): void {
  actingUserId = id;
}

export function getActingUserId(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
  }
  return actingUserId ?? DEFAULT_USER_ID;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken(): string | null {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  }
  return authToken;
}

export { SESSION_KEY, TOKEN_KEY, DEFAULT_USER_ID };

export type Role = "producer" | "consumer" | "coordinator" | "verifier" | "admin";

export interface User {
  id: string;
  name: string;
  role: Role;
  walletAddress?: string | null;
}

export interface UsersResponse {
  users: User[];
}

export interface WalletNonce {
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface WalletAuthResult {
  token: string;
  user: User;
  created: boolean;
}

export interface UpdateUserRoleBody {
  role: Role;
  name?: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  chainEnabled: boolean;
  mlUrl: string;
  time: string;
}

export interface ChainStatus {
  enabled: boolean;
  connected: boolean;
  chainId?: number | null;
  blockNumber?: number | null;
  contracts?: { energyTrade?: string; greenRewardToken?: string } | null;
  deploymentFile?: string;
  error?: string;
}

export interface Meter {
  id: string;
  meterType: string;
  unit: string;
  sourceType: string;
  sourceStatus: string;
}

export interface Facility {
  id: string;
  name: string;
  type: string;
  installedCapacityKw: number;
  exportLimitKw: number;
  ownerId: string;
  meters: Meter[];
}

export interface FacilitiesResponse {
  facilities: Facility[];
}

export interface EnergyInterval {
  intervalStart: string;
  intervalEnd: string;
  generationKwh?: number | null;
  loadKwh?: number | null;
  importKwh?: number | null;
  exportKwh?: number | null;
  batteryChargeKwh?: number | null;
  batteryDischargeKwh?: number | null;
  balanceResidualKwh?: number | null;
  estimatedSurplusKwh?: number | null;
  offerableKwh?: number | null;
  reservedKwh?: number | null;
  bufferKwh?: number | null;
  claimStatus?: string | null;
  hasOpenOffer?: boolean;
}

export interface EnergyResponse {
  facilityId: string;
  from: string;
  to: string;
  assumptions: string[];
  intervals: EnergyInterval[];
}

export interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  invalid: number;
  errors: string[];
}

export interface SimulatorResult {
  days: number;
  seed: number;
  readingsWritten: number;
  anomaliesInjected: string[];
  window: { from: string; to: string };
}

export interface Certificate {
  externalId: string;
  registry: string;
  issuer: string;
  quantityMwh: number;
  status: string;
  ownerReference?: string | null;
  metadataHash?: string | null;
  issuedAt?: string | null;
}

export interface CertificatesResponse {
  certificates: Certificate[];
}

export interface CertificateCheck {
  externalId: string;
  status: string;
  usable: boolean;
  quantityMwh?: number | null;
  issues: string[];
  usedByClaimIds: string[];
}

export type ClaimStatus =
  | "PENDING"
  | "VERIFIED_FOR_PROTOTYPE"
  | "REJECTED_BY_RULE"
  | "REVIEW_REQUIRED";

export interface Claim {
  id: string;
  facilityId: string;
  intervalStart: string;
  intervalEnd: string;
  claimedKwh: number;
  certificateExternalId?: string | null;
  status: ClaimStatus | string;
  createdAt?: string;
}

export type RuleSeverity = "hard" | "soft";

export interface RuleResult {
  code: string;
  severity: RuleSeverity | string;
  message: string;
}

export type ReviewStatus = "OPEN" | "APPROVED_BY_REVIEWER" | "REJECTED_BY_REVIEWER";

export interface CaseClaim {
  id: string;
  facilityId: string;
  intervalStart: string;
  intervalEnd: string;
  claimedKwh: number;
  status: ClaimStatus | string;
}

export interface VerificationCase {
  id: string;
  claim: CaseClaim;
  ruleResults: RuleResult[];
  anomalyScore?: number | null;
  anomalyFlags: string[];
  mlStatus?: string | null;
  modelVersion?: string | null;
  reviewStatus: ReviewStatus | string;
  createdAt?: string;
}

export interface CasesResponse {
  cases: VerificationCase[];
}

export interface VerifyResponse {
  claim: Claim;
  case: VerificationCase;
}

export type OfferStatus =
  | "OPEN"
  | "PARTIALLY_RESERVED"
  | "FILLED"
  | "WITHDRAWN"
  | "BLOCKED";

export interface Offer {
  id: string;
  facilityId: string;
  intervalStart: string;
  intervalEnd: string;
  quantityKwh: number;
  reservedKwh: number;
  pricePerKwh: number;
  status: OfferStatus | string;
  remainingKwh: number;
  claimId: string;
}

export interface OffersResponse {
  offers: Offer[];
}

export interface EnergyRequest {
  id: string;
  buyerId?: string;
  quantityKwh: number;
  allocatedKwh: number;
  remainingKwh: number;
  maxPricePerKwh: number;
  intervalStart: string;
  intervalEnd: string;
  status: OfferStatus | string;
}

export interface RequestsResponse {
  requests: EnergyRequest[];
}

export interface Match {
  offerId: string;
  requestId: string;
  intervalStart: string;
  intervalEnd: string;
  agreedKwh: number;
  pricePerKwh: number;
  reason: string;
}

export interface MatchPreviewResult {
  matches: Match[];
  unmatchedOffers: { offerId: string; reason: string }[];
  unmatchedRequests: { requestId: string; reason: string }[];
}

export interface CreatedTrade {
  tradeId: string;
  offerId: string;
  requestId: string;
  agreedKwh: number;
  pricePerKwh: number;
  state: string;
}

export interface MatchRunResult {
  createdTrades: CreatedTrade[];
  skipped: { offerId?: string; requestId?: string; reason?: string }[];
}

export type TradeState =
  | "MATCHED"
  | "EVIDENCE_SUBMITTED"
  | "SETTLED"
  | "DISPUTED"
  | "REVIEW_REQUIRED";

export interface Trade {
  id: string;
  offerId: string;
  requestId: string;
  agreedKwh: number;
  pricePerKwh: number;
  state: TradeState | string;
  evidenceHash?: string | null;
  chainTradeId?: number | null;
  chainTxHash?: string | null;
  settlementTxHash?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TradesResponse {
  trades: Trade[];
}

export interface EvidenceBundle {
  id?: string;
  hash?: string | null;
  producerExportKwh?: number | null;
  consumerImportKwh?: number | null;
  notes?: string | null;
  recordReferences?: string[];
  discrepancyPct?: number | null;
  withinTolerance?: boolean | null;
  attestationStatus?: string | null;
  status?: string | null;
  createdAt?: string;
}

export interface RewardEvent {
  recipient?: string | null;
  amount: string;
  reason?: string | null;
  txHash?: string | null;
  createdAt?: string;
}

export interface TradeDetail extends Trade {
  evidenceBundles?: EvidenceBundle[];
  rewardEvents?: RewardEvent[];
  evidence?: EvidenceBundle[];
  rewards?: RewardEvent[];
}

export interface EvidenceResult {
  trade: Trade;
  discrepancyPct?: number | null;
  withinTolerance?: boolean | null;
  chainTxHash?: string | null;
  note?: string | null;
}

export interface AttestResult {
  trade: Trade;
  chainDisabled?: boolean;
  note?: string | null;
  settlementTxHash?: string | null;
}

export interface Receipt {
  trade: {
    id: string;
    state: string;
    agreedKwh: number;
    pricePerKwh: number;
    estimatedValue: number;
  };
  offer: { id: string; facilityId: string };
  request: { id: string; buyerId: string };
  evidence?: {
    hash?: string | null;
    discrepancyPct?: number | null;
    withinTolerance?: boolean | null;
    recordReferences?: string[];
    attestationStatus?: string | null;
  } | null;
  chain?: {
    enabled: boolean;
    tradeId?: number | null;
    txHash?: string | null;
    settlementTxHash?: string | null;
    stateOnChain?: string | null;
  } | null;
  rewards?: RewardEvent[];
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  cacheMs?: number;
  bust?: boolean;
  auth?: boolean;
}

const cache = new Map<string, { expires: number; value: unknown }>();
const TTL_MS = 2000;

export function bustCache(): void {
  cache.clear();
}

function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && e.message === "Failed to fetch");
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isOfflineError(e: unknown): boolean {
  if (e instanceof ApiError) return e.code === "NETWORK";
  return isNetworkError(e);
}

async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const bust = options.bust ?? false;
  const token = getAuthToken();
  const key = `${method}:${path}:${options.auth === false ? "" : token ?? getActingUserId()}`;
  if (method === "GET" && !bust) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
  }

  const headers: Record<string, string> = { ...options.headers };
  if (options.auth !== false) {
    if (token) headers["Authorization"] = `Bearer ${token}`;
    else headers["x-user-id"] = getActingUserId();
  }
  let bodyInit: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData || options.body instanceof Blob || typeof options.body === "string") {
      bodyInit = options.body as BodyInit;
    } else {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(options.body);
    }
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { method, headers, body: bodyInit, cache: "no-store" });
  } catch (e) {
    throw new ApiError("NETWORK", isNetworkError(e) ? `Cannot reach API at ${BASE_URL}` : errorMessage(e));
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = `Request failed with status ${res.status}`;
    const parsed: unknown = await res.json().catch(() => null);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const err = (parsed as { error: { code?: string; message?: string } }).error;
      code = err.code ?? code;
      message = err.message ?? message;
    }
    throw new ApiError(code, message, res.status);
  }

  const data = (await res.json()) as T;
  if (method === "GET") cache.set(key, { expires: Date.now() + TTL_MS, value: data });
  return data;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health", { auth: false });
}

export function getUsers(): Promise<UsersResponse> {
  return apiFetch<UsersResponse>("/api/users");
}

export function getWalletNonce(address: string): Promise<WalletNonce> {
  return apiFetch<WalletNonce>(`/api/auth/nonce?address=${encodeURIComponent(address)}`, {
    auth: false,
  });
}

export function verifyWalletSignature(body: {
  address: string;
  signature: string;
  role?: "producer" | "consumer";
  name?: string;
}): Promise<WalletAuthResult> {
  return apiFetch<WalletAuthResult>("/api/auth/verify", {
    method: "POST",
    body,
    auth: false,
  });
}

export function getMe(): Promise<{ user: User }> {
  return apiFetch<{ user: User }>("/api/auth/me");
}

export function getChainStatus(): Promise<ChainStatus> {
  return apiFetch<ChainStatus>("/api/chain/status", { auth: false });
}

export function getFacilities(): Promise<FacilitiesResponse> {
  return apiFetch<FacilitiesResponse>("/api/facilities", { auth: false });
}

export function getFacilityEnergy(
  id: string,
  from?: string,
  to?: string,
  bust?: boolean,
): Promise<EnergyResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return apiFetch<EnergyResponse>(
    `/api/facilities/${encodeURIComponent(id)}/energy${qs ? `?${qs}` : ""}`,
    { auth: false, bust },
  );
}

export function importReadingsCsv(csv: string): Promise<ImportResult> {
  return apiFetch<ImportResult>("/api/readings/import", {
    method: "POST",
    body: csv,
    headers: { "Content-Type": "text/csv" },
  });
}

export interface SimulatorBody {
  days: number;
  seed?: number;
  injectAnomalies?: boolean;
}

export function runSimulator(body: SimulatorBody): Promise<SimulatorResult> {
  return apiFetch<SimulatorResult>("/api/simulator/run", { method: "POST", body });
}

export function getCertificates(): Promise<CertificatesResponse> {
  return apiFetch<CertificatesResponse>("/api/certificates", { auth: false });
}

export function checkCertificate(externalId: string): Promise<CertificateCheck> {
  return apiFetch<CertificateCheck>(
    `/api/certificates/${encodeURIComponent(externalId)}/check`,
    { auth: false, bust: true },
  );
}

export interface CreateClaimBody {
  facilityId: string;
  intervalStart: string;
  intervalEnd: string;
  claimedKwh: number;
  certificateExternalId: string;
}

export function createClaim(body: CreateClaimBody): Promise<Claim> {
  return apiFetch<Claim | { claim: Claim }>("/api/claims", { method: "POST", body }).then(
    unwrapClaim,
  );
}

function unwrapClaim(data: Claim | { claim: Claim }): Claim {
  return "claim" in data ? data.claim : data;
}

export function verifyClaim(id: string): Promise<VerifyResponse> {
  return apiFetch<VerifyResponse>(`/api/claims/${encodeURIComponent(id)}/verify`, {
    method: "POST",
    body: {},
  });
}

export function getVerificationCases(status?: string): Promise<CasesResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<CasesResponse>(`/api/verification-cases${qs}`);
}

export interface DecisionBody {
  decision: "approve" | "reject";
  note?: string;
}

export function decideCase(id: string, body: DecisionBody): Promise<VerificationCase> {
  return apiFetch<VerificationCase | { case: VerificationCase }>(
    `/api/verification-cases/${encodeURIComponent(id)}/decision`,
    { method: "POST", body },
  ).then((data) => ("case" in data ? data.case : data));
}

export interface CreateOfferBody {
  claimId: string;
  quantityKwh: number;
  pricePerKwh: number;
}

export function createOffer(body: CreateOfferBody): Promise<Offer> {
  return apiFetch<Offer | { offer: Offer }>("/api/offers", { method: "POST", body }).then(
    (data) => ("offer" in data ? data.offer : data),
  );
}

export function getOffers(status?: string, bust?: boolean): Promise<OffersResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<OffersResponse>(`/api/offers${qs}`, { auth: false, bust });
}

export function withdrawOffer(id: string): Promise<Offer> {
  return apiFetch<Offer>(`/api/offers/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

export interface CreateRequestBody {
  quantityKwh: number;
  maxPricePerKwh: number;
  intervalStart: string;
  intervalEnd: string;
}

export function createRequest(body: CreateRequestBody): Promise<EnergyRequest> {
  return apiFetch<EnergyRequest | { request: EnergyRequest }>("/api/requests", {
    method: "POST",
    body,
  }).then((data) => ("request" in data ? data.request : data));
}

export function getRequests(status?: string, bust?: boolean): Promise<RequestsResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<RequestsResponse>(`/api/requests${qs}`, { auth: false, bust });
}

export function matchesPreview(body?: { intervalStart?: string; intervalEnd?: string }): Promise<MatchPreviewResult> {
  return apiFetch<MatchPreviewResult>("/api/matches/preview", { method: "POST", body: body ?? {} });
}

export function matchesRun(body?: { intervalStart?: string; intervalEnd?: string }): Promise<MatchRunResult> {
  return apiFetch<MatchRunResult>("/api/matches/run", { method: "POST", body: body ?? {} });
}

export function getTrades(bust?: boolean): Promise<TradesResponse> {
  return apiFetch<TradesResponse>("/api/trades", { auth: false, bust });
}

export function getTrade(id: string): Promise<TradeDetail> {
  return apiFetch<TradeDetail>(`/api/trades/${encodeURIComponent(id)}`, { auth: false });
}

export interface EvidenceBody {
  producerExportKwh: number;
  consumerImportKwh: number;
  notes?: string;
  recordReferences: string[];
}

export function postEvidence(id: string, body: EvidenceBody): Promise<EvidenceResult> {
  return apiFetch<Record<string, unknown>>(`/api/trades/${encodeURIComponent(id)}/evidence`, {
    method: "POST",
    body,
  }).then(normalizeEvidence);
}

function tradeFrom(data: Record<string, unknown>): Trade | null {
  if (data.trade && typeof data.trade === "object") return data.trade as Trade;
  if (typeof data.id === "string" && typeof data.state === "string") return data as unknown as Trade;
  return null;
}

function normalizeEvidence(data: Record<string, unknown>): EvidenceResult {
  const trade = tradeFrom(data);
  if (!trade) throw new ApiError("BAD_REQUEST", "Unexpected evidence response shape");
  return {
    trade,
    discrepancyPct: typeof data.discrepancyPct === "number" ? data.discrepancyPct : undefined,
    withinTolerance: typeof data.withinTolerance === "boolean" ? data.withinTolerance : undefined,
    chainTxHash: typeof data.chainTxHash === "string" ? data.chainTxHash : null,
    note: typeof data.note === "string" ? data.note : null,
  };
}

export function attestTrade(id: string): Promise<AttestResult> {
  return apiFetch<Record<string, unknown>>(`/api/trades/${encodeURIComponent(id)}/attest`, {
    method: "POST",
    body: {},
  }).then((data) => {
    const trade = tradeFrom(data);
    if (!trade) throw new ApiError("BAD_REQUEST", "Unexpected attest response shape");
    return {
      trade,
      chainDisabled: data.chainDisabled === true,
      note: typeof data.note === "string" ? data.note : null,
      settlementTxHash: typeof data.settlementTxHash === "string" ? data.settlementTxHash : null,
    };
  });
}

export function disputeTrade(id: string, reason: string): Promise<Trade> {
  return apiFetch<Trade | { trade: Trade }>(`/api/trades/${encodeURIComponent(id)}/dispute`, {
    method: "POST",
    body: { reason },
  }).then((data) => ("trade" in data ? data.trade : data));
}

export function getReceipt(id: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/api/trades/${encodeURIComponent(id)}/receipt`, { auth: false, bust: true });
}

export function updateUserRole(id: string, body: UpdateUserRoleBody): Promise<User> {
  return apiFetch<{ user: User }>(`/api/users/${encodeURIComponent(id)}/role`, {
    method: "PATCH",
    body,
  }).then((d) => d.user);
}

export interface CreateFacilityBody {
  id?: string;
  name: string;
  type: "producer" | "consumer" | "storage" | "mixed";
  installedCapacityKw: number;
  exportLimitKw: number;
}

export function createFacility(body: CreateFacilityBody): Promise<{ facility: { id: string; name: string } }> {
  return apiFetch("/api/facilities", { method: "POST", body });
}

export interface CreateMeterBody {
  id?: string;
  facilityId: string;
  meterType:
    | "generation"
    | "load"
    | "grid_import"
    | "grid_export"
    | "battery_charge"
    | "battery_discharge";
}

export function createMeter(body: CreateMeterBody): Promise<{ meter: { id: string } }> {
  return apiFetch("/api/meters", { method: "POST", body });
}

export interface CreateCertificateBody {
  externalId: string;
  issuer?: string;
  quantityMwh: number;
  status?: "ACTIVE" | "TRANSFERRED" | "RETIRED" | "INVALID" | "UNKNOWN";
}

export function createCertificate(
  body: CreateCertificateBody,
): Promise<{ certificate: { externalId: string } }> {
  return apiFetch("/api/certificates", { method: "POST", body });
}
