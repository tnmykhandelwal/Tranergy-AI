#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-anvil}"
RPC_URL="${RPC_URL:-${ANVIL_RPC_URL:-http://127.0.0.1:8545}}"
DEPLOYER_KEY="${DEPLOYER_KEY:-${OPERATOR_PRIVATE_KEY:-}}"

if [ "$DEPLOYMENT_NAME" = "anvil" ]; then
  # Anvil account #0 (deployer) and #1 (extra attestor). Public development
  # keys — never use them on a real network.
  DEPLOYER_KEY="${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
  ATTESTOR_ADDRESS="${ATTESTOR_ADDRESS:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
else
  if [ -z "$DEPLOYER_KEY" ]; then
    echo "DEPLOYER_KEY (or OPERATOR_PRIVATE_KEY) must be set for network '$DEPLOYMENT_NAME'" >&2
    exit 1
  fi
  if [ -z "${ATTESTOR_ADDRESS:-}" ]; then
    echo "Warning: ATTESTOR_ADDRESS is not set; the deployer will be the only attestor." >&2
  fi
  ATTESTOR_ADDRESS="${ATTESTOR_ADDRESS:-0x0000000000000000000000000000000000000000}"
fi

echo "Deploying to $RPC_URL as '$DEPLOYMENT_NAME' (extra attestor: $ATTESTOR_ADDRESS)"
DEPLOYMENT_NAME="$DEPLOYMENT_NAME" ATTESTOR_ADDRESS="$ATTESTOR_ADDRESS" forge script \
  script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --private-key "$DEPLOYER_KEY"

echo
echo "Deployed. contracts/deployments/${DEPLOYMENT_NAME}.json:"
cat "deployments/${DEPLOYMENT_NAME}.json"
echo
