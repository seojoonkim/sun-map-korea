import assert from "node:assert/strict";
import test from "node:test";
import type { BuildingQueryMeta } from "../src/lib/buildings/types";
import { generateDailyReport, mergeSunSamples } from "../src/lib/analysis/daily-report";

const completeMeta: BuildingQueryMeta = {
  complete: true,
  provider: "smap",
  requestedBounds: [127, 37, 128, 38],
  coveredBounds: [127, 37, 128, 38],
  sourceVersion: "smap-2025",
  featureCount: 0,
  truncatedCells: [],
  estimatedHeightRatio: 0,
  warnings: [],
};

test("daily report samples a KST day every five minutes and preserves all minutes", () => {
  const report = generateDailyReport({
    date: "2026-06-21",
    coordinates: [127.088, 37.504],
    target: { x: 0, y: 0, z: 1.5 },
    buildings: [],
    buildingMeta: completeMeta,
    sampleMinutes: 5,
    solarPosition: (_date, minute) => {
      if (minute < 360 || minute >= 1_200) return { azimuth: 0, elevation: -5 };
      if (minute < 420) return { azimuth: 80, elevation: 7 };
      return { azimuth: 180, elevation: 30 };
    },
  });

  assert.equal(report.complete, true);
  assert.equal(report.samples.length, 288);
  assert.equal(report.totals?.belowHorizonMinutes, 600);
  assert.equal(report.totals?.uncertainMinutes, 60);
  assert.equal(report.totals?.sunMinutes, 780);
  assert.equal(report.totals?.shadeMinutes, 0);
  assert.equal(Object.values(report.totals ?? {}).reduce((sum, value) => sum + value, 0), 1440);
  assert.equal(report.firstSunMinute, 420);
  assert.equal(report.lastSunMinute, 1195);
  assert.equal(report.errorMinutes, 5);
});

test("sample merging keeps stable contiguous state intervals", () => {
  const intervals = mergeSunSamples([
    { minute: 0, azimuth: 0, elevation: -1, state: "below-horizon" },
    { minute: 5, azimuth: 0, elevation: 3, state: "uncertain" },
    { minute: 10, azimuth: 0, elevation: 12, state: "sun" },
    { minute: 15, azimuth: 0, elevation: 14, state: "sun" },
    { minute: 20, azimuth: 0, elevation: 16, state: "shade", blockerId: "b:1" },
  ], 5);
  assert.deepEqual(intervals.map(({ state, startMinute, endMinute }) => ({ state, startMinute, endMinute })), [
    { state: "below-horizon", startMinute: 0, endMinute: 5 },
    { state: "uncertain", startMinute: 5, endMinute: 10 },
    { state: "sun", startMinute: 10, endMinute: 20 },
    { state: "shade", startMinute: 20, endMinute: 25 },
  ]);
});

test("incomplete building data refuses to produce numeric totals", () => {
  const report = generateDailyReport({
    date: "2026-06-21",
    coordinates: [127.088, 37.504],
    target: { x: 0, y: 0, z: 1.5 },
    buildings: [],
    buildingMeta: { ...completeMeta, complete: false, warnings: ["upstream page failed"] },
  });
  assert.equal(report.complete, false);
  assert.equal(report.totals, undefined);
  assert.equal(report.samples.length, 0);
  assert.match(report.warnings.join(" "), /upstream page failed/);
});

test("window facade rear hemisphere counts as shade, not direct sun", () => {
  const report = generateDailyReport({
    date: "2026-06-21",
    coordinates: [127.088, 37.504],
    target: { x: 0, y: 0, z: 10 },
    facadeAzimuth: 0,
    buildings: [],
    buildingMeta: completeMeta,
    sampleMinutes: 10,
    solarPosition: () => ({ azimuth: 180, elevation: 30 }),
  });
  assert.equal(report.totals?.shadeMinutes, 1440);
  assert.equal(report.totals?.sunMinutes, 0);
  assert.equal(report.samples[0].blockerId, "facade");
});
