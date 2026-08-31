import { NextRequest, NextResponse } from "next/server";
import { createSmapProvider } from "@/lib/buildings/smap-provider";
import type { BuildingBounds } from "@/lib/buildings/types";

export const runtime = "nodejs";
export const revalidate = 86_400;

const MAX_SPAN = 0.25;
type Bounds = BuildingBounds;

function parseBounds(value: string | null): Bounds | null {
  if (!value) return null;
  const values = value.split(",").map(Number);
  if (values.length !== 4 || values.some((coordinate) => !Number.isFinite(coordinate))) return null;
  const [west, south, east, north] = values;
  if (west >= east || south >= north || east - west > MAX_SPAN || north - south > MAX_SPAN) return null;
  return values as Bounds;
}

export async function GET(request: NextRequest) {
  const bounds = parseBounds(request.nextUrl.searchParams.get("bbox"));
  if (!bounds) return NextResponse.json({ error: "Invalid or oversized bbox" }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const provider = createSmapProvider({ fetch });
    const { features, meta } = await provider.getBuildings({
      bounds,
      purpose: "point-report",
      minimumSunElevation: 0,
    }, controller.signal);
    return NextResponse.json(
      { type: "FeatureCollection", features, source: "Seoul S-MAP 2025", meta },
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
