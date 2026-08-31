import assert from "node:assert/strict";
import test from "node:test";
import { generateGroundShadowOverlay } from "../src/lib/analysis/ground-shadow-overlay";
import type { BuildingQueryMeta } from "../src/lib/buildings/types";

const meta: BuildingQueryMeta = {
  complete: true,
  provider: "smap",
  requestedBounds: [127, 37, 127.001, 37.001],
  coveredBounds: [127, 37, 127.001, 37.001],
  sourceVersion: "test",
  featureCount: 1,
  truncatedCells: [],
  estimatedHeightRatio: 0,
  warnings: [],
};

test("ground overlay evaluates each valid time once and returns mapped shadow cells", () => {
  const result = generateGroundShadowOverlay({
    date: "2026-06-21",
    coordinates: [127, 37],
    bounds: [127, 37, 127.0002, 37.0001],
    columns: 2,
    rows: 1,
    buildings: [{
      id: "wall",
      minZ: 0,
      maxZ: 30,
      geometry: { type: "Polygon", coordinates: [[[4, -20], [8, -20], [8, 20], [4, 20], [4, -20]]] },
    }],
    buildingMeta: meta,
    sampleMinutes: 10,
    minimumPreciseElevation: 10,
    solarPosition: (_date, minute) => minute === 720
      ? { azimuth: 90, elevation: 30 }
      : { azimuth: 0, elevation: -1 },
  });

  assert.equal(result.complete, true);
  assert.equal(result.validSamples, 1);
  assert.equal(result.geojson.features.length, 2);
  assert.equal(result.geojson.features[0].properties.shadowPercent, 100);
  assert.equal(result.geojson.features[1].properties.shadowPercent, 0);
});

test("incomplete building coverage refuses a numeric ground overlay", () => {
  const result = generateGroundShadowOverlay({
    date: "2026-06-21",
    coordinates: [127, 37],
    bounds: [127, 37, 127.001, 37.001],
    columns: 2,
    rows: 2,
    buildings: [],
    buildingMeta: { ...meta, complete: false, warnings: ["partial"] },
  });
  assert.equal(result.complete, false);
  assert.equal(result.validSamples, 0);
  assert.equal(result.geojson.features.length, 0);
  assert.deepEqual(result.warnings, ["partial"]);
});
