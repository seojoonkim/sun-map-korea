import assert from "node:assert/strict";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

const ZOOM = 14;
const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const SAMPLES = [
  { name: "Samjeon", lon: 127.088, lat: 37.504 },
  { name: "Busan", lon: 129.0756, lat: 35.1796 },
  { name: "Jeju", lon: 126.5312, lat: 33.4996 },
] as const;
const RADII_KM = [0.75, 3.5, 6.9] as const;

type TileJSON = { tiles?: string[] };
type Tile = { x: number; y: number };
type RawCache = Map<string, Uint8Array>;
type MemorySnapshot = ReturnType<typeof process.memoryUsage>;


export function lonLatToTile(lon: number, lat: number, zoom: number): [number, number] {
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = latitude * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale);
  return [x, y];
}

export function hasHeightInput(properties: Record<string, unknown>): boolean {
  const value = properties.render_height;
  return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
}

function selfTest() {
  assert.deepEqual(lonLatToTile(127.088, 37.504, 14), [13975, 6348]);
  assert.deepEqual(lonLatToTile(0, 0, 0), [0, 0]);
  assert.equal(hasHeightInput({ render_height: 12 }), true);
  assert.equal(hasHeightInput({ render_height: "12.5" }), true);
  assert.equal(hasHeightInput({ render_height: null }), false);
  assert.equal(hasHeightInput({ render_height: "" }), false);
  assert.equal(hasHeightInput({ render_height: 0 }), false);
  console.log("MVT parser assertions: PASS");
}

function tileUrl(template: string, tile: Tile) {
  return template.replace("{z}", String(ZOOM)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
}

function tilesForRadius(lon: number, lat: number, radiusKm: number): Tile[] {
  const latDelta = radiusKm / 110.574;
  const lonDelta = radiusKm / (111.320 * Math.cos(lat * Math.PI / 180));
  const [minX, maxY] = lonLatToTile(lon - lonDelta, lat - latDelta, ZOOM);
  const [maxX, minY] = lonLatToTile(lon + lonDelta, lat + latDelta, ZOOM);
  const result: Tile[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) result.push({ x, y });
  }
  return result;
}

async function mapLimit<T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function getRaw(template: string, tile: Tile, cache: RawCache) {
  const key = `${ZOOM}/${tile.x}/${tile.y}`;
  const cached = cache.get(key);
  if (cached) return { bytes: cached, cacheHit: true };
  const response = await fetch(tileUrl(template, tile), {
    headers: { Accept: "application/x-protobuf", "User-Agent": "SunMapKorea-feasibility/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenFreeMap tile ${key}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  cache.set(key, bytes);
  return { bytes, cacheHit: false };
}

function decodeBuildingTile(bytes: Uint8Array, tile: Tile, retainGeometry: boolean) {
  const vectorTile = new VectorTile(new Pbf(bytes));
  const layer = vectorTile.layers.building;
  if (!layer) return { count: 0, heightCount: 0, hiddenCount: 0, retained: [] as unknown[] };
  let heightCount = 0;
  let hiddenCount = 0;
  const retained: unknown[] = [];
  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index);
    if (hasHeightInput(feature.properties)) heightCount += 1;
    if (feature.properties.hide_3d === true || feature.properties.hide_3d === 1) hiddenCount += 1;
    if (retainGeometry) {
      const geojson = feature.toGeoJSON(tile.x, tile.y, ZOOM);
      retained.push({ id: feature.id, properties: feature.properties, geometry: geojson.geometry });
    }
  }
  return { count: layer.length, heightCount, hiddenCount, retained };
}

function memoryDelta(before: MemorySnapshot, after: MemorySnapshot) {
  const mib = (value: number) => Number((value / 1024 / 1024).toFixed(2));
  return {
    heapDeltaMiB: mib(after.heapUsed - before.heapUsed),
    rssDeltaMiB: mib(after.rss - before.rss),
    heapAfterMiB: mib(after.heapUsed),
    rssAfterMiB: mib(after.rss),
  };
}

async function collect(template: string, tiles: Tile[], cache: RawCache) {
  globalThis.gc?.();
  const before = process.memoryUsage();
  const started = performance.now();
  const decoded = await mapLimit(tiles, 12, async (tile) => {
    const raw = await getRaw(template, tile, cache);
    return { ...decodeBuildingTile(raw.bytes, tile, true), bytes: raw.bytes.byteLength, cacheHit: raw.cacheHit };
  });
  const after = process.memoryUsage();
  const buildingCount = decoded.reduce((sum, tile) => sum + tile.count, 0);
  const heightCount = decoded.reduce((sum, tile) => sum + tile.heightCount, 0);
  const hiddenCount = decoded.reduce((sum, tile) => sum + tile.hiddenCount, 0);
  const rawBytes = decoded.reduce((sum, tile) => sum + tile.bytes, 0);
  const retainedGeometryCount = decoded.reduce((sum, tile) => sum + tile.retained.length, 0);
  assert.equal(retainedGeometryCount, buildingCount, "Decode dropped retained building geometries");
  return {
    latencyMs: Math.round(performance.now() - started),
    tiles: tiles.length,
    networkRequests: decoded.filter((tile) => !tile.cacheHit).length,
    cacheHits: decoded.filter((tile) => tile.cacheHit).length,
    rawBytes,
    buildingCount,
    heightInputCount: heightCount,
    heightInputRate: buildingCount === 0 ? 0 : Number((heightCount / buildingCount).toFixed(4)),
    hidden3dCount: hiddenCount,
    memory: memoryDelta(before, after),
  };
}

async function main() {
  const metadataStarted = performance.now();
  const metadataResponse = await fetch(TILEJSON_URL, { signal: AbortSignal.timeout(30_000) });
  if (!metadataResponse.ok) throw new Error(`OpenFreeMap TileJSON: HTTP ${metadataResponse.status}`);
  const tilejson = await metadataResponse.json() as TileJSON;
  const template = tilejson.tiles?.[0];
  if (!template) throw new Error("OpenFreeMap TileJSON has no tile template");
  const metadataLatencyMs = Math.round(performance.now() - metadataStarted);

  const samples = [];
  for (const sample of SAMPLES) {
    const [x, y] = lonLatToTile(sample.lon, sample.lat, ZOOM);
    const raw = await getRaw(template, { x, y }, new Map());
    const decoded = decodeBuildingTile(raw.bytes, { x, y }, false);
    assert.ok(decoded.count > 0, `${sample.name} z14 tile has no building layer/features`);
    samples.push({
      name: sample.name,
      coordinates: [sample.lon, sample.lat],
      tile: `${ZOOM}/${x}/${y}`,
      bytes: raw.bytes.byteLength,
      buildingCount: decoded.count,
      heightInputCount: decoded.heightCount,
      heightInputRate: Number((decoded.heightCount / decoded.count).toFixed(4)),
      hidden3dCount: decoded.hiddenCount,
    });
  }

  const radiusBenchmarks = [];
  const samjeon = SAMPLES[0];
  for (const radiusKm of RADII_KM) {
    const tiles = tilesForRadius(samjeon.lon, samjeon.lat, radiusKm);
    const cache: RawCache = new Map();
    const cold = await collect(template, tiles, cache);
    const warm = await collect(template, tiles, cache);
    assert.equal(cold.networkRequests, tiles.length, "Cold run unexpectedly used the in-process cache");
    assert.equal(warm.cacheHits, tiles.length, "Warm run did not hit every in-process cached tile");
    assert.equal(cold.buildingCount, warm.buildingCount, "Cold/warm decode counts differ");
    radiusBenchmarks.push({ radiusKm, bboxShape: "square", cold, warm });
  }

  console.log(JSON.stringify({
    probe: "OpenFreeMap z14 building MVT",
    capturedAt: new Date().toISOString(),
    tilejson: TILEJSON_URL,
    tileTemplate: template,
    zoom: ZOOM,
    metadataLatencyMs,
    samples,
    radiusBenchmarkCenter: { name: samjeon.name, coordinates: [samjeon.lon, samjeon.lat] },
    radiusBenchmarks,
    warmDefinition: "same-process raw MVT byte cache; MVT is decoded and geometries retained again",
    memoryDefinition: "process.memoryUsage delta around fetch + decode + retained GeoJSON; run with --expose-gc for pre-run GC",
    assertions: "PASS",
  }, null, 2));
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
