import type { BuildingBounds, BuildingProvider, BuildingQuery } from "./types";

const MAX_SPAN = 0.16;
const TIMEOUT_MS = 15_000;
const KOREA_BOUNDS = [124, 32.2, 132.2, 39.2] as const;
const PURPOSES = new Set<BuildingQuery["purpose"]>(["point-report", "comparison", "ground-overlay"]);

function finiteTuple(value: string | null, size: number): number[] | null {
  if (!value) return null;
  const numbers = value.split(",").map(Number);
  return numbers.length === size && numbers.every(Number.isFinite) ? numbers : null;
}

function parseQuery(request: Request): BuildingQuery | null {
  const params = new URL(request.url).searchParams;
  const tuple = finiteTuple(params.get("bounds"), 4);
  if (!tuple) return null;
  const bounds = tuple as BuildingBounds;
  const [west, south, east, north] = bounds;
  if (west < KOREA_BOUNDS[0] || east > KOREA_BOUNDS[2] || south < KOREA_BOUNDS[1] || north > KOREA_BOUNDS[3]) return null;
  if (west >= east || south >= north) return null;
  if (east - west > MAX_SPAN || north - south > MAX_SPAN) return null;

  const purposeValue = params.get("purpose") ?? "point-report";
  if (!PURPOSES.has(purposeValue as BuildingQuery["purpose"])) return null;
  const minimumSunElevation = Number(params.get("minimumSunElevation") ?? 5);
  if (!Number.isFinite(minimumSunElevation) || minimumSunElevation < 0 || minimumSunElevation > 45) return null;
  const targetTuple = params.has("target") ? finiteTuple(params.get("target"), 2) : null;
  if (params.has("target") && !targetTuple) return null;
  const target = targetTuple as [number, number] | null;
  if (target && (target[0] < west || target[0] > east || target[1] < south || target[1] > north)) return null;

  return {
    bounds,
    purpose: purposeValue as BuildingQuery["purpose"],
    minimumSunElevation,
    ...(target ? { target } : {}),
  };
}

export async function handleBuildingsRequest(request: Request, provider: BuildingProvider): Promise<Response> {
  const query = parseQuery(request);
  if (!query) return Response.json({ error: "잘못되었거나 너무 넓은 분석 범위입니다" }, { status: 400 });

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  try {
    const result = await provider.getBuildings(query, timeout.signal);
    return Response.json(result, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return Response.json({ error: "건물 데이터를 불러오지 못했습니다" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
