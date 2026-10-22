#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

ATTESTOR_ADDRESS="${ATTESTOR_ADDRESS:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
# Anvil account #0 — public development key, never use on a real network
DEPLOYER_KEY="${OPERATOR_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

echo "Deploying to $RPC_URL (extra attestor: $ATTESTOR_ADDRESS)"
ATTESTOR_ADDRESS="$ATTESTOR_ADDRESS" forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --private-key "$DEPLOYER_KEY"

echo "Deployed. contracts/deployments/anvil.json:"
cat deployments/anvil.json
echo
