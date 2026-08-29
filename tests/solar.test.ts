import test from "node:test";
import assert from "node:assert/strict";
import { dateAtKst, daylightHours, formatMinutes, getSolarPosition, seasonalDate } from "../src/lib/solar";
import { createBuildingShadows, normalizeBuildingFeatures, createShadowFan } from "../src/lib/shadows";

test("KST date conversion and time formatting are deterministic", () => {
  assert.equal(dateAtKst("2026-06-21", 720).toISOString(), "2026-06-21T03:00:00.000Z");
  assert.equal(formatMinutes(375), "06:15");
  assert.equal(formatMinutes(1440), "00:00");
});

test("summer noon in Gangnam has a high daylight sun", () => {
  const sun = getSolarPosition(dateAtKst("2026-06-21", 12 * 60 + 30), 37.49794, 127.02761);
  assert.equal(sun.isDaylight, true);
  assert.ok(sun.elevation > 70 && sun.elevation < 80);
  assert.ok(sun.azimuth > 160 && sun.azimuth < 220);
});

test("shadow fan is hidden at night and points away during day", () => {
  assert.equal(createShadowFan([127.02, 37.49], 180, -5).features.length, 0);
  const fan = createShadowFan([127.02, 37.49], 180, 45);
  assert.equal(fan.features.length, 5);
  assert.equal(fan.features[0].geometry.type, "Polygon");
});

test("OSM building features preserve real footprints and rendered heights for shadows", () => {
  const raw = [
    {
      type: "Feature" as const,
      properties: { render_height: 42.5, render_min_height: 3 },
      geometry: { type: "Polygon" as const, coordinates: [[[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001], [127, 37]]] },
    },
    {
      type: "Feature" as const,
      properties: { render_height: 18 },
      geometry: { type: "MultiPolygon" as const, coordinates: [
        [[[127.002, 37], [127.003, 37], [127.003, 37.001], [127.002, 37.001], [127.002, 37]]],
        [[[127.004, 37], [127.005, 37], [127.005, 37.001], [127.004, 37.001], [127.004, 37]]],
      ] },
    },
    {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [[[127.01, 37], [127.011, 37], [127.011, 37.001], [127.01, 37]]] },
    },
  ];

  const buildings = normalizeBuildingFeatures(raw);
  assert.equal(buildings.features.length, 3);
  assert.equal(buildings.features[0].properties?.height, 42.5);
  assert.equal(buildings.features[0].properties?.minHeight, 3);
  assert.deepEqual(buildings.features[0].geometry.coordinates, raw[0].geometry.coordinates);
  assert.ok(buildings.features.every((feature) => Number(feature.properties?.height) > 0));

  const noon = createBuildingShadows(buildings, 180, 55);
  const evening = createBuildingShadows(buildings, 260, 12);
  assert.equal(noon.features.length, buildings.features.length);
  assert.equal(evening.features.length, buildings.features.length);
  assert.notDeepEqual(noon.features[0].geometry.coordinates, evening.features[0].geometry.coordinates);
  assert.ok(Number(evening.features[0].properties?.shadowLength) > Number(noon.features[0].properties?.shadowLength));
  assert.equal(createBuildingShadows(buildings, 180, -2).features.length, 0);
});

test("calendar helpers preserve expected values", () => {
  assert.equal(seasonalDate(2026, "winter"), "2026-12-21");
  assert.equal(daylightHours(new Date(0), new Date(36_000_000)), 10);
});
