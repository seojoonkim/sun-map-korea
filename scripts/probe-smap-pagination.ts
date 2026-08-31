import assert from "node:assert/strict";

const SMAP_PROXY = "https://smap.seoul.go.kr/imageProxy.do";
const WFS_PATH = "/geoserver/seoul/wfs";
const LAYER = "seoul:footprint_w_minmax";
const SAMJEON_CELL = [127.084, 37.494, 127.096, 37.506] as const;
const PAGE_SIZE = 2_000;

type JsonFeature = {
  id?: string | number;
  properties?: Record<string, unknown>;
};
type FeatureCollection = { features?: JsonFeature[] };

export function parseHitsTotal(xml: string): number {
  const match = xml.match(/\b(?:numberOfFeatures|numberMatched)=["'](\d+)["']/);
  if (!match) throw new Error("WFS hits response has no numeric total");
  return Number(match[1]);
}

export function featureKey(feature: JsonFeature): string {
  const value = feature.id ?? feature.properties?.id;
  if (value === undefined || value === null || String(value) === "") {
    throw new Error("S-MAP feature has no stable ID");
  }
  return String(value);
}

function selfTest() {
  assert.equal(parseHitsTotal('<wfs:FeatureCollection numberOfFeatures="2175"/>'), 2175);
  assert.equal(parseHitsTotal('<wfs:FeatureCollection numberMatched="2175"/>'), 2175);
  assert.throws(() => parseHitsTotal("<wfs:FeatureCollection/>"));
  assert.equal(featureKey({ id: "footprint.1", properties: { id: 42 } }), "footprint.1");
  assert.equal(featureKey({ properties: { id: 42 } }), "42");
  assert.throws(() => featureKey({ properties: {} }));
  console.log("S-MAP parser assertions: PASS");
}

function proxyUrl(parameters: Record<string, string>) {
  const inner = new URL(`https://smap.seoul.go.kr${WFS_PATH}`);
  inner.search = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: LAYER,
    srsName: "EPSG:4326",
    ...parameters,
  }).toString();
  const proxy = new URL(SMAP_PROXY);
  proxy.searchParams.set("svc", "2D");
  proxy.searchParams.set("param", `${inner.pathname}${inner.search}`);
  return proxy;
}

async function fetchResponse(parameters: Record<string, string>) {
  const started = performance.now();
  const response = await fetch(proxyUrl(parameters), {
    headers: { Accept: "application/json, application/xml;q=0.9", "User-Agent": "SunMapKorea-feasibility/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`S-MAP WFS ${response.status}: ${body.slice(0, 200)}`);
  return { body, contentType: response.headers.get("content-type"), latencyMs: Math.round(performance.now() - started) };
}

async function fetchJson(parameters: Record<string, string>) {
  const response = await fetchResponse({ outputFormat: "application/json", ...parameters });
  let data: FeatureCollection;
  try {
    data = JSON.parse(response.body) as FeatureCollection;
  } catch {
    throw new Error(`Expected WFS JSON, got ${response.contentType}: ${response.body.slice(0, 200)}`);
  }
  if (!Array.isArray(data.features)) throw new Error("WFS JSON has no features array");
  return { ...response, features: data.features };
}

async function main() {
  const bbox = `${SAMJEON_CELL.join(",")},EPSG:4326`;
  const hits = await fetchResponse({ resultType: "hits", bbox });
  const total = parseHitsTotal(hits.body);
  const page1 = await fetchJson({ bbox, maxFeatures: String(PAGE_SIZE), count: String(PAGE_SIZE), startIndex: "0", sortBy: "id" });
  const page2 = await fetchJson({ bbox, maxFeatures: String(PAGE_SIZE), count: String(PAGE_SIZE), startIndex: String(PAGE_SIZE), sortBy: "id" });

  const page1Ids = page1.features.map(featureKey);
  const page2Ids = page2.features.map(featureKey);
  const firstIds = new Set(page1Ids);
  const overlap = page2Ids.filter((id) => firstIds.has(id));
  const union = new Set([...page1Ids, ...page2Ids]);

  assert.ok(total > PAGE_SIZE, `Expected capped Samjeon total > ${PAGE_SIZE}, got ${total}`);
  assert.equal(page1.features.length, PAGE_SIZE, "Samjeon first page no longer reaches the known cap");
  assert.ok(page2.features.length > 0, "Pagination returned an empty second page");
  assert.notEqual(page1Ids[0], page2Ids[0], "Second page repeats the first page");
  assert.equal(overlap.length, 0, "WFS pages overlap by stable feature ID");
  assert.equal(union.size, total, "Two-page union does not equal resultType=hits total");

  const propertyId = page1.features[0]?.properties?.id;
  assert.notEqual(propertyId, undefined, "Probe feature lacks property id");
  const rejectedCombinedFilter = await fetchResponse({ bbox, maxFeatures: "10", CQL_FILTER: `id=${propertyId}` });
  assert.match(rejectedCombinedFilter.body, /bbox and cql_filter both specified but are mutually exclusive/);
  const propertyProbe = await fetchJson({ maxFeatures: "10", CQL_FILTER: `id=${propertyId}` });
  const [west, south, east, north] = SAMJEON_CELL;
  const inset = [west, south, (west + east) / 2, (south + north) / 2];
  const spatialProbe = await fetchJson({
    maxFeatures: String(PAGE_SIZE),
    CQL_FILTER: `BBOX(geom,${inset.join(",")},'EPSG:4326')`,
  });

  const propertySupported = propertyProbe.features.some((feature) => feature.properties?.id === propertyId);
  const spatialSupported = spatialProbe.features.length > 0 && spatialProbe.features.length < total;

  console.log(JSON.stringify({
    probe: "S-MAP WFS completeness",
    capturedAt: new Date().toISOString(),
    endpoint: SMAP_PROXY,
    layer: LAYER,
    bbox: SAMJEON_CELL,
    hits: { total, latencyMs: hits.latencyMs, contentType: hits.contentType },
    pagination: {
      supported: true,
      page1Count: page1.features.length,
      page2Count: page2.features.length,
      page1FirstId: page1Ids[0],
      page2FirstId: page2Ids[0],
      overlapCount: overlap.length,
      unionCount: union.size,
      page1LatencyMs: page1.latencyMs,
      page2LatencyMs: page2.latencyMs,
      stableSort: "id",
    },
    filters: {
      bboxAndCqlCombined: {
        supported: false,
        contentType: rejectedCombinedFilter.contentType,
        exception: rejectedCombinedFilter.body,
      },
      property: { supported: propertySupported, expression: `id=${propertyId}`, count: propertyProbe.features.length, latencyMs: propertyProbe.latencyMs },
      spatial: { supported: spatialSupported, expression: `BBOX(geom,${inset.join(",")},'EPSG:4326')`, count: spatialProbe.features.length, latencyMs: spatialProbe.latencyMs },
    },
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
