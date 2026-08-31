import assert from "node:assert/strict";
import test from "node:test";
import { createLocalProjector, projectAnalysisBuildings } from "../src/lib/analysis/local-coordinates";
import type { AnalysisBuilding } from "../src/lib/buildings/types";

const origin: [number, number] = [127.088, 37.504];

test("local projection maps longitude east and latitude north in meters", () => {
  const projector = createLocalProjector(origin);
  const east = projector.project([127.089, 37.504]);
  const north = projector.project([127.088, 37.505]);
  assert.ok(Math.abs(east[0] - 88.3) < 0.5);
  assert.ok(Math.abs(east[1]) < 0.01);
  assert.ok(Math.abs(north[1] - 111.2) < 0.5);
  assert.ok(Math.abs(north[0]) < 0.01);
  assert.ok(Math.hypot(...projector.project(projector.unproject([500, -300]))) - Math.hypot(500, -300) < 0.01);
});

test("analysis buildings become local prisms without losing polygon holes", () => {
  const building: AnalysisBuilding = {
    id: "smap-2025:1",
    geometry: {
      type: "Polygon",
      coordinates: [
        [[127.088, 37.504], [127.089, 37.504], [127.089, 37.505], [127.088, 37.505], [127.088, 37.504]],
        [[127.0882, 37.5042], [127.0884, 37.5042], [127.0884, 37.5044], [127.0882, 37.5044], [127.0882, 37.5042]],
      ],
    },
    height: 20,
    minHeight: 3,
    heightQuality: "surveyed",
    footprintSource: "smap-2025",
  };
  const [prism] = projectAnalysisBuildings([building], origin);
  assert.equal(prism.id, building.id);
  assert.equal(prism.minZ, 3);
  assert.equal(prism.maxZ, 20);
  assert.equal(prism.geometry.type, "Polygon");
  assert.equal(prism.geometry.coordinates.length, 2);
  assert.deepEqual(prism.geometry.coordinates[0][0], [0, 0]);
});
