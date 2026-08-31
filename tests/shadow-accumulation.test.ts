import assert from "node:assert/strict";
import test from "node:test";
import { accumulateShadowMasks, shadowRatiosToGeoJson } from "../src/lib/analysis/shadow-raster";

test("same-time overlaps are binary while different times accumulate", () => {
  const result = accumulateShadowMasks([
    new Uint8Array([1, 1, 0, 0]),
    new Uint8Array([1, 0, 1, 0]),
    null,
  ], 4);
  assert.equal(result.validSamples, 2);
  assert.deepEqual([...result.shadowedSamples], [2, 1, 1, 0]);
  assert.deepEqual([...result.ratios], [1, 0.5, 0.5, 0]);
});

test("invalid or uncertain samples do not enter the denominator", () => {
  const result = accumulateShadowMasks([null, null], 2);
  assert.equal(result.validSamples, 0);
  assert.deepEqual([...result.ratios], [0, 0]);
});

test("grid ratios become map cells with percentage and text labels", () => {
  const geojson = shadowRatiosToGeoJson({
    bounds: [127, 37, 127.02, 37.01],
    columns: 2,
    rows: 1,
    ratios: new Float32Array([0, 0.75]),
  });
  assert.equal(geojson.features.length, 2);
  assert.equal(geojson.features[0].properties?.shadowRatio, 0);
  assert.equal(geojson.features[1].properties?.shadowPercent, 75);
  assert.equal(geojson.features[1].properties?.label, "75% 그늘");
  assert.deepEqual(geojson.features[0].geometry.coordinates[0][0], [127, 37]);
  const [cellEast, cellNorth] = geojson.features[1].geometry.coordinates[0][2];
  assert.ok(Math.abs(cellEast - 127.02) < 1e-10);
  assert.ok(Math.abs(cellNorth - 37.01) < 1e-10);
});
