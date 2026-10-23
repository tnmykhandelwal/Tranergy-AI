import { Contract, keccak256, toUtf8Bytes } from "ethers";
import type { EscrowDepositKind } from "@/lib/api";
import { getWalletSigner } from "@/lib/wallet";

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const ESCROW_ABI = [
  "function depositConsumerPayment(uint256 tradeId)",
  "function depositConsumerCollateral(uint256 tradeId)",
  "function depositProducerCollateral(uint256 tradeId)",
  "function raiseDispute(uint256 tradeId, bytes32 reason)",
  "function cancelExpiredEscrow(uint256 tradeId)",
];

const DEPOSIT_METHOD: Record<EscrowDepositKind, string> = {
  consumer_payment: "depositConsumerPayment",
  consumer_collateral: "depositConsumerCollateral",
  producer_collateral: "depositProducerCollateral",
};

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0]!;
}

export interface EscrowChainAddresses {
  energyTrade?: string | null;
  settlementToken?: string | null;
}

function requireAddress(value: string | null | undefined, label: string): string {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} address is unavailable — is the settlement chain deployed and configured?`);
  }
  return value;
}

async function waitFor(hash: string): Promise<void> {
  const signer = await getWalletSigner();
  const receipt = await signer.provider!.waitForTransaction(hash, 1, 120_000);
  if (!receipt) throw new Error(`transaction ${hash} was not confirmed`);
  if (receipt.status !== 1) throw new Error(`transaction ${hash} reverted`);
}

export async function getSettlementBalance(
  tokenAddress: string,
  owner: string,
  spender: string,
): Promise<{ symbol: string; decimals: number; balance: bigint; allowance: bigint }> {
  const signer = await getWalletSigner();
  const token = new Contract(tokenAddress, ERC20_ABI, signer);
  const [symbol, decimals, balance, allowance] = await Promise.all([
    token.symbol() as Promise<string>,
    token.decimals() as Promise<bigint>,
    token.balanceOf(owner) as Promise<bigint>,
    token.allowance(owner, spender) as Promise<bigint>,
  ]);
  return { symbol, decimals: Number(decimals), balance, allowance };
}

export async function depositEscrow(
  addresses: EscrowChainAddresses,
  chainTradeId: number,
  kind: EscrowDepositKind,
  amountUnits: string,
): Promise<string> {
  const tokenAddress = requireAddress(addresses.settlementToken, "settlement token");
  const tradeAddress = requireAddress(addresses.energyTrade, "escrow contract");
  const signer = await getWalletSigner();
  const owner = await signer.getAddress();
  const amount = BigInt(amountUnits);
  if (amount <= 0n) throw new Error("deposit amount must be positive");

  const token = new Contract(tokenAddress, ERC20_ABI, signer);
  const [balance, allowance] = await Promise.all([
    token.balanceOf(owner) as Promise<bigint>,
    token.allowance(owner, tradeAddress) as Promise<bigint>,
  ]);
  if (balance < amount) {
    throw new Error(
      `insufficient settlement-token balance (need ${amount.toString()} base units, have ${balance.toString()}). Use the faucet on the Chain page.`,
    );
  }
  if (allowance < amount) {
    const approval = await token.approve(tradeAddress, amount);
    await waitFor(approval.hash as string);
  }

  const escrow = new Contract(tradeAddress, ESCROW_ABI, signer);
  const method = DEPOSIT_METHOD[kind];
  const tx = await escrow[method](chainTradeId);
  await waitFor(tx.hash as string);
  return tx.hash as string;
}

export async function raiseEscrowDisputeOnChain(
  addresses: EscrowChainAddresses,
  chainTradeId: number,
  reason: string,
): Promise<string> {
  const tradeAddress = requireAddress(addresses.energyTrade, "escrow contract");
  const signer = await getWalletSigner();
  const escrow = new Contract(tradeAddress, ESCROW_ABI, signer);
  try {
    const tx = await escrow.raiseDispute(chainTradeId, keccak256(toUtf8Bytes(reason)));
    await waitFor(tx.hash as string);
    return tx.hash as string;
  } catch (err) {
    throw new Error(`on-chain dispute failed: ${firstLine(err)}`);
  }
}

export async function cancelEscrowOnChain(
  addresses: EscrowChainAddresses,
  chainTradeId: number,
): Promise<string> {
  const tradeAddress = requireAddress(addresses.energyTrade, "escrow contract");
  const signer = await getWalletSigner();
  const escrow = new Contract(tradeAddress, ESCROW_ABI, signer);
  try {
    const tx = await escrow.cancelExpiredEscrow(chainTradeId);
    await waitFor(tx.hash as string);
    return tx.hash as string;
  } catch (err) {
    throw new Error(`escrow cancellation failed: ${firstLine(err)}`);
  }
}

export async function mintTestSettlementToken(tokenAddress: string): Promise<string> {
  const address = requireAddress(tokenAddress, "settlement token");
  const signer = await getWalletSigner();
  const token = new Contract(address, ["function faucet()"], signer);
  const tx = await token.faucet();
  await waitFor(tx.hash as string);
  return tx.hash as string;
}
