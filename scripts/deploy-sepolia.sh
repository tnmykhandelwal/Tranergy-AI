#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEFAULT_RPC="https://ethereum-sepolia-rpc.publicnode.com"

if [ -z "${RPC_URL:-}" ]; then
  read -rp "Sepolia RPC URL [$DEFAULT_RPC]: " RPC_URL
fi
RPC_URL="${RPC_URL:-$DEFAULT_RPC}"

if [ -z "${DEPLOYER_KEY:-}" ]; then
  read -rsp "Deployer private key (0x...): " DEPLOYER_KEY
  echo
fi
if [ -z "${DEPLOYER_KEY:-}" ]; then
  echo "A funded deployer private key is required." >&2
  exit 1
fi

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_KEY")"
if [ -z "${ATTESTOR_ADDRESS:-}" ]; then
  read -rp "Attestor address [$DEPLOYER_ADDRESS]: " ATTESTOR_ADDRESS
fi
ATTESTOR_ADDRESS="${ATTESTOR_ADDRESS:-$DEPLOYER_ADDRESS}"

DEPLOYER_CODE="$(cast code "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x")"
if [ "$DEPLOYER_CODE" != "0x" ]; then
  echo "ERROR: $DEPLOYER_ADDRESS is a delegated/smart account (EIP-7702)." >&2
  echo "Contract creation fails from delegated accounts on many RPCs." >&2
  echo "Generate a fresh plain EOA with: cast wallet new" >&2
  echo "Fund its address, then rerun this script with that private key." >&2
  exit 1
fi

DEPLOYER_BALANCE="$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "0")"
if [ "$DEPLOYER_BALANCE" = "0" ]; then
  echo "WARNING: $DEPLOYER_ADDRESS has 0 Sepolia ETH; the deployment will fail." >&2
fi

echo
echo "Network:  Sepolia"
echo "RPC:      $RPC_URL"
echo "Deployer: $DEPLOYER_ADDRESS"
echo "Balance:  $DEPLOYER_BALANCE wei"
echo "Attestor: $ATTESTOR_ADDRESS"
read -rp "Deploy now? [y/N] " confirm
case "$confirm" in
  y | Y | yes | YES) ;;
  *) echo "Cancelled."; exit 0 ;;
esac

DEPLOYMENT_NAME=sepolia \
RPC_URL="$RPC_URL" \
DEPLOYER_KEY="$DEPLOYER_KEY" \
ATTESTOR_ADDRESS="$ATTESTOR_ADDRESS" \
bash scripts/deploy-chain.sh
