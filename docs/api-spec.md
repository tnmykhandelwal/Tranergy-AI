# Tranergy AI — Shared API Specification (v1)

This is the **authoritative contract** between the frontend, backend API, and ML service.
All timestamps are **ISO-8601 UTC strings**. All energies are **kWh** (floats). IDs are UUID strings unless noted.

Default ports: web `3000`, API `4000`, ML `8000`, Anvil `8545`.

## Auth model

Wallet sign-in with an HMAC bearer token. The browser proves wallet ownership by signing an
EIP-191 message for a short-lived nonce:

1. `GET /api/auth/nonce?address=0x…` → `{ address, nonce, message, expiresAt }`
2. `POST /api/auth/verify` with `{ address, signature, role?, name? }` → `{ token, user, created }`
3. Send `Authorization: Bearer <token>` on protected calls (`GET /api/auth/me` returns the current user).

The **first wallet** to register becomes `admin`; wallets listed in `ADMIN_WALLETS` also become
admin. Later wallets self-register as `producer` or `consumer`; an admin changes roles via
`PATCH /api/users/:id/role`. Endpoints marked **public** work without a token.

Local tests/scripts may still use `x-user-id: <userId>`; this is disabled when
`NODE_ENV=production` unless `ALLOW_HEADER_AUTH=true`.

Role rules:
- Claim review decisions, trade attestation, trade settle: `verifier` or `admin` only.
- Create offer: `producer` or `admin`. Create request: `consumer` or `admin`.
- Run matching: `verifier` or `admin` (`coordinator` is still accepted by the API for legacy tests).
- Import readings / generate meter data: any authenticated user.

## Common error shape

```json
{ "error": { "code": "FORBIDDEN", "message": "verifier role required" } }
```

Codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `CHAIN_DISABLED`, `CHAIN_ERROR`, `ML_UNAVAILABLE`.

---

## 1. System

### `GET /api/health` (public)
```json
{ "ok": true, "service": "tranergy-api", "chainEnabled": true, "mlUrl": "http://127.0.0.1:8000", "time": "2026-10-18T12:00:00Z" }
```

### `GET /api/users` (auth)
```json
{ "users": [{ "id": "wallet-1a2b3c4d5e", "name": "Ada Generator", "role": "producer", "walletAddress": "0x..." }] }
```

### `PATCH /api/users/:id/role` (admin)
Body `{ "role": "verifier", "name": "Optional new name" }` → `200` with the updated user. Use this to promote trusted wallets; there is no password-based user creation.

### `GET /api/auth/nonce?address=0x…` (public)
Returns a 5-minute single-use nonce and the exact message to sign.

### `POST /api/auth/verify` (public)
Body `{ "address": "0x…", "signature": "0x…", "role": "producer|consumer", "name": "…" }` → `200/201` with `{ token, user, created }`. The first wallet (or an `ADMIN_WALLETS` entry) becomes `admin`.

### `GET /api/auth/me` (auth)
Returns the user behind the bearer token.

### `GET /api/chain/status` (public)
```json
{
  "enabled": true,
  "connected": true,
  "chainId": 31337,
  "blockNumber": 12,
  "contracts": { "energyTrade": "0x...", "greenRewardToken": "0x..." },
  "deploymentFile": "contracts/deployments/anvil.json"
}
```
If not enabled: `{ "enabled": false, "connected": false, ... }`. If enabled but RPC down: `connected:false` + `error` message.

---

## 2. Facilities, meters, readings

### `GET /api/facilities` (public)
```json
{ "facilities": [{ "id": "fac-solar-1", "name": "Solar Site 01", "type": "producer", "installedCapacityKw": 150, "exportLimitKw": 120, "ownerId": "user-alice", "meters": [{ "id": "m-solar-gen", "meterType": "generation", "unit": "kWh", "sourceType": "simulated", "sourceStatus": "authorized" }] }] }
```

### `GET /api/facilities/:id/energy?from=&to=` (public)
`from`/`to` optional ISO bounds. Returns per-interval energy balance for the facility (aligned across its meters; missing streams are null):

```json
{
  "facilityId": "fac-solar-1",
  "from": "2026-10-20T10:00:00Z",
  "to": "2026-10-20T14:00:00Z",
  "assumptions": ["losses not metered; treated as 0", "surplus is an estimate, not a metered export"],
  "intervals": [
    {
      "intervalStart": "2026-10-20T12:00:00Z",
      "intervalEnd": "2026-10-20T13:00:00Z",
      "generationKwh": 100,
      "loadKwh": 55,
      "importKwh": 0,
      "exportKwh": 30,
      "batteryChargeKwh": 10,
      "batteryDischargeKwh": 0,
      "balanceResidualKwh": 0,
      "estimatedSurplusKwh": 30,
      "offerableKwh": 24,
      "reservedKwh": 4,
      "bufferKwh": 2,
      "claimStatus": "VERIFIED_FOR_PROTOTYPE",
      "hasOpenOffer": true
    }
  ]
}
```
Formulas (spec §8): `estimatedSurplus = max(0, generation - load - batteryCharge)` (storage present) or `max(0, generation - load)`; `offerable = max(0, surplus - reserved - buffer)` capped by `exportLimitKw * hours`, **and forced to 0 unless a claim covering the interval has status `VERIFIED_FOR_PROTOTYPE`**. `balanceResidual = |generation + import + discharge - load - export - charge|`.

### `POST /api/readings/import` (auth)
Body: raw CSV text (`Content-Type: text/csv`) with header:
```
meterId,facilityId,meterType,intervalStart,intervalEnd,energyKwh
```
`facilityId`/`meterType` are used to auto-create the meter if missing (meter created with `sourceType:"csv"`, `sourceStatus:"unverified"` unless already exists). Unknown `meterId`+facilities are auto-created only if facilityId given.
Response:
```json
{ "imported": 48, "skippedDuplicates": 2, "invalid": 0, "errors": [] }
```
Duplicate `(meterId, intervalStart, intervalEnd)` → skipped + counted. Negative energy on `generation|load` → invalid + counted (not stored).

### `POST /api/simulator/run` (auth)
Generates deterministic synthetic readings for every facility in the database (profiles are derived
from each facility's type and installed capacity; meters are auto-created when missing).
Query/body: `{ "days": 7, "seed": 42, "injectAnomalies": true }`.
```json
{ "days": 7, "seed": 42, "readingsWritten": 672, "anomaliesInjected": ["capacity-spike-<facilityId>@...", "stale-readings-<facilityId>@..."], "window": { "from": "...", "to": "..." } }
```
Deterministic per seed. With `injectAnomalies:true`, deliberately writes: (a) a soft capacity-spike hour at solar noon yesterday (~1.15× installed capacity — soft-rule territory so a claim lands in `REVIEW_REQUIRED`, not hard-rejected), (b) a duplicated-interval attempt (skipped, counted), (c) a stale reading (ingestedAt backdated > 48h). Harder anomaly cases live in `data/samples/meter-readings-anomaly.csv`.

### `POST /api/facilities` (auth)
Body `{ "name": "North Solar Farm", "type": "producer", "installedCapacityKw": 150, "exportLimitKw": 120, "id": "optional" }` → `201`. The acting user becomes the owner.

### `POST /api/meters` (auth; facility owner or admin)
Body `{ "facilityId": "…", "meterType": "generation", "id": "optional" }` → `201`. Default id is `{facilityId}-{meterType}`.

---

## 3. Certificates (mock registry adapter)

### `GET /api/certificates` (public)
```json
{ "certificates": [{ "externalId": "CERT-0001", "registry": "MOCK", "issuer": "Tranergy Registry", "quantityMwh": 1, "status": "ACTIVE", "ownerReference": "ada", "metadataHash": "0x...", "issuedAt": "..." }] }
```

### `GET /api/certificates/:externalId/check` (public)
```json
{
  "externalId": "CERT-0001",
  "status": "ACTIVE",
  "usable": true,
  "quantityMwh": 1,
  "issues": [],
  "usedByClaimIds": []
}
```
`issues` codes: `CERTIFICATE_NOT_FOUND`, `CERTIFICATE_TRANSFERRED`, `CERTIFICATE_RETIRED`, `CERTIFICATE_INVALID`, `CERTIFICATE_DUPLICATE_USE` (same externalId already attached to a non-rejected claim), `CERTIFICATE_QUANTITY_TOO_SMALL` (quantityMwh*1000 < claim — when `?claimKwh=` given).

Certificates are registered at runtime via `POST /api/certificates` (producer/verifier/admin):
`{ "externalId": "CERT-0001", "quantityMwh": 1, "status": "ACTIVE", "issuer": "Tranergy Registry" }` → `201`.

---

## 4. Claims & verification

### `POST /api/claims` (auth, producer/admin)
```json
{ "facilityId": "fac-solar-1", "intervalStart": "2026-10-20T12:00:00Z", "intervalEnd": "2026-10-20T13:00:00Z", "claimedKwh": 100, "certificateExternalId": "CERT-0001" }
```
Response `201`: claim with `"status": "PENDING"`.

### `POST /api/claims/:id/verify` (auth)
Runs deterministic rules + certificate adapter + ML scoring. Creates/updates the VerificationCase. Returns:

```json
{
  "claim": { "id": "clm-...", "status": "REVIEW_REQUIRED", "claimedKwh": 800, "...": "..." },
  "case": {
    "id": "vc-...",
    "ruleResults": [
      { "code": "CAPACITY_EXCEEDED", "severity": "soft", "message": "generation 800 kWh vs capacity 150 kW" },
      { "code": "CLAIM_EXCEEDS_METER", "severity": "soft", "message": "claimed 800 > meter 610 * 1.02" }
    ],
    "mlStatus": "ANOMALY_FLAGGED",
    "anomalyScore": 0.73,
    "anomalyFlags": ["GEN_SPIKE_VS_ROLLING", "GEN_ABOVE_CAPACITY"],
    "modelVersion": "iforest-v1",
    "reviewStatus": "OPEN"
  }
}
```

**Rule codes** (severity `hard` ⇒ `REJECTED_BY_RULE`, `soft` ⇒ contributes to `REVIEW_REQUIRED`):

| code | severity | trigger |
|---|---|---|
| `NO_GENERATION_READING` | hard | no generation meter reading covering the interval |
| `INVALID_READING_QUALITY` | hard | any covering reading stored with `qualityStatus:"invalid"` |
| `NEGATIVE_ENERGY` | hard | negative stored energy on generation/load in window |
| `CERTIFICATE_INVALID` | hard | registry status INVALID |
| `CERTIFICATE_NOT_FOUND` | soft | no registry record for referenced id |
| `CERTIFICATE_TRANSFERRED` | soft | status TRANSFERRED |
| `CERTIFICATE_RETIRED` | soft | status RETIRED (already consumed attributes) |
| `CERTIFICATE_DUPLICATE_USE` | soft | same cert attached to another non-rejected claim |
| `CERTIFICATE_QUANTITY_TOO_SMALL` | soft | cert MWh*1000 < claimedKwh |
| `CAPACITY_EXCEEDED` | soft>1.05 / hard>1.25 | meter generation > installedCapacityKw × hours × factor |
| `CLAIM_EXCEEDS_METER` | soft | claimedKwh > meterGeneration × 1.02 |
| `METER_SOURCE_UNAUTHORIZED` | soft | covering meter `sourceStatus != authorized` |
| `STALE_READING` | soft | any covering reading ingested > 48h after intervalEnd |
| `MISSING_INTERVALS` | soft | gap in hourly generation series within claim window |
| `ENERGY_BALANCE_RESIDUAL` | soft | residual > `max(1, 5% of generation)` |
| `ML_ANOMALY_FLAGGED` | soft | ML service flagged the interval |

Status logic: any hard ⇒ `REJECTED_BY_RULE`; else any soft or ML flag ⇒ `REVIEW_REQUIRED`; else `VERIFIED_FOR_PROTOTYPE`.

### `GET /api/verification-cases?status=OPEN` (auth)
```json
{ "cases": [{ "id": "vc-...", "claim": { "id": "clm-...", "facilityId": "fac-solar-1", "intervalStart": "...", "intervalEnd": "...", "claimedKwh": 800, "status": "REVIEW_REQUIRED" }, "ruleResults": [], "anomalyScore": 0.73, "anomalyFlags": [], "reviewStatus": "OPEN", "createdAt": "..." }] }
```

### `POST /api/verification-cases/:id/decision` (auth, verifier/admin)
```json
{ "decision": "approve", "note": "manual meter audit ok" }
```
`approve` ⇒ claim `VERIFIED_FOR_PROTOTYPE`, case `APPROVED_BY_REVIEWER`. `reject` ⇒ claim `REJECTED_BY_RULE`, case `REJECTED_BY_REVIEWER`. If claim already verified and an open offer exists for it, offer stays valid; if reject → any OPEN offers for that claim become `BLOCKED`.

---

## 5. Marketplace

### `POST /api/offers` (auth, producer/admin)
```json
{ "claimId": "clm-...", "quantityKwh": 24, "pricePerKwh": 0.12 }
```
Server derives facility + interval from the claim. **Hard requirements** (else `400`/`CONFLICT` with code `NOT_ELIGIBLE`): claim status `VERIFIED_FOR_PROTOTYPE`; `0 < quantityKwh <= offerableKwh` for that interval.
Response: offer with `status:"OPEN"`, `reservedKwh: 0`.

### `GET /api/offers?status=OPEN` (public)
```json
{ "offers": [{ "id": "off-...", "facilityId": "fac-solar-1", "intervalStart": "...", "intervalEnd": "...", "quantityKwh": 24, "reservedKwh": 0, "pricePerKwh": 0.12, "status": "OPEN", "remainingKwh": 24, "claimId": "clm-..." }] }
```

### `POST /api/offers/:id/withdraw` (auth, owner/producer/admin)
Only if `reservedKwh == 0`; else `CONFLICT`.

### `POST /api/requests` (auth, consumer/admin)
```json
{ "quantityKwh": 20, "maxPricePerKwh": 0.15, "intervalStart": "...", "intervalEnd": "..." }
```

### `GET /api/requests?status=OPEN` (public) — same shape with `allocatedKwh`, `remainingKwh`.

### `POST /api/matches/preview` (auth)
Optional body `{ "intervalStart": "...", "intervalEnd": "..." }` (else all intervals).
Pure computation; no DB writes.
```json
{
  "matches": [
    { "offerId": "off-...", "requestId": "req-...", "intervalStart": "...", "intervalEnd": "...", "agreedKwh": 20, "pricePerKwh": 0.12, "reason": "lowest price offer with compatible interval and price <= max" }
  ],
  "unmatchedOffers": [{ "offerId": "off-...", "reason": "NO_COMPATIBLE_REQUEST" }],
  "unmatchedRequests": [{ "requestId": "req-...", "reason": "INSUFFICIENT_OFFERS" }]
}
```

### `POST /api/matches/run` (auth, verifier/admin)
Executes the preview transactionally (see matching algorithm), creating `Trade` rows in state `MATCHED`, incrementing `offer.reservedKwh` and `request.allocatedKwh`.
```json
{ "createdTrades": [{ "tradeId": "trd-...", "offerId": "off-...", "requestId": "req-...", "agreedKwh": 20, "pricePerKwh": 0.12, "state": "MATCHED" }], "skipped": [] }
```
Matching algorithm (deterministic, explainable):
1. Group OPEN offers & requests by exact `(intervalStart, intervalEnd)`.
2. Skip offers whose claim is not `VERIFIED_FOR_PROTOTYPE`.
3. Sort offers by `pricePerKwh` ASC, then `id` ASC; requests by `maxPricePerKwh` DESC, then `id` ASC.
4. For each request, take cheapest eligible offers while `offer.pricePerKwh <= request.maxPricePerKwh`; allocate `min(remainingOffer, remainingRequest)`.
5. Reservation is applied with a conditional SQL update (`UPDATE ... SET reserved = reserved + ? WHERE id = ? AND reserved + ? <= quantity`) inside a transaction; failure aborts that trade (prevents double allocation).

---

## 6. Trades, delivery, settlement, receipts

### `GET /api/trades` (public)
```json
{ "trades": [{ "id": "trd-...", "offerId": "...", "requestId": "...", "agreedKwh": 20, "pricePerKwh": 0.12, "state": "MATCHED", "evidenceHash": null, "chainTradeId": 3, "chainTxHash": "0x...", "settlementTxHash": null, "createdAt": "...", "updatedAt": "..." }] }
```

### `GET /api/trades/:id` (public) — single trade + nested `evidenceBundles`, `rewardEvents`.

### `POST /api/trades/:id/evidence` (auth)
Attaches delivery-interval evidence. Body:
```json
{
  "producerExportKwh": 19.4,
  "consumerImportKwh": 19.1,
  "notes": "simulated meter pull",
  "recordReferences": ["m-solar-export@2026-10-20T12:00Z"]
}
```
Server computes `discrepancyPct = |measured - agreed| / agreed * 100` where `measured = producerExportKwh ?? consumerImportKwh`. Tolerance env `DELIVERY_TOLERANCE_PCT` (default `10`).
- Builds canonical JSON of payload+references, sets `evidenceHash = sha256(canonical)`.
- `discrepancyPct <= tolerance` ⇒ trade `EVIDENCE_SUBMITTED`, evidence bundle `PENDING`; submits `submitEvidence(chainTradeId, evidenceHash)` on-chain if chain enabled (tx hash stored on trade).
- Else ⇒ trade `REVIEW_REQUIRED`, bundle `PENDING`, `discrepancyPct` stored (still records evidence hash on-chain **only if** within tolerance; otherwise off-chain only).
Response: updated trade + `{ "discrepancyPct": 3.2, "withinTolerance": true, "chainTxHash": "0x..." | null }`.

### `POST /api/trades/:id/attest` (auth, verifier/admin)
Only if state `EVIDENCE_SUBMITTED`. Marks bundle `ATTESTED`, then (if chain enabled) calls `attestAndSettle(chainTradeId)`; on success trade → `SETTLED`, `settlementTxHash` set, creates `RewardEvent` (amount = agreedKwh × 10^18 wei-string, recipient = offer facility owner wallet or `user-alice` fallback, reason `"verified-delivery"`). If chain disabled: trade still → `SETTLED` with null hashes and a `"chainDisabled": true` note in response.
Failure of unauthorized caller: `403 FORBIDDEN`.

### `POST /api/trades/:id/dispute` (auth, verifier/admin)
State → `DISPUTED` (from `MATCHED`/`EVIDENCE_SUBMITTED`/`REVIEW_REQUIRED`). If chain enabled and chainTradeId exists → `dispute(chainTradeId, reason)`.

### `GET /api/trades/:id/receipt` (public)
```json
{
  "trade": { "id": "trd-...", "state": "SETTLED", "agreedKwh": 20, "pricePerKwh": 0.12, "estimatedValue": 2.4 },
  "offer": { "id": "off-...", "facilityId": "fac-solar-1" },
  "request": { "id": "req-...", "buyerId": "user-bob" },
  "evidence": { "hash": "0x...", "discrepancyPct": 3.2, "withinTolerance": true, "recordReferences": ["..."], "attestationStatus": "ATTESTED" },
  "chain": { "enabled": true, "tradeId": 3, "txHash": "0x...", "settlementTxHash": "0x...", "stateOnChain": "Settled" },
  "rewards": [{ "recipient": "0x...", "amount": "20000000000000000000", "reason": "verified-delivery", "txHash": "0x..." }]
}
```

---

## 7. ML service contract (API → ML, port 8000)

### `GET /health` (public)
```json
{ "ok": true, "service": "tranergy-ml", "modelVersion": "iforest-v1", "trained": true, "nTrain": 5000 }
```

### `POST /train` (public)
Body `{ "seed": 42, "nSamples": 4000, "force": true }` → trains IsolationForest on **synthetic normal operating patterns**, evaluates against **injected anomalies** (never trained on them).
```json
{
  "modelVersion": "iforest-v1",
  "nTrain": 4000,
  "nTest": 1000,
  "metrics": { "precision": 0.9, "recall": 0.85, "f1": 0.87, "fpr": 0.02 },
  "trainedAt": "2026-10-18T12:00:00Z"
}
```
Model persisted to `ML_MODEL_DIR` (joblib). `modelVersion` = `iforest-<YYYYMMDD>-v1` (bump per training).

### `POST /score` (API only; public)
Request — backend sends the target interval **plus recent history** for feature engineering:
```json
{
  "facilityId": "fac-solar-1",
  "capacityKw": 150,
  "target": {
    "intervalStart": "2026-10-20T12:00:00Z",
    "intervalEnd": "2026-10-20T13:00:00Z",
    "generationKwh": 800, "consumptionKwh": 55,
    "importKwh": 0, "exportKwh": 30,
    "batteryChargeKwh": 0, "batteryDischargeKwh": 0,
    "balanceResidualKwh": 715
  },
  "history": [ { "...same shape as target...", "intervalStart": "...", "intervalEnd": "..." } ],
  "missingIntervals": 0
}
```
`history` = up to 24 previous intervals, chronological. ML computes: capacity ratio, hour-of-day, day-of-year, delta vs previous, rolling mean/std (window 6), balance residual, freshness/missing flags.
Response:
```json
{
  "anomalyScore": 0.73,
  "isAnomaly": true,
  "flagged": true,
  "mlStatus": "ANOMALY_FLAGGED",
  "reasonCodes": ["GEN_SPIKE_VS_ROLLING", "GEN_ABOVE_CAPACITY"],
  "modelVersion": "iforest-v1",
  "features": { "capacityRatio": 5.33, "hourOfDay": 12, "deltaVsPrevKwh": 690, "rollingMeanKwh": 98.2, "rollingStdKwh": 12.1, "zScore": 57.9, "balanceResidualKwh": 715 }
}
```
`flagged` is true if the model predicts an anomaly **or** any heuristic reason code fired; `isAnomaly` is the model verdict alone; `mlStatus` mirrors `flagged` (`ANOMALY_FLAGGED` / `OK`).
Reason codes (heuristic overlays on the model score; empty list is valid): `GEN_SPIKE_VS_ROLLING` (|z|>4), `GEN_ABOVE_CAPACITY` (ratio>1.05), `GEN_COLLAPSE` (z<-3 with history mean>10), `BALANCE_RESIDUAL_HIGH` (residual > 25% of generation), `MISSING_INTERVALS_PRESENT`.
If model not trained: auto-train once with default seed, or return `mlStatus:"UNAVAILABLE"` + `503` only if training fails. Never fabricates a verdict — always also return raw score.

ML internals (fixed for reproducibility): `sklearn.ensemble.IsolationForest(contamination=0.05, random_state=42, n_estimators=200)`; anomalyScore = min-max scaled `-score_samples` in [0,1]; `isAnomaly` = raw prediction `-1`. Train/test split by time (last 20% of generated series held out). Test set contains 50% injected anomalies of types: capacity spike, collapse, meter-stuck (constant), balance-breaking import/export mismatch, gap-then-resume.

---

## 8. Environment variables

See `.env.example` at repo root. Key vars: `DATABASE_URL="postgresql://…/postgres?sslmode=require"` (Supabase or any Postgres), `API_PORT=4000`, `ML_SERVICE_URL=http://127.0.0.1:8000`, `ML_PORT=8000`, `ENERGY_BUFFER_KWH=2`, `BALANCE_TOLERANCE_KWH=5`, `DELIVERY_TOLERANCE_PCT=10`, `CHAIN_ENABLED=true`, `ANVIL_RPC_URL=http://127.0.0.1:8545`, `CONTRACTS_DEPLOYMENT_FILE=../../contracts/deployments/anvil.json`, `OPERATOR_PRIVATE_KEY` (Anvil account #0 dev key), `ATTESTOR_PRIVATE_KEY` (Anvil account #1 dev key), `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000`, `NEXT_PUBLIC_ANVIL_RPC_URL=http://127.0.0.1:8545`.

---

## 9. Runtime bootstrap

There is no seed script. The database starts empty and is populated through the API/UI:

1. Connect a wallet in the dashboard — the first wallet becomes `admin`, later wallets join as `producer`/`consumer`.
2. `POST /api/facilities` — create facilities (owner = acting user).
3. `POST /api/meters` — attach meters, or let `POST /api/simulator/run` / CSV import auto-create them.
4. `POST /api/certificates` — register certificate records.
5. `POST /api/simulator/run` (or CSV import) — generate meter readings for the created facilities.

All of these are exposed on the dashboard's **Admin** page.
