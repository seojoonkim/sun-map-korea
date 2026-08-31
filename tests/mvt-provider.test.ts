import assert from "node:assert/strict";
import test from "node:test";
import Pbf from "pbf";
import {
  createOpenFreeMapMvtProvider,
  OPENFREEMAP_TILEJSON_URL,
} from "../src/lib/buildings/mvt-provider";
import { tileBounds, tilesForBounds } from "../src/lib/buildings/tile-math";
import type { BuildingBounds, BuildingQuery } from "../src/lib/buildings/types";

const ZOOM = 14;
const EXTENT = 4096;

type TestFeature = {
  id?: number;
  properties?: Record<string, string | number | boolean>;
  rings: [number, number][][];
};

type EncodedLayer = {
  keys: string[];
  values: Array<string | number | boolean>;
  features: Array<{ id?: number; tags: number[]; geometry: number[] }>;
};

function zigzag(value: number): number {
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function encodeGeometry(rings: [number, number][][]): number[] {
  const commands: number[] = [];
  let cursorX = 0;
  let cursorY = 0;
  for (const ring of rings) {
    assert.ok(ring.length >= 3);
    const points = ring.at(-1)?.[0] === ring[0][0] && ring.at(-1)?.[1] === ring[0][1]
      ? ring.slice(0, -1)
      : ring;
    commands.push(9, zigzag(points[0][0] - cursorX), zigzag(points[0][1] - cursorY));
    cursorX = points[0][0];
    cursorY = points[0][1];
    commands.push((points.length - 1) * 8 + 2);
    for (const [x, y] of points.slice(1)) {
      commands.push(zigzag(x - cursorX), zigzag(y - cursorY));
      cursorX = x;
      cursorY = y;
    }
    commands.push(15);
  }
  return commands;
}

function encodeTile(features: TestFeature[]): Uint8Array {
  const keys: string[] = [];
  const values: Array<string | number | boolean> = [];
  const keyIndex = new Map<string, number>();
  const valueIndex = new Map<string, number>();
  const encodedFeatures = features.map((feature) => {
    const tags: number[] = [];
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      let keyPosition = keyIndex.get(key);
      if (keyPosition === undefined) {
        keyPosition = keys.length;
        keyIndex.set(key, keyPosition);
        keys.push(key);
      }
      const valueKey = `${typeof value}:${String(value)}`;
      let valuePosition = valueIndex.get(valueKey);
      if (valuePosition === undefined) {
        valuePosition = values.length;
        valueIndex.set(valueKey, valuePosition);
        values.push(value);
      }
      tags.push(keyPosition, valuePosition);
    }
    return { id: feature.id, tags, geometry: encodeGeometry(feature.rings) };
  });
  const layer: EncodedLayer = { keys, values, features: encodedFeatures };
  const pbf = new Pbf();
  pbf.writeMessage(3, writeLayer, layer);
  return pbf.finish();
}

function writeValue(value: string | number | boolean, pbf: Pbf): void {
  if (typeof value === "string") pbf.writeStringField(1, value);
  else if (typeof value === "boolean") pbf.writeBooleanField(7, value);
  else pbf.writeDoubleField(3, value);
}

function writeFeature(feature: EncodedLayer["features"][number], pbf: Pbf): void {
  if (feature.id !== undefined) pbf.writeVarintField(1, feature.id);
  pbf.writePackedVarint(2, feature.tags);
  pbf.writeVarintField(3, 3);
  pbf.writePackedVarint(4, feature.geometry);
}

function writeLayer(layer: EncodedLayer, pbf: Pbf): void {
  pbf.writeVarintField(15, 2);
  pbf.writeStringField(1, "building");
  for (const feature of layer.features) pbf.writeMessage(2, writeFeature, feature);
  for (const key of layer.keys) pbf.writeStringField(3, key);
  for (const value of layer.values) pbf.writeMessage(4, writeValue, value);
  pbf.writeVarintField(5, EXTENT);
}

function query(bounds: BuildingBounds): BuildingQuery {
  return { bounds, purpose: "comparison", minimumSunElevation: 5 };
}

function tileJson(tiles = ["https://tiles.test/{z}/{x}/{y}.pbf"]): Response {
  return Response.json({ tilejson: "3.0.0", name: "OpenFreeMap planet", tiles });
}

function responseBody(bytes: Uint8Array | undefined): ArrayBuffer | undefined {
  if (!bytes) return undefined;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function tileKeyFromUrl(input: RequestInfo | URL): string {
  const match = String(input).match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
  assert.ok(match, `unexpected tile URL: ${String(input)}`);
  return `${match[1]}/${match[2]}/${match[3]}`;
}

function allCoordinates(value: unknown, result: [number, number][] = []): [number, number][] {
  if (!Array.isArray(value)) return result;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    result.push([value[0], value[1]]);
  } else {
    for (const child of value) allCoordinates(child, result);
  }
  return result;
}

test("tile math enumerates every z14 tile intersecting a bbox in stable row-major order", () => {
  const first = tileBounds(13975, 6348, ZOOM);
  const second = tileBounds(13976, 6348, ZOOM);
  const bounds: BuildingBounds = [first[0] + 0.001, first[1] + 0.001, second[2] - 0.001, first[3] - 0.001];

  assert.deepEqual(tilesForBounds(bounds, ZOOM).map(({ key }) => key), [
    "14/13975/6348",
    "14/13976/6348",
  ]);
});

test("decodes with the correct z/x/y, clips to the analysis bbox, and namespaces local IDs by tile", async () => {
  const left = { z: ZOOM, x: 13975, y: 6348, key: "14/13975/6348" };
  const right = { z: ZOOM, x: 13976, y: 6348, key: "14/13976/6348" };
  const leftBounds = tileBounds(left.x, left.y, left.z);
  const rightBounds = tileBounds(right.x, right.y, right.z);
  const bounds: BuildingBounds = [leftBounds[2] - 0.001, leftBounds[1] + 0.001, rightBounds[0] + 0.001, leftBounds[3] - 0.001];
  const requests: string[] = [];
  const bytes = new Map<string, Uint8Array>([
    [left.key, encodeTile([
      { id: 7, properties: { render_height: 24, render_min_height: 3 }, rings: [[[3800, 900], [3800, 1500], [4300, 1500], [4300, 900]]]},
      { id: 8, properties: { hide_3d: 1 }, rings: [[[3900, 1600], [3900, 1800], [4050, 1800], [4050, 1600]]]},
      { id: 9, rings: [[[100, 100], [100, 300], [300, 300], [300, 100]]]},
    ])],
    [right.key, encodeTile([
      { id: 7, properties: { num_floors: 4 }, rings: [[[-100, 2000], [-100, 2400], [250, 2400], [250, 2000]]]},
    ])],
  ]);
  const fetcher: typeof fetch = async (input, init) => {
    assert.ok(init?.signal === undefined);
    requests.push(String(input));
    if (String(input) === OPENFREEMAP_TILEJSON_URL) return tileJson();
    const key = tileKeyFromUrl(input);
    return new Response(responseBody(bytes.get(key)), { status: bytes.has(key) ? 200 : 404 });
  };

  const result = await createOpenFreeMapMvtProvider({ fetch: fetcher }).getBuildings(query(bounds));

  assert.deepEqual(requests.slice(1).map(tileKeyFromUrl), [left.key, right.key]);
  assert.equal(result.buildings.length, 2);
  assert.deepEqual(result.buildings.map(({ id }) => id), [
    "openfreemap-osm:14/13975/6348:7",
    "openfreemap-osm:14/13976/6348:7",
  ]);
  assert.deepEqual(result.buildings.map(({ height, minHeight, heightQuality }) => [height, minHeight, heightQuality]), [
    [24, 3, "tagged"],
    [12, 0, "floors-estimated"],
  ]);
  for (const building of result.buildings) {
    for (const [lon, lat] of allCoordinates(building.geometry.coordinates)) {
      assert.ok(lon >= bounds[0] && lon <= bounds[2], `${lon} outside longitude bounds`);
      assert.ok(lat >= bounds[1] && lat <= bounds[3], `${lat} outside latitude bounds`);
    }
  }
  assert.equal(result.meta.complete, true);
  assert.equal(result.meta.provider, "openfreemap");
  assert.equal(result.meta.sourceVersion, "OpenFreeMap planet z14");
  assert.equal(result.meta.featureCount, 2);
  assert.equal(result.meta.estimatedHeightRatio, 0.5);
  assert.deepEqual(result.meta.requestedBounds, bounds);
  assert.deepEqual(result.meta.coveredBounds, bounds);
  assert.deepEqual(result.meta.truncatedCells, []);
});

test("deduplicates id-less exact geometries by deterministic hash but preserves cross-tile local-ID fragments", async () => {
  const leftX = 13975;
  const y = 6348;
  const leftBounds = tileBounds(leftX, y, ZOOM);
  const rightBounds = tileBounds(leftX + 1, y, ZOOM);
  const bounds: BuildingBounds = [leftBounds[2] - 0.002, leftBounds[1], rightBounds[0] + 0.002, leftBounds[3]];
  const duplicateLeft: TestFeature = { properties: { render_height: 10 }, rings: [[[4000, 1000], [4000, 1400], [4200, 1400], [4200, 1000]]] };
  const duplicateRight: TestFeature = { properties: { render_height: 10 }, rings: [[[-96, 1000], [-96, 1400], [104, 1400], [104, 1000]]] };
  const tileBytes = new Map([
    [`14/${leftX}/${y}`, encodeTile([duplicateLeft, { id: 5, rings: [[[3900, 2000], [3900, 2200], [4200, 2200], [4200, 2000]]]}])],
    [`14/${leftX + 1}/${y}`, encodeTile([duplicateRight, { id: 5, rings: [[[-196, 2000], [-196, 2200], [104, 2200], [104, 2000]]]}])],
  ]);
  const fetcher: typeof fetch = async (input) => String(input) === OPENFREEMAP_TILEJSON_URL
    ? tileJson()
    : new Response(responseBody(tileBytes.get(tileKeyFromUrl(input))));

  const result = await createOpenFreeMapMvtProvider({ fetch: fetcher }).getBuildings(query(bounds));

  assert.equal(result.buildings.length, 3);
  const hashed = result.buildings.filter(({ id }) => id.includes(":geometry:"));
  assert.equal(hashed.length, 1);
  assert.match(hashed[0].id, /^openfreemap-osm:geometry:[0-9a-f]{16}$/);
  assert.equal(result.buildings.filter(({ id }) => id.endsWith(":5")).length, 2);
});

test("keeps successful tiles and reports failed tile keys as incomplete coverage", async () => {
  const x = 13975;
  const y = 6348;
  const leftBounds = tileBounds(x, y, ZOOM);
  const rightBounds = tileBounds(x + 1, y, ZOOM);
  const bounds: BuildingBounds = [leftBounds[0], leftBounds[1], rightBounds[2] - 0.000001, leftBounds[3]];
  const fetcher: typeof fetch = async (input) => {
    if (String(input) === OPENFREEMAP_TILEJSON_URL) return tileJson();
    const key = tileKeyFromUrl(input);
    if (key === `14/${x + 1}/${y}`) return new Response("down", { status: 503 });
    return new Response(responseBody(encodeTile([{ id: 1, rings: [[[100, 100], [100, 300], [300, 300], [300, 100]]] }])));
  };

  const result = await createOpenFreeMapMvtProvider({ fetch: fetcher }).getBuildings(query(bounds));

  assert.equal(result.buildings.length, 1);
  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.truncatedCells, [`14/${x + 1}/${y}`]);
  assert.match(result.meta.warnings.join(" "), new RegExp(`14/${x + 1}/${y}.*503`));
});

test("turns TileJSON failure into incomplete metadata covering every requested tile", async () => {
  const bounds = tileBounds(13975, 6348, ZOOM);
  const fetcher: typeof fetch = async () => new Response("down", { status: 502 });

  const result = await createOpenFreeMapMvtProvider({ fetch: fetcher }).getBuildings(query(bounds));

  assert.deepEqual(result.buildings, []);
  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.truncatedCells, ["14/13975/6348"]);
  assert.match(result.meta.warnings.join(" "), /TileJSON.*502/i);
});

test("propagates caller aborts to TileJSON and tile requests", async (t) => {
  await t.test("TileJSON", async () => {
    const controller = new AbortController();
    const fetcher: typeof fetch = async (_input, init) => {
      assert.equal(init?.signal, controller.signal);
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };
    await assert.rejects(
      createOpenFreeMapMvtProvider({ fetch: fetcher }).getBuildings(query(tileBounds(13975, 6348, ZOOM)), controller.signal),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
  });

  await t.test("tile", async () => {
    const controller = new AbortController();
    const fetcher: typeof fetch = async (input, init) => {
      assert.equal(init?.signal, controller.signal);
      if (String(input) === OPENFREEMAP_TILEJSON_URL) return tileJson();
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };
    await assert.rejects(
      createOpenFreeMapMvtProvider({ fetch: fetcher }).getBuildings(query(tileBounds(13975, 6348, ZOOM)), controller.signal),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
  });
});
