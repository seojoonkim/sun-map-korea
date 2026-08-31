import assert from "node:assert/strict";
import test from "node:test";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  normalizeOpenFreeMapBuilding,
  normalizeSmapBuilding,
  summarizeBuildingQuality,
} from "../src/lib/buildings/quality";

const polygon: Polygon = {
  type: "Polygon",
  coordinates: [
    [[127, 37.5], [127.001, 37.5], [127.001, 37.501], [127, 37.501], [127, 37.5]],
    [[127.0002, 37.5002], [127.0004, 37.5002], [127.0004, 37.5004], [127.0002, 37.5004], [127.0002, 37.5002]],
  ],
};

const multiPolygon: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [polygon.coordinates],
};

function feature(
  id: string | number | undefined,
  properties: Record<string, unknown>,
  geometry: Polygon | MultiPolygon = polygon,
): Feature<Polygon | MultiPolygon, Record<string, unknown>> {
  return { type: "Feature", id, properties, geometry };
}

test("S-MAP preserves valid absolute min/max heights and geometry holes", () => {
  const result = normalizeSmapBuilding(feature("42", { min: 18.5, max: 47.25 }));
  assert.ok(result);
  assert.equal(result.id, "smap-2025:42");
  assert.equal(result.minHeight, 0);
  assert.equal(result.height, 28.75);
  assert.equal(result.groundElevation, 18.5);
  assert.equal(result.topElevation, 47.25);
  assert.equal(result.heightQuality, "surveyed");
  assert.equal(result.footprintSource, "smap-2025");
  assert.deepEqual(result.geometry, polygon);
});

test("S-MAP rejects invalid or physically implausible height ranges", () => {
  assert.equal(normalizeSmapBuilding(feature("a", { min: 20, max: 20 })), null);
  assert.equal(normalizeSmapBuilding(feature("b", { min: 20, max: 19 })), null);
  assert.equal(normalizeSmapBuilding(feature("c", { min: 20, max: 20.2 })), null);
  assert.equal(normalizeSmapBuilding(feature("d", { min: "NaN", max: 30 })), null);
});

test("OpenFreeMap assigns explicit, floor-estimated, and default quality grades", () => {
  const tagged = normalizeOpenFreeMapBuilding(feature("1", { render_height: 24, render_min_height: 3 }));
  const floors = normalizeOpenFreeMapBuilding(feature("2", { num_floors: 7 }));
  const fallback = normalizeOpenFreeMapBuilding(feature("3", {}, multiPolygon));

  assert.ok(tagged && floors && fallback);
  assert.deepEqual(
    [tagged.height, tagged.minHeight, tagged.heightQuality],
    [24, 3, "tagged"],
  );
  assert.deepEqual(
    [floors.height, floors.minHeight, floors.heightQuality],
    [21, 0, "floors-estimated"],
  );
  assert.deepEqual(
    [fallback.height, fallback.minHeight, fallback.heightQuality],
    [9, 0, "default-estimated"],
  );
  assert.deepEqual(fallback.geometry, multiPolygon);
});

test("source namespaces prevent identical upstream IDs from colliding", () => {
  const smap = normalizeSmapBuilding(feature("same", { min: 10, max: 25 }));
  const osm = normalizeOpenFreeMapBuilding(feature("same", { render_height: 15 }));
  assert.ok(smap && osm);
  assert.notEqual(smap.id, osm.id);
});

test("quality summary reports the estimated-height ratio", () => {
  const buildings = [
    normalizeOpenFreeMapBuilding(feature("1", { render_height: 12 })),
    normalizeOpenFreeMapBuilding(feature("2", { num_floors: 4 })),
    normalizeOpenFreeMapBuilding(feature("3", {})),
  ].filter((building) => building !== null);

  assert.deepEqual(summarizeBuildingQuality(buildings), {
    featureCount: 3,
    estimatedHeightCount: 2,
    estimatedHeightRatio: 2 / 3,
  });
});
