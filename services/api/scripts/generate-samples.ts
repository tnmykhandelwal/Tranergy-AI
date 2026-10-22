import fs from "node:fs";
import path from "node:path";
import { generateCsv } from "../src/services/simulator";

const outputDir = path.resolve(__dirname, "../../../data/samples");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeCleanSample(): string {
  const csv = generateCsv(0.5, 42, {
    facilityIds: ["fac-solar-1"],
    start: new Date("2026-10-17T10:00:00Z"),
  });
  const file = path.join(outputDir, "meter-readings-sample.csv");
  fs.writeFileSync(file, csv.trimEnd() + "\n");
  return file;
}

function writeAnomalySample(): string {
  const header = "meterId,facilityId,meterType,intervalStart,intervalEnd,energyKwh";
  const rows = [
    "m-solar-gen,fac-solar-1,generation,2026-10-17T11:00:00.000Z,2026-10-17T12:00:00.000Z,142.5",
    "m-solar-export,fac-solar-1,grid_export,2026-10-17T11:00:00.000Z,2026-10-17T12:00:00.000Z,130.2",
    "m-solar-load,fac-solar-1,load,2026-10-17T11:00:00.000Z,2026-10-17T12:00:00.000Z,12.3",
    "m-solar-gen,fac-solar-1,generation,2026-10-17T12:00:00.000Z,2026-10-17T13:00:00.000Z,300",
    "m-solar-export,fac-solar-1,grid_export,2026-10-17T12:00:00.000Z,2026-10-17T13:00:00.000Z,288.1",
    "m-solar-load,fac-solar-1,load,2026-10-17T12:00:00.000Z,2026-10-17T13:00:00.000Z,11.9",
    "m-solar-gen,fac-solar-1,generation,2026-10-17T12:00:00.000Z,2026-10-17T13:00:00.000Z,299",
    "m-solar-gen,fac-solar-1,generation,2026-10-17T13:00:00.000Z,2026-10-17T14:00:00.000Z,138.7",
    "m-solar-export,fac-solar-1,grid_export,2026-10-17T13:00:00.000Z,2026-10-17T14:00:00.000Z,126.4",
    "m-solar-load,fac-solar-1,load,2026-10-17T13:00:00.000Z,2026-10-17T14:00:00.000Z,12.3",
    "m-solar-gen,fac-solar-1,generation,2026-10-17T14:00:00.000Z,2026-10-17T15:00:00.000Z,-5",
    "m-solar-load,fac-solar-1,load,2026-10-17T14:00:00.000Z,2026-10-17T15:00:00.000Z,12.1",
  ];
  const file = path.join(outputDir, "meter-readings-anomaly.csv");
  fs.writeFileSync(file, [header, ...rows].join("\n") + "\n");
  return file;
}

ensureDir(outputDir);
const cleanFile = writeCleanSample();
const anomalyFile = writeAnomalySample();
console.log(`wrote ${cleanFile}`);
console.log(`wrote ${anomalyFile}`);
