export interface SimulatorReadingRow {
  meterId: string;
  facilityId: string;
  meterType: string;
  intervalStart: Date;
  intervalEnd: Date;
  energyKwh: number;
  ingestedAt?: Date;
}

export interface SimulatorRunResult {
  days: number;
  seed: number;
  readings: SimulatorReadingRow[];
  duplicateAttempt: SimulatorReadingRow | null;
  anomaliesInjected: string[];
  window: { from: Date; to: Date };
}

export interface SimFacility {
  id: string;
  type: string;
  installedCapacityKw: number;
  exportLimitKw: number;
}

export interface SimulatorOptions {
  days?: number;
  seed?: number;
  injectAnomalies?: boolean;
  now?: Date;
  facilities?: SimFacility[];
}

export interface SimStream {
  suffix: string;
  meterType: string;
}

export const SIM_STREAMS: Record<string, SimStream[]> = {
  producer: [
    { suffix: "gen", meterType: "generation" },
    { suffix: "export", meterType: "grid_export" },
    { suffix: "load", meterType: "load" },
  ],
  consumer: [
    { suffix: "load", meterType: "load" },
    { suffix: "import", meterType: "grid_import" },
  ],
  storage: [
    { suffix: "charge", meterType: "battery_charge" },
    { suffix: "discharge", meterType: "battery_discharge" },
    { suffix: "load", meterType: "load" },
  ],
  mixed: [
    { suffix: "gen", meterType: "generation" },
    { suffix: "export", meterType: "grid_export" },
    { suffix: "import", meterType: "grid_import" },
    { suffix: "load", meterType: "load" },
  ],
};

export const DEFAULT_SIM_FACILITIES: SimFacility[] = [
  { id: "fac-solar-1", type: "producer", installedCapacityKw: 150, exportLimitKw: 120 },
  { id: "fac-wind-1", type: "producer", installedCapacityKw: 80, exportLimitKw: 70 },
  { id: "fac-building-1", type: "consumer", installedCapacityKw: 100, exportLimitKw: 0 },
  { id: "fac-battery-1", type: "storage", installedCapacityKw: 50, exportLimitKw: 0 },
];

export function streamsForType(type: string): SimStream[] {
  return SIM_STREAMS[type] ?? SIM_STREAMS.mixed!;
}

export function meterIdFor(facilityId: string, suffix: string): string {
  return `${facilityId}-${suffix}`;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hourStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 3600_000) * 3600_000);
}

export function yesterdayUtcHour(now: Date, hourOfDay: number): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 24 * 3600_000);
  return new Date(day.getTime() + hourOfDay * 3600_000);
}

function solarFactor(hour: number): number {
  return hour + 0.5 > 6 && hour + 0.5 < 18 ? Math.sin((Math.PI * (hour + 0.5 - 6)) / 12) ** 1.5 : 0;
}

function facilityValues(
  facility: SimFacility,
  hour: number,
  rand: () => number,
): Array<{ suffix: string; meterType: string; energyKwh: number }> {
  const capacity = Math.max(1, facility.installedCapacityKw);
  const type = facility.type;
  const out: Array<{ suffix: string; meterType: string; energyKwh: number }> = [];

  if (type === "producer") {
    const gen = round2(capacity * solarFactor(hour) * (0.92 + 0.16 * rand()));
    const load = round2(capacity * (hour >= 7 && hour <= 18 ? 0.05 + 0.03 * rand() : 0.02 + 0.015 * rand()));
    const exported = round2(Math.min(Math.max(0, gen - load), Math.max(0, facility.exportLimitKw)));
    out.push({ suffix: "gen", meterType: "generation", energyKwh: gen });
    out.push({ suffix: "export", meterType: "grid_export", energyKwh: exported });
    out.push({ suffix: "load", meterType: "load", energyKwh: load });
  } else if (type === "consumer") {
    const load = round2(capacity * (hour >= 9 && hour <= 16 ? 0.55 + 0.25 * rand() : 0.15 + 0.1 * rand()));
    out.push({ suffix: "load", meterType: "load", energyKwh: load });
    out.push({ suffix: "import", meterType: "grid_import", energyKwh: load });
  } else if (type === "storage") {
    const charge = round2(hour >= 10 && hour <= 12 ? capacity * (0.3 + 0.2 * rand()) : 0);
    const discharge = round2(hour >= 18 && hour <= 20 ? capacity * (0.25 + 0.2 * rand()) : 0);
    const load = round2(capacity * (0.02 + 0.02 * rand()));
    out.push({ suffix: "charge", meterType: "battery_charge", energyKwh: charge });
    out.push({ suffix: "discharge", meterType: "battery_discharge", energyKwh: discharge });
    out.push({ suffix: "load", meterType: "load", energyKwh: load });
  } else {
    const gen = round2(capacity * 0.7 * solarFactor(hour) * (0.92 + 0.16 * rand()));
    const load = round2(capacity * (hour >= 9 && hour <= 16 ? 0.5 + 0.2 * rand() : 0.2 + 0.1 * rand()));
    const exported = round2(Math.min(Math.max(0, gen - load), Math.max(0, facility.exportLimitKw)));
    const imported = round2(Math.max(0, load - gen));
    out.push({ suffix: "gen", meterType: "generation", energyKwh: gen });
    out.push({ suffix: "load", meterType: "load", energyKwh: load });
    out.push({ suffix: "export", meterType: "grid_export", energyKwh: exported });
    out.push({ suffix: "import", meterType: "grid_import", energyKwh: imported });
  }

  return out;
}

export function generateSimulatorData(options: SimulatorOptions = {}): SimulatorRunResult {
  const days = options.days ?? 7;
  const seed = options.seed ?? 42;
  const injectAnomalies = options.injectAnomalies ?? false;
  const now = options.now ?? new Date();
  const facilities = options.facilities ?? DEFAULT_SIM_FACILITIES;
  const rand = mulberry32(seed);

  const windowEnd = hourStart(now);
  const windowStart = new Date(windowEnd.getTime() - Math.round(days * 24) * 3600_000);

  const readings: SimulatorReadingRow[] = [];

  for (let t = windowStart.getTime(); t < windowEnd.getTime(); t += 3600_000) {
    const intervalStart = new Date(t);
    const intervalEnd = new Date(t + 3600_000);
    const hour = intervalStart.getUTCHours();

    for (const facility of facilities) {
      const streams = facilityValues(facility, hour, rand);
      for (const s of streams) {
        readings.push({
          meterId: meterIdFor(facility.id, s.suffix),
          facilityId: facility.id,
          meterType: s.meterType,
          intervalStart,
          intervalEnd,
          energyKwh: s.energyKwh,
        });
      }
    }
  }

  const anomaliesInjected: string[] = [];
  let duplicateAttempt: SimulatorReadingRow | null = null;

  if (injectAnomalies) {
    const producer = facilities.find((f) => f.type === "producer" || f.type === "mixed");
    if (producer) {
      const spikeStart = yesterdayUtcHour(now, 12);
      const spikeGen = readings.find(
        (r) => r.meterId === meterIdFor(producer.id, "gen") && r.intervalStart.getTime() === spikeStart.getTime(),
      );
      if (spikeGen) {
        spikeGen.energyKwh = round2(producer.installedCapacityKw * 1.15);
        anomaliesInjected.push(`capacity-spike-${producer.id}@${spikeStart.toISOString()}`);
      }
    }

    const other = facilities.find((f) => f.id !== producer?.id);
    if (other) {
      const staleStart = yesterdayUtcHour(now, 8);
      const staleReading = readings.find(
        (r) => r.facilityId === other.id && r.intervalStart.getTime() === staleStart.getTime(),
      );
      if (staleReading) {
        staleReading.ingestedAt = new Date(now.getTime() - 60 * 3600_000);
        anomaliesInjected.push(`stale-readings-${other.id}@${staleStart.toISOString()}`);
      }
    }

    const first = readings[0];
    if (first) {
      duplicateAttempt = { ...first };
      anomaliesInjected.push(`duplicate-interval-skipped@${first.intervalStart.toISOString()}`);
    }
  }

  return {
    days,
    seed,
    readings,
    duplicateAttempt,
    anomaliesInjected,
    window: { from: windowStart, to: windowEnd },
  };
}

export function generateCsv(days: number, seed: number, options?: { facilityIds?: string[]; start?: Date }): string {
  const now = options?.start ? new Date(options.start.getTime() + Math.round(days * 24) * 3600_000) : new Date();
  const data = generateSimulatorData({ days, seed, injectAnomalies: false, now, facilities: DEFAULT_SIM_FACILITIES });
  const facilityFilter = options?.facilityIds ? new Set(options.facilityIds) : null;
  const rows = facilityFilter ? data.readings.filter((r) => facilityFilter.has(r.facilityId)) : data.readings;
  const header = "meterId,facilityId,meterType,intervalStart,intervalEnd,energyKwh";
  const lines = rows.map(
    (r) =>
      `${r.meterId},${r.facilityId},${r.meterType},${r.intervalStart.toISOString()},${r.intervalEnd.toISOString()},${r.energyKwh}`,
  );
  return [header, ...lines].join("\n") + "\n";
}
