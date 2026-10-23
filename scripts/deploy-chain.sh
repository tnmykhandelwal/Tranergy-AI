#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-anvil}"
RPC_URL="${RPC_URL:-${ANVIL_RPC_URL:-http://127.0.0.1:8545}}"
DEPLOYER_KEY="${DEPLOYER_KEY:-${OPERATOR_PRIVATE_KEY:-}}"
DEPLOYMENT_FILE="deployments/${DEPLOYMENT_NAME}.json"

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

FORGE_ARGS=(
  script
  script/Deploy.s.sol:Deploy
  --rpc-url "$RPC_URL"
  --broadcast
  --private-key "$DEPLOYER_KEY"
)

# Public RPCs often reject several in-flight transactions from the same account.
# Waiting for each receipt also makes a partially failed deployment obvious.
#
# Sepolia activated Glamsterdam (EIP-8037) on 2026-10-06. State creation is now
# much more expensive (code deposit 200 -> 1,530 gas/byte, new storage slot
# 20,000 -> 97,920 gas), but Foundry's local EVM still estimates with the old
# schedule. Compensate with a large multiplier until Foundry implements it.
if [ "$DEPLOYMENT_NAME" != "anvil" ]; then
  GAS_ESTIMATE_MULTIPLIER="${GAS_ESTIMATE_MULTIPLIER:-1200}"
  FORGE_ARGS+=(--slow --gas-estimate-multiplier "$GAS_ESTIMATE_MULTIPLIER")
fi

cleanup() {
  echo "Deployment failed; removing $DEPLOYMENT_FILE so it cannot be used by mistake." >&2
  rm -f "$DEPLOYMENT_FILE"
  exit 1
}

echo "Deploying to $RPC_URL as '$DEPLOYMENT_NAME' (extra attestor: $ATTESTOR_ADDRESS)"
if ! DEPLOYMENT_NAME="$DEPLOYMENT_NAME" ATTESTOR_ADDRESS="$ATTESTOR_ADDRESS" \
  forge "${FORGE_ARGS[@]}"; then
  cleanup
fi

if [ ! -f "$DEPLOYMENT_FILE" ]; then
  echo "ERROR: $DEPLOYMENT_FILE was not written." >&2
  exit 1
fi

read -r TOKEN TRADE SETTLEMENT DEPLOYER DEPLOYMENT_CHAIN_ID < <(
  node -e '
    const fs = require("fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(
      [d.greenRewardToken, d.energyTrade, d.settlementToken, d.deployer, d.chainId].join(" ") + "\n",
    );
  ' "$DEPLOYMENT_FILE"
)

if [ -z "${SETTLEMENT:-}" ] || [ "$SETTLEMENT" = "undefined" ]; then
  echo "ERROR: deployment file is missing the settlement token address. Redeploy with the current script." >&2
  cleanup
fi

ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [ "$ACTUAL_CHAIN_ID" != "$DEPLOYMENT_CHAIN_ID" ]; then
  echo "ERROR: RPC chain id $ACTUAL_CHAIN_ID does not match deployment chain id $DEPLOYMENT_CHAIN_ID." >&2
  cleanup
fi

for entry in "GreenRewardToken:$TOKEN" "MockSettlementToken:$SETTLEMENT" "EnergyTrade:$TRADE"; do
  label="${entry%%:*}"
  address="${entry#*:}"
  code="$(cast code "$address" --rpc-url "$RPC_URL")"
  if [ -z "$code" ] || [ "$code" = "0x" ]; then
    echo "ERROR: no contract code at $label $address (transaction likely failed)." >&2
    cleanup
  fi
done

has_role() {
  local contract="$1" role="$2" account="$3" label="$4"
  local result
  result="$(cast call "$contract" "hasRole(bytes32,address)(bool)" "$role" "$account" --rpc-url "$RPC_URL")"
  if [ "$result" != "true" ]; then
    echo "ERROR: $label is not granted to $account on $contract." >&2
    cleanup
  fi
}

OPERATOR_ROLE="0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929"
ATTESTOR_ROLE="0xa7e0cd0f2772b23ee4c329892293a6bd99d48c306b094d6d008c9a8bb8b731e4"
MINTER_ROLE="0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6"

has_role "$TRADE" "$OPERATOR_ROLE" "$DEPLOYER" "OPERATOR_ROLE"
has_role "$TRADE" "$ATTESTOR_ROLE" "$DEPLOYER" "ATTESTOR_ROLE"
if [ "$ATTESTOR_ADDRESS" != "0x0000000000000000000000000000000000000000" ]; then
  has_role "$TRADE" "$ATTESTOR_ROLE" "$ATTESTOR_ADDRESS" "ATTESTOR_ROLE"
fi
has_role "$TOKEN" "$MINTER_ROLE" "$TRADE" "MINTER_ROLE"

SETTLEMENT_DECIMALS="$(cast call "$SETTLEMENT" "decimals()(uint8)" --rpc-url "$RPC_URL")"
if [ "$SETTLEMENT_DECIMALS" != "6" ]; then
  echo "ERROR: expected 6 settlement-token decimals but found $SETTLEMENT_DECIMALS." >&2
  cleanup
fi

echo
echo "Deployed and verified. contracts/deployments/${DEPLOYMENT_NAME}.json:"
cat "$DEPLOYMENT_FILE"
echo
