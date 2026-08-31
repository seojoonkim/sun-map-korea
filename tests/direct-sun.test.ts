import assert from "node:assert/strict";
import test from "node:test";
import type { MultiPolygon, Polygon } from "geojson";
import { evaluateDirectSun, type SunPrism } from "../src/lib/analysis/direct-sun";

function rectangle(west: number, south: number, east: number, north: number): Polygon {
  return {
    type: "Polygon",
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };
}

function prism(
  id: string,
  geometry: Polygon | MultiPolygon,
  minZ = 0,
  maxZ = 20,
): SunPrism {
  return { id, geometry, minZ, maxZ };
}

const target = { x: 0, y: 0, z: 1.5 };

test("a building in the solar direction blocks while one behind does not", () => {
  const north = prism("north", rectangle(-2, 10, 2, 15));
  const result = evaluateDirectSun({ target, azimuth: 0, elevation: 30, buildings: [north] });
  assert.equal(result.state, "shade");
  assert.equal(result.blockerId, "north");
  assert.ok(result.distance && result.distance >= 10 && result.distance <= 15);

  assert.deepEqual(
    evaluateDirectSun({ target, azimuth: 180, elevation: 30, buildings: [north] }),
    { state: "sun" },
  );
});

test("a sufficiently high ray clears a low building", () => {
  const low = prism("low", rectangle(-2, 10, 2, 15), 0, 3);
  assert.deepEqual(
    evaluateDirectSun({ target, azimuth: 0, elevation: 45, buildings: [low] }),
    { state: "sun" },
  );
});

test("a ray can pass below an elevated structure or hit its vertical span", () => {
  const bridge = prism("bridge", rectangle(-2, 10, 2, 15), 15, 20);
  assert.deepEqual(
    evaluateDirectSun({ target, azimuth: 0, elevation: 10, buildings: [bridge] }),
    { state: "sun" },
  );
  assert.equal(
    evaluateDirectSun({ target, azimuth: 0, elevation: 45, buildings: [bridge] }).state,
    "shade",
  );
});

test("polygon holes remain open to sunlight", () => {
  const courtyard: Polygon = {
    type: "Polygon",
    coordinates: [
      [[-10, -10], [10, -10], [10, 25], [-10, 25], [-10, -10]],
      [[-2, -2], [2, -2], [2, 20], [-2, 20], [-2, -2]],
    ],
  };
  assert.deepEqual(
    evaluateDirectSun({ target, azimuth: 0, elevation: 80, buildings: [prism("court", courtyard, 0, 20)] }),
    { state: "sun" },
  );
});

test("concave polygons and multipolygons use the nearest actual blocker", () => {
  const concave: Polygon = {
    type: "Polygon",
    coordinates: [[[-8, 8], [-3, 8], [-3, 18], [-6, 18], [-6, 22], [-8, 22], [-8, 8]]],
  };
  const multi: MultiPolygon = {
    type: "MultiPolygon",
    coordinates: [rectangle(-2, 30, 2, 34).coordinates, rectangle(-2, 40, 2, 44).coordinates],
  };
  const result = evaluateDirectSun({
    target,
    azimuth: 0,
    elevation: 10,
    buildings: [prism("concave", concave, 0, 30), prism("multi", multi, 0, 40)],
  });
  assert.equal(result.blockerId, "multi");
});

test("near low blocker can be cleared while a farther tall blocker shades", () => {
  const result = evaluateDirectSun({
    target,
    azimuth: 0,
    elevation: 20,
    buildings: [
      prism("near-low", rectangle(-2, 5, 2, 7), 0, 2),
      prism("far-tall", rectangle(-2, 20, 2, 25), 0, 30),
    ],
  });
  assert.equal(result.blockerId, "far-tall");
});

test("excluded target building does not self-block", () => {
  const own = prism("own", rectangle(-5, -5, 5, 5), 0, 30);
  assert.deepEqual(
    evaluateDirectSun({ target, azimuth: 0, elevation: 20, buildings: [own], excludeBuildingIds: ["own"] }),
    { state: "sun" },
  );
});

test("facade direction rejects sun from the wall's rear hemisphere", () => {
  assert.equal(
    evaluateDirectSun({ target, azimuth: 180, elevation: 20, buildings: [], facadeAzimuth: 0 }).state,
    "behind-facade",
  );
  assert.equal(
    evaluateDirectSun({ target, azimuth: 359.9, elevation: 20, buildings: [], facadeAzimuth: 0 }).state,
    "sun",
  );
});

test("non-positive elevation is below the horizon", () => {
  assert.deepEqual(
    evaluateDirectSun({ target, azimuth: 0, elevation: 0, buildings: [] }),
    { state: "below-horizon" },
  );
});
