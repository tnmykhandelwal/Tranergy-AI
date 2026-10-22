import { config } from "../config";

export interface MlTargetPayload {
  intervalStart: string;
  intervalEnd: string;
  generationKwh: number;
  consumptionKwh: number;
  importKwh: number;
  exportKwh: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  balanceResidualKwh: number;
}

export interface MlScorePayload {
  facilityId: string;
  capacityKw: number;
  target: MlTargetPayload;
  history: MlTargetPayload[];
  missingIntervals: number;
}

export interface MlScoreResult {
  mlStatus: "OK" | "ANOMALY_FLAGGED" | "UNAVAILABLE";
  anomalyScore: number | null;
  isAnomaly: boolean | null;
  flagged: boolean;
  reasonCodes: string[];
  modelVersion: string | null;
  features: Record<string, number> | null;
}

export const ML_UNAVAILABLE_RESULT: MlScoreResult = {
  mlStatus: "UNAVAILABLE",
  anomalyScore: null,
  isAnomaly: null,
  flagged: false,
  reasonCodes: [],
  modelVersion: null,
  features: null,
};

function asNumberArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseMlResponse(body: unknown): MlScoreResult {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const rawStatus = typeof record.mlStatus === "string" ? record.mlStatus : "UNAVAILABLE";
  const mlStatus: MlScoreResult["mlStatus"] =
    rawStatus === "OK" || rawStatus === "ANOMALY_FLAGGED" || rawStatus === "UNAVAILABLE"
      ? rawStatus
      : "UNAVAILABLE";
  const anomalyScore = asNumber(record.anomalyScore);
  const isAnomaly = typeof record.isAnomaly === "boolean" ? record.isAnomaly : null;
  const flagged =
    typeof record.flagged === "boolean" ? record.flagged : isAnomaly === true || mlStatus === "ANOMALY_FLAGGED";
  const features =
    typeof record.features === "object" && record.features !== null
      ? (record.features as Record<string, number>)
      : null;
  return {
    mlStatus,
    anomalyScore,
    isAnomaly,
    flagged,
    reasonCodes: asNumberArray(record.reasonCodes),
    modelVersion: typeof record.modelVersion === "string" ? record.modelVersion : null,
    features,
  };
}

export async function scoreMl(payload: MlScorePayload): Promise<MlScoreResult> {
  try {
    const response = await fetch(`${config.ML_SERVICE_URL.replace(/\/$/, "")}/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { ...ML_UNAVAILABLE_RESULT };
    const body: unknown = await response.json();
    const parsed = parseMlResponse(body);
    if (parsed.mlStatus === "UNAVAILABLE") return { ...ML_UNAVAILABLE_RESULT };
    return parsed;
  } catch {
    return { ...ML_UNAVAILABLE_RESULT };
  }
}
