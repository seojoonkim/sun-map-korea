import assert from "node:assert/strict";
import test from "node:test";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  OVERTURE_BUILDINGS_URL,
  buildSeoulBuildingRequest,
  isPotentialSeoulViewport,
  normalizeSeoulBuildings,
} from "../src/lib/building-sources";

const polygon: Polygon = {
  type: "Polygon",
  coordinates: [[
    [126.9785, 37.5675],
    [126.9787, 37.5675],
    [126.9787, 37.5673],
    [126.9785, 37.5673],
    [126.9785, 37.5675],
  ]],
};

test("uses the current public Overture buildings archive as the nationwide fallback", () => {
  assert.equal(
    OVERTURE_BUILDINGS_URL,
    "pmtiles://https://tiles.overturemaps.org/2026-08-19.0/buildings.pmtiles",
  );
});

test("only requests Seoul precision data for a sufficiently close Seoul viewport", () => {
  assert.equal(isPotentialSeoulViewport([126.98, 37.56], 15), true);
  assert.equal(isPotentialSeoulViewport([129.075, 35.179], 15), false);
  assert.equal(isPotentialSeoulViewport([126.98, 37.56], 12.9), false);
});

test("builds a bounded same-origin request for Seoul buildings", () => {
  const request = buildSeoulBuildingRequest([126.97, 37.56, 126.99, 37.58]);
  assert.equal(request, "/api/buildings/seoul?bbox=126.970000,37.560000,126.990000,37.580000");
  assert.throws(() => buildSeoulBuildingRequest([126, 37, 128, 38]), /viewport/i);
});

test("turns S-MAP min/max elevations into measured building heights", () => {
  const input: Feature<Polygon | MultiPolygon>[] = [{
    type: "Feature",
    id: "footprint_w_minmax.43314",
    geometry: polygon,
    properties: { id: 120728, min: 28.9094524384, max: 48.2400016785 },
  }];
  const result = normalizeSeoulBuildings(input);
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties?.height, 19.33);
  assert.equal(result.features[0].properties?.minHeight, 0);
  assert.equal(result.features[0].properties?.heightEstimated, false);
  assert.equal(result.features[0].properties?.heightSource, "smap-2025-elevation-span");
  assert.equal(result.features[0].properties?.footprintSource, "smap-2025");
});

test("drops corrupt S-MAP records instead of inventing a precision height", () => {
  const input: Feature<Polygon | MultiPolygon>[] = [
    { type: "Feature", geometry: polygon, properties: { min: 30, max: 25 } },
    { type: "Feature", geometry: polygon, properties: { min: null, max: 40 } },
  ];
  assert.equal(normalizeSeoulBuildings(input).features.length, 0);
});
