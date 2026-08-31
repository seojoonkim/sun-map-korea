import { VectorTile } from "@mapbox/vector-tile";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import Pbf from "pbf";
import { normalizeOpenFreeMapBuilding, summarizeBuildingQuality } from "./quality";
import { tilesForBounds, type SlippyTile } from "./tile-math";
import type {
  AnalysisBuilding,
  BuildingBounds,
  BuildingProvider,
  BuildingQuery,
  BuildingQueryMeta,
} from "./types";

const ZOOM = 14;
const DEFAULT_CONCURRENCY = 8;
const SOURCE_VERSION = "OpenFreeMap planet z14";
export const OPENFREEMAP_TILEJSON_URL = "https://tiles.openfreemap.org/planet";

type OpenFreeMapFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;
type TileJson = { tiles?: unknown; name?: unknown };
type TileResult = { tile: SlippyTile; features: OpenFreeMapFeature[]; warning?: string };

type OpenFreeMapMvtProviderOptions = {
  fetch: typeof fetch;
  concurrency?: number;
  tileJsonUrl?: string;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tileUrl(template: string, tile: SlippyTile): string {
  return template
    .replaceAll("{z}", String(tile.z))
    .replaceAll("{x}", String(tile.x))
    .replaceAll("{y}", String(tile.y));
}

async function readTileJson(fetchImpl: typeof fetch, url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchImpl(url, {
    signal,
    headers: { Accept: "application/json", "User-Agent": "SunMapKorea/1.0" },
  });
  if (!response.ok) throw new Error(`OpenFreeMap TileJSON HTTP ${response.status}`);
  let data: TileJson;
  try {
    data = await response.json() as TileJson;
  } catch {
    throw new Error("OpenFreeMap TileJSON was not valid JSON");
  }
  if (!Array.isArray(data.tiles) || typeof data.tiles[0] !== "string" || data.tiles[0].length === 0) {
    throw new Error("OpenFreeMap TileJSON has no tile template");
  }
  return data.tiles[0];
}

async function mapLimit<T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function clipAgainstBoundary(
  points: Position[],
  inside: (point: Position) => boolean,
  intersect: (start: Position, end: Position) => Position,
): Position[] {
  if (points.length === 0) return [];
  const output: Position[] = [];
  let start = points[points.length - 1];
  for (const end of points) {
    const startInside = inside(start);
    const endInside = inside(end);
    if (endInside) {
      if (!startInside) output.push(intersect(start, end));
      output.push(end);
    } else if (startInside) {
      output.push(intersect(start, end));
    }
    start = end;
  }
  return output;
}

function verticalIntersection(longitude: number, start: Position, end: Position): Position {
  const ratio = (longitude - start[0]) / (end[0] - start[0]);
  return [longitude, start[1] + (end[1] - start[1]) * ratio];
}

function horizontalIntersection(latitude: number, start: Position, end: Position): Position {
  const ratio = (latitude - start[1]) / (end[1] - start[1]);
  return [start[0] + (end[0] - start[0]) * ratio, latitude];
}

function ringArea(points: Position[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return area / 2;
}

function clipRing(ring: Position[], bounds: BuildingBounds): Position[] | null {
  let points = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : [...ring];
  points = clipAgainstBoundary(points, ([x]) => x >= bounds[0], (start, end) => verticalIntersection(bounds[0], start, end));
  points = clipAgainstBoundary(points, ([x]) => x <= bounds[2], (start, end) => verticalIntersection(bounds[2], start, end));
  points = clipAgainstBoundary(points, ([, y]) => y >= bounds[1], (start, end) => horizontalIntersection(bounds[1], start, end));
  points = clipAgainstBoundary(points, ([, y]) => y <= bounds[3], (start, end) => horizontalIntersection(bounds[3], start, end));
  if (points.length < 3 || Math.abs(ringArea(points)) < Number.EPSILON) return null;
  return [...points, [...points[0]]];
}

function clipPolygon(rings: Position[][], bounds: BuildingBounds): Position[][] | null {
  const outer = clipRing(rings[0] ?? [], bounds);
  if (!outer) return null;
  const clipped: Position[][] = [outer];
  for (const hole of rings.slice(1)) {
    const clippedHole = clipRing(hole, bounds);
    if (clippedHole) clipped.push(clippedHole);
  }
  return clipped;
}

function clipGeometry(
  geometry: Polygon | MultiPolygon,
  bounds: BuildingBounds,
): Polygon | MultiPolygon | null {
  if (geometry.type === "Polygon") {
    const coordinates = clipPolygon(geometry.coordinates, bounds);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }
  const coordinates = geometry.coordinates.flatMap((polygon) => {
    const clipped = clipPolygon(polygon, bounds);
    return clipped ? [clipped] : [];
  });
  return coordinates.length > 0 ? { type: "MultiPolygon", coordinates } : null;
}

function hashGeometry(geometry: Polygon | MultiPolygon): string {
  const text = JSON.stringify(geometry);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return first.toString(16).padStart(8, "0") + second.toString(16).padStart(8, "0");
}

function decodeTile(bytes: Uint8Array, tile: SlippyTile, bounds: BuildingBounds): OpenFreeMapFeature[] {
  const vectorTile = new VectorTile(new Pbf(bytes));
  const layer = vectorTile.layers.building;
  if (!layer) return [];
  const features: OpenFreeMapFeature[] = [];
  for (let index = 0; index < layer.length; index += 1) {
    const raw = layer.feature(index);
    if (raw.properties.hide_3d === true || raw.properties.hide_3d === 1) continue;
    const decoded = raw.toGeoJSON(tile.x, tile.y, tile.z);
    if (decoded.geometry.type !== "Polygon" && decoded.geometry.type !== "MultiPolygon") continue;
    const geometry = clipGeometry(decoded.geometry, bounds);
    if (!geometry) continue;
    const upstreamId = raw.id ?? raw.properties.id;
    features.push({
      type: "Feature",
      id: upstreamId === undefined ? `geometry:${hashGeometry(geometry)}` : `${tile.key}:${String(upstreamId)}`,
      properties: { ...raw.properties },
      geometry,
    });
  }
  return features;
}

function metadata(
  query: BuildingQuery,
  buildings: AnalysisBuilding[],
  truncatedCells: string[],
  warnings: string[],
): BuildingQueryMeta {
  const quality = summarizeBuildingQuality(buildings);
  return {
    complete: truncatedCells.length === 0,
    provider: "openfreemap",
    requestedBounds: [...query.bounds],
    coveredBounds: [...query.bounds],
    sourceVersion: SOURCE_VERSION,
    featureCount: quality.featureCount,
    truncatedCells,
    estimatedHeightRatio: quality.estimatedHeightRatio,
    warnings,
  };
}

export function createOpenFreeMapMvtProvider({
  fetch: fetchImpl,
  concurrency = DEFAULT_CONCURRENCY,
  tileJsonUrl = OPENFREEMAP_TILEJSON_URL,
}: OpenFreeMapMvtProviderOptions): BuildingProvider {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("concurrency must be a positive integer");
  }

  return {
    async getBuildings(query, signal) {
      const tiles = tilesForBounds(query.bounds, ZOOM);
      let template: string;
      try {
        template = await readTileJson(fetchImpl, tileJsonUrl, signal);
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw error;
        const warnings = [errorMessage(error)];
        return { buildings: [], meta: metadata(query, [], tiles.map(({ key }) => key), warnings) };
      }

      const results = await mapLimit(tiles, concurrency, async (tile): Promise<TileResult> => {
        try {
          const response = await fetchImpl(tileUrl(template, tile), {
            signal,
            headers: { Accept: "application/x-protobuf", "User-Agent": "SunMapKorea/1.0" },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          return { tile, features: decodeTile(bytes, tile, query.bounds) };
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) throw error;
          return { tile, features: [], warning: `OpenFreeMap tile ${tile.key}: ${errorMessage(error)}` };
        }
      });

      const warnings = results.flatMap(({ warning }) => warning ? [warning] : []);
      const truncatedCells = results.flatMap(({ tile, warning }) => warning ? [tile.key] : []);
      const uniqueFeatures = new Map<string, OpenFreeMapFeature>();
      for (const feature of results.flatMap(({ features }) => features)) {
        const key = String(feature.id);
        if (!uniqueFeatures.has(key)) uniqueFeatures.set(key, feature);
      }
      const buildings = Array.from(uniqueFeatures.values()).flatMap((feature) => {
        const building = normalizeOpenFreeMapBuilding(feature);
        return building ? [building] : [];
      });
      return { buildings, meta: metadata(query, buildings, truncatedCells, warnings) };
    },
  };
}
