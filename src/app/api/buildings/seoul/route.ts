import { NextRequest, NextResponse } from "next/server";
import type { Feature, MultiPolygon, Polygon } from "geojson";

export const runtime = "nodejs";
export const revalidate = 86_400;

const SMAP_PROXY = "https://smap.seoul.go.kr/imageProxy.do";
const LAYER = "seoul:footprint_w_minmax";
const MAX_FEATURES = 2_000;
const MAX_SPAN = 0.25;
const TARGET_CELL_SPAN = 0.012;
const MAX_GRID_AXIS = 6;

type Bounds = [number, number, number, number];
type SmapFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;
type WfsResponse = {
  type: "FeatureCollection";
  features?: SmapFeature[];
};

function parseBounds(value: string | null): Bounds | null {
  if (!value) return null;
  const values = value.split(",").map(Number);
  if (values.length !== 4 || values.some((coordinate) => !Number.isFinite(coordinate))) return null;
  const [west, south, east, north] = values;
  if (west >= east || south >= north || east - west > MAX_SPAN || north - south > MAX_SPAN) return null;
  return values as Bounds;
}

function wfsUrl(bounds: Bounds) {
  const param = new URL("https://smap.seoul.go.kr/geoserver/seoul/wfs");
  param.search = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: LAYER,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    maxFeatures: String(MAX_FEATURES),
    bbox: `${bounds.join(",")},EPSG:4326`,
  }).toString();
  const proxy = new URL(SMAP_PROXY);
  proxy.searchParams.set("svc", "2D");
  proxy.searchParams.set("param", `${param.pathname}${param.search}`);
  return proxy;
}

async function fetchCell(bounds: Bounds, signal: AbortSignal) {
  const response = await fetch(wfsUrl(bounds), {
    signal,
    headers: { Accept: "application/json", "User-Agent": "SunMapKorea/1.0" },
    next: { revalidate },
  });
  if (!response.ok) throw new Error(`S-MAP WFS ${response.status}`);
  const data = await response.json() as WfsResponse;
  return Array.isArray(data.features) ? data.features : [];
}

function splitBounds([west, south, east, north]: Bounds): Bounds[] {
  const columns = Math.min(MAX_GRID_AXIS, Math.max(1, Math.ceil((east - west) / TARGET_CELL_SPAN)));
  const rows = Math.min(MAX_GRID_AXIS, Math.max(1, Math.ceil((north - south) / TARGET_CELL_SPAN)));
  const longitudeStep = (east - west) / columns;
  const latitudeStep = (north - south) / rows;
  const cells: Bounds[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push([
        west + longitudeStep * column,
        south + latitudeStep * row,
        west + longitudeStep * (column + 1),
        south + latitudeStep * (row + 1),
      ]);
    }
  }
  return cells;
}

export async function GET(request: NextRequest) {
  const bounds = parseBounds(request.nextUrl.searchParams.get("bbox"));
  if (!bounds) return NextResponse.json({ error: "Invalid or oversized bbox" }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const cells = splitBounds(bounds);
    const features = (await Promise.all(cells.map((cell) => fetchCell(cell, controller.signal)))).flat();
    const unique = Array.from(new Map(features.map((feature) => [String(feature.id ?? feature.properties?.id), feature])).values());
    return NextResponse.json(
      { type: "FeatureCollection", features: unique, source: "Seoul S-MAP 2025" },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    const timeoutError = (error as Error).name === "AbortError";
    return NextResponse.json(
      { error: timeoutError ? "S-MAP request timed out" : "S-MAP data is temporarily unavailable" },
      { status: timeoutError ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
