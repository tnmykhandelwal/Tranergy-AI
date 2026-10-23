import { BrowserProvider, type Signer } from "ethers";

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function hasWallet(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

function requireProvider(): EthereumProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet detected. Install MetaMask (or another injected wallet) and reload.");
  }
  return window.ethereum;
}

export async function connectWallet(): Promise<string> {
  const provider = requireProvider();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no account.");
  return address;
}

export async function currentWallet(): Promise<string | null> {
  if (!hasWallet()) return null;
  try {
    const provider = requireProvider();
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function signWalletMessage(message: string): Promise<string> {
  const provider = new BrowserProvider(requireProvider());
  const signer = await provider.getSigner();
  return signer.signMessage(message);
}

export async function getWalletSigner(): Promise<Signer> {
  const provider = new BrowserProvider(requireProvider());
  return provider.getSigner();
}

export function shortAddress(address?: string | null): string {
  if (!address) return "—";
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
