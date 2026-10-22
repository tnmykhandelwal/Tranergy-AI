export interface IntervalStreams {
  generationKwh: number | null;
  loadKwh: number | null;
  importKwh: number | null;
  exportKwh: number | null;
  batteryChargeKwh: number | null;
  batteryDischargeKwh: number | null;
}

export interface EnergyBalanceParams {
  streams: IntervalStreams;
  hours: number;
  bufferKwh: number;
  reservedKwh: number;
  claimVerified: boolean;
  exportLimitKw: number;
}

export interface EnergyBalanceResult {
  estimatedSurplusKwh: number;
  offerableKwh: number;
  balanceResidualKwh: number;
  assumptions: string[];
}

export const ENERGY_ASSUMPTIONS = [
  "losses not metered; treated as 0",
  "surplus is an estimate, not a metered export",
];

export function computeEnergyBalance(params: EnergyBalanceParams): EnergyBalanceResult {
  const generation = params.streams.generationKwh ?? 0;
  const load = params.streams.loadKwh ?? 0;
  const gridImport = params.streams.importKwh ?? 0;
  const gridExport = params.streams.exportKwh ?? 0;
  const batteryCharge = params.streams.batteryChargeKwh ?? 0;
  const batteryDischarge = params.streams.batteryDischargeKwh ?? 0;

  const storagePresent =
    params.streams.batteryChargeKwh !== null || params.streams.batteryDischargeKwh !== null;

  const surplus = Math.max(0, storagePresent ? generation - load - batteryCharge : generation - load);
  const uncapped = Math.max(0, surplus - params.reservedKwh - params.bufferKwh);
  const exportCap = Math.max(0, params.exportLimitKw * params.hours);
  const offerable = params.claimVerified ? Math.min(uncapped, exportCap) : 0;

  const residual = Math.abs(
    generation + gridImport + batteryDischarge - load - gridExport - batteryCharge,
  );

  return {
    estimatedSurplusKwh: surplus,
    offerableKwh: offerable,
    balanceResidualKwh: residual,
    assumptions: ENERGY_ASSUMPTIONS,
  };
}

export function aggregateStreams(readings: Array<{ meterType: string; energyKwh: number }>): IntervalStreams {
  const sum = (type: string): number | null => {
    const matches = readings.filter((r) => r.meterType === type);
    if (matches.length === 0) return null;
    return matches.reduce((acc, r) => acc + r.energyKwh, 0);
  };
  return {
    generationKwh: sum("generation"),
    loadKwh: sum("load"),
    importKwh: sum("grid_import"),
    exportKwh: sum("grid_export"),
    batteryChargeKwh: sum("battery_charge"),
    batteryDischargeKwh: sum("battery_discharge"),
  };
}
