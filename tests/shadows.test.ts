import assert from "node:assert/strict";
import test from "node:test";
import type { MultiPolygon, Polygon } from "geojson";
import {
  createWallShadowSegments,
  DEFAULT_BUILDING_HEIGHT,
  normalizeBuildingFeatures,
  shadowOpacityForElevation,
} from "../src/lib/shadows";

const square: Polygon = {
  type: "Polygon",
  coordinates: [[[127, 37.5], [127.001, 37.5], [127.001, 37.501], [127, 37.501], [127, 37.5]]],
};

function feature(properties: Record<string, unknown>, geometry: Polygon | MultiPolygon = square) {
  return { properties, geometry };
}

test("uses a conservative default for footprints without a height", () => {
  const result = normalizeBuildingFeatures([feature({})]);
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties?.height, DEFAULT_BUILDING_HEIGHT);
  assert.equal(result.features[0].properties?.minHeight, 0);
  assert.equal(result.features[0].properties?.heightEstimated, true);
});

test("keeps real height and minimum height when supplied", () => {
  const result = normalizeBuildingFeatures([feature({ render_height: 42, render_min_height: 6 })]);
  assert.equal(result.features[0].properties?.height, 42);
  assert.equal(result.features[0].properties?.minHeight, 6);
  assert.equal(result.features[0].properties?.heightEstimated, false);
});

test("uses Overture floors and snake-case minimum height before the generic fallback", () => {
  const result = normalizeBuildingFeatures([feature({ num_floors: 7, min_height: 3, footprintSource: "overture" })]);
  assert.equal(result.features[0].properties?.height, 21);
  assert.equal(result.features[0].properties?.minHeight, 3);
  assert.equal(result.features[0].properties?.heightEstimated, true);
  assert.equal(result.features[0].properties?.source, "overture");
});

test("falls back for non-positive heights and excludes explicitly hidden buildings", () => {
  const result = normalizeBuildingFeatures([
    feature({ render_height: 0 }),
    feature({ hide_3d: true, render_height: 30 }),
  ]);
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties?.height, DEFAULT_BUILDING_HEIGHT);
});

test("makes shadows faint near sunrise and darkest around solar noon", () => {
  const sunrise = shadowOpacityForElevation(2);
  const morning = shadowOpacityForElevation(25);
  const noon = shadowOpacityForElevation(70);

  assert.equal(shadowOpacityForElevation(0), 0);
  assert.ok(sunrise >= 0.18 && sunrise <= 0.3);
  assert.ok(sunrise < morning);
  assert.ok(morning < noon);
  assert.ok(noon <= 0.78);
});

test("a tall sunward building splits the receiver wall into shadow and light", () => {
  const receiver: Polygon = {
    type: "Polygon",
    coordinates: [[[127, 37.5], [127.00012, 37.5], [127.00012, 37.50012], [127, 37.50012], [127, 37.5]]],
  };
  const blocker: Polygon = {
    type: "Polygon",
    coordinates: [[[127.00045, 37.5], [127.00057, 37.5], [127.00057, 37.50012], [127.00045, 37.50012], [127.00045, 37.5]]],
  };
  const buildings = normalizeBuildingFeatures([
    feature({ render_height: 40 }, receiver),
    feature({ render_height: 80 }, blocker),
  ]);

  const segments = createWallShadowSegments(buildings, 90, 30);
  const receiverSegments = segments.features.filter((item) => item.properties.sourceHeight === 40);

  assert.deepEqual(receiverSegments.map((item) => item.properties.wallShade).sort(), ["occluded", "sunlit"]);
  const shadow = receiverSegments.find((item) => item.properties.wallShade === "occluded")!;
  assert.ok(shadow.properties.segmentHeight > 2);
  assert.ok(shadow.properties.height < 40);
});

test("wall shadow rendering preserves valid buildings shorter than the fallback", () => {
  const buildings = normalizeBuildingFeatures([feature({ render_height: 4 })]);

  const segments = createWallShadowSegments(buildings, 180, 45);

  assert.equal(segments.features.length, 1);
  assert.equal(segments.features[0].properties.sourceHeight, 4);
  assert.equal(segments.features[0].properties.segmentHeight, 4);
});
