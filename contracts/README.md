# Tranergy AI — Contracts

Foundry package for the Tranergy AI project. Solidity 0.8.24, OpenZeppelin Contracts v5.0.2, forge-std v1.9.7.

## Build / test / deploy

```bash
cd contracts
forge build
forge test -vv

anvil                                   # terminal 1 (chain id 31337)
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Optional: `ATTESTOR_ADDRESS=0x...` grants `ATTESTOR_ROLE` to a second address at deploy time. The script writes `deployments/anvil.json` (`network`, `chainId`, `energyTrade`, `greenRewardToken`, `deployer`, `deployedAt`) for the backend (`CONTRACTS_DEPLOYMENT_FILE`).

## Contracts

- `GreenRewardToken` (TRGY, 18 decimals): reward ERC20. `MINTER_ROLE` can call `mint(to, amount)`. Admin = deployer.
- `EnergyTrade`: trade lifecycle. Backend (`OPERATOR_ROLE`) calls `createTrade` / `submitEvidence`; verifier (`ATTESTOR_ROLE`) calls `attestAndSettle` / `dispute`. Settlement is final and mints `quantityKwh * 1e18` TRGY to the producer. Disputes are allowed from `Matched` / `EvidenceSubmitted` only.

## Role model

| Role | Holder | Can call |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | deployer (Anvil #0) | grant/revoke roles |
| `MINTER_ROLE` (token) | `EnergyTrade` contract only | `mint` |
| `OPERATOR_ROLE` | backend signer (Anvil #0, `OPERATOR_PRIVATE_KEY`) | `createTrade`, `submitEvidence` |
| `ATTESTOR_ROLE` | verifier signer (Anvil #1, `ATTESTOR_PRIVATE_KEY`) + optional env address | `attestAndSettle`, `dispute` |

## On-chain vs off-chain

On-chain: trade state machine, evidence hash, attestation, dispute flag/reason, reward minting. Off-chain (backend): matching, meter evidence collection, discrepancy calculation (`DELIVERY_TOLERANCE_PCT`), receipts, ML anomaly scoring, user/facility/certificate data.

## Disclaimer

Simulated meters, mock certificate registry, local Anvil chain. Not an official electricity settlement system or certificate registry. Do not use in production.
