import assert from "node:assert/strict";
import test from "node:test";
import { runDirectSunWorkerTask } from "../src/workers/direct-sun.worker";
import type { BuildingQueryMeta } from "../src/lib/buildings/types";

const meta: BuildingQueryMeta = {
  complete: true,
  provider: "smap",
  requestedBounds: [127, 37, 127.01, 37.01],
  coveredBounds: [127, 37, 127.01, 37.01],
  sourceVersion: "test",
  featureCount: 0,
  truncatedCells: [],
  estimatedHeightRatio: 0,
  warnings: [],
};

test("direct-sun worker task preserves request IDs and returns versioned reports", () => {
  const result = runDirectSunWorkerTask({
    requestId: 7,
    input: {
      date: "2026-06-21",
      coordinates: [127, 37.5],
      target: { x: 0, y: 0, z: 1.5 },
      buildings: [],
      buildingMeta: meta,
      sampleMinutes: 10,
    },
    overlayInput: {
      date: "2026-06-21",
      coordinates: [127, 37.5],
      bounds: [127, 37.49, 127.01, 37.5],
      columns: 2,
      rows: 2,
      buildings: [],
      buildingMeta: meta,
      sampleMinutes: 10,
    },
  });
  assert.equal(result.requestId, 7);
  assert.equal(result.report.algorithm, "sun-ray-v1");
  assert.equal(result.report.samples.length, 144);
  assert.equal(result.overlay?.complete, true);
  assert.equal(result.overlay?.geojson.features.length, 4);
  assert.ok((result.overlay?.validSamples ?? 0) > 0);
});
