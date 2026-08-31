import type { Feature, MultiPolygon, Polygon } from "geojson";
import { normalizeSmapBuilding, summarizeBuildingQuality } from "./quality";
import type {
  AnalysisBuilding,
  BuildingProvider,
  BuildingQuery,
  BuildingQueryMeta,
} from "./types";

const SMAP_PROXY = "https://smap.seoul.go.kr/imageProxy.do";
const SMAP_WFS = "https://smap.seoul.go.kr/geoserver/seoul/wfs";
const LAYER = "seoul:footprint_w_minmax";
const DEFAULT_PAGE_SIZE = 2_000;
const DEFAULT_MAX_PAGES = 50;
const SOURCE_VERSION = "Seoul S-MAP 2025";

type SmapFeature = Feature<Polygon | MultiPolygon, Record<string, unknown> | null>;
type SmapPage = { type?: string; features?: SmapFeature[] };

export type SmapQueryMeta = BuildingQueryMeta & {
  expectedFeatureCount: number;
  receivedFeatureCount: number;
  pageCount: number;
};

export type SmapQueryResult = {
  features: SmapFeature[];
  buildings: AnalysisBuilding[];
  meta: SmapQueryMeta;
};

export interface SmapProvider extends BuildingProvider {
  getBuildings(query: BuildingQuery, signal?: AbortSignal): Promise<SmapQueryResult>;
}

type SmapProviderOptions = {
  fetch: typeof fetch;
  pageSize?: number;
  maxPages?: number;
};

function requestUrl(
  bounds: BuildingQuery["bounds"],
  options: { resultType?: "hits"; count?: number; startIndex?: number },
): URL {
  const wfs = new URL(SMAP_WFS);
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: LAYER,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    bbox: `${bounds.join(",")},EPSG:4326`,
  });
  if (options.resultType) params.set("resultType", options.resultType);
  if (options.count !== undefined) params.set("count", String(options.count));
  if (options.startIndex !== undefined) params.set("startIndex", String(options.startIndex));
  if (options.startIndex !== undefined) params.set("sortBy", "id");
  wfs.search = params.toString();

  const proxy = new URL(SMAP_PROXY);
  proxy.searchParams.set("svc", "2D");
  proxy.searchParams.set("param", `${wfs.pathname}${wfs.search}`);
  return proxy;
}

async function checkedText(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`S-MAP WFS ${response.status}`);
  return response.text();
}

function parseHits(body: string): number {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    for (const key of ["numberMatched", "numberOfFeatures", "totalFeatures", "total"] as const) {
      const total = Number(value[key]);
      if (Number.isSafeInteger(total) && total >= 0) return total;
    }
  } catch {
    // WFS 1.1 hits responses are commonly XML even when JSON output is requested.
  }
  const match = body.match(/(?:numberOfFeatures|numberMatched)=["'](\d+)["']/i);
  if (match) return Number(match[1]);
  throw new Error("S-MAP WFS hits response did not include a valid feature count");
}

function featureKey(feature: SmapFeature): string {
  return String(feature.id ?? feature.properties?.id ?? JSON.stringify(feature.geometry));
}

function geometryBounds(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      west = Math.min(west, value[0]);
      south = Math.min(south, value[1]);
      east = Math.max(east, value[0]);
      north = Math.max(north, value[1]);
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry.coordinates);
  return [west, south, east, north];
}

function intersectsRequestedBounds(feature: SmapFeature, bounds: BuildingQuery["bounds"]): boolean {
  const [west, south, east, north] = geometryBounds(feature.geometry);
  return east >= bounds[0] && west <= bounds[2] && north >= bounds[1] && south <= bounds[3];
}

export function createSmapProvider({
  fetch: fetchImpl,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
}: SmapProviderOptions): SmapProvider {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error("pageSize must be a positive integer");
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) throw new Error("maxPages must be a positive integer");

  return {
    async getBuildings(query, signal) {
      const init: RequestInit = {
        signal,
        headers: { Accept: "application/json", "User-Agent": "SunMapKorea/1.0" },
      };
      const hitsResponse = await fetchImpl(requestUrl(query.bounds, { resultType: "hits" }), init);
      const expectedFeatureCount = parseHits(await checkedText(hitsResponse));
      const requiredPages = Math.ceil(expectedFeatureCount / pageSize);
      const pagesToFetch = Math.min(requiredPages, maxPages);
      const pageFeatures: SmapFeature[] = [];

      for (let page = 0; page < pagesToFetch; page += 1) {
        const response = await fetchImpl(
          requestUrl(query.bounds, { count: pageSize, startIndex: page * pageSize }),
          init,
        );
        const body = await checkedText(response);
        let data: SmapPage;
        try {
          data = JSON.parse(body) as SmapPage;
        } catch {
          throw new Error("S-MAP WFS page response was not valid JSON");
        }
        if (!Array.isArray(data.features)) throw new Error("S-MAP WFS page response did not include features");
        pageFeatures.push(...data.features);
      }

      const unique = Array.from(new Map(pageFeatures.map((feature) => [featureKey(feature), feature])).values());
      const features = unique.filter((feature) => intersectsRequestedBounds(feature, query.bounds));
      const buildings = features.flatMap((feature) => {
        const building = normalizeSmapBuilding(feature);
        return building ? [building] : [];
      });
      const warnings: string[] = [];
      if (requiredPages > maxPages) {
        warnings.push(`S-MAP result requires ${requiredPages} pages; bounded fetch limit is ${maxPages}`);
      }
      if (features.length !== unique.length) {
        warnings.push(`${unique.length - features.length} S-MAP features were outside the requested bbox`);
      }
      if (unique.length !== expectedFeatureCount) {
        warnings.push(`S-MAP count mismatch: expected ${expectedFeatureCount}, received ${unique.length}`);
      }
      const quality = summarizeBuildingQuality(buildings);
      const complete = requiredPages <= maxPages && unique.length === expectedFeatureCount;
      const meta: SmapQueryMeta = {
        complete,
        provider: "smap",
        requestedBounds: [...query.bounds],
        coveredBounds: [...query.bounds],
        sourceVersion: SOURCE_VERSION,
        featureCount: quality.featureCount,
        truncatedCells: complete ? [] : [query.bounds.join(",")],
        estimatedHeightRatio: quality.estimatedHeightRatio,
        warnings,
        expectedFeatureCount,
        receivedFeatureCount: unique.length,
        pageCount: pagesToFetch,
      };
      return { features, buildings, meta };
    },
  };
}
