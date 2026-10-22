import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "ethers";
import { config } from "./config";

export interface AuthTokenPayload {
  sub: string;
  wallet: string;
  role: string;
  iat: number;
  exp: number;
}

interface NonceEntry {
  nonce: string;
  message: string;
  expiresAt: number;
}

const NONCE_TTL_MS = 5 * 60 * 1000;
const nonces = new Map<string, NonceEntry>();

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", config.AUTH_SECRET).update(payload).digest("base64url");
}

export function isWalletAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function normalizeWallet(value: string): string {
  return value.trim().toLowerCase();
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function issueWalletNonce(address: string): { nonce: string; message: string; expiresAt: string } {
  const wallet = normalizeWallet(address);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + NONCE_TTL_MS;
  const message = [
    "Tranergy AI wants you to sign in with your wallet.",
    "",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
    "",
    "This signature proves you control this wallet. It does not trigger a transaction or cost gas.",
  ].join("\n");
  nonces.set(wallet, { nonce, message, expiresAt });
  return { nonce, message, expiresAt: new Date(expiresAt).toISOString() };
}

function consumeNonce(wallet: string): NonceEntry | null {
  const entry = nonces.get(wallet);
  nonces.delete(wallet);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}

export function verifyWalletSignature(address: string, signature: string): boolean {
  const wallet = normalizeWallet(address);
  const entry = consumeNonce(wallet);
  if (!entry) return false;
  try {
    const recovered = verifyMessage(entry.message, signature);
    return normalizeWallet(recovered) === wallet;
  } catch {
    return false;
  }
}

export function issueAuthToken(user: { id: string; walletAddress: string | null; role: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    sub: user.id,
    wallet: normalizeWallet(user.walletAddress ?? ""),
    role: user.role,
    iat: now,
    exp: now + Math.floor(config.AUTH_TOKEN_TTL_HOURS * 3600),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function readAuthToken(token: string): AuthTokenPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as AuthTokenPayload;
    if (!payload.sub || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function defaultNameForWallet(address: string): string {
  return `Wallet ${shortAddress(normalizeWallet(address))}`;
}
