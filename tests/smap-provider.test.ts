import assert from "node:assert/strict";
import test from "node:test";
import type { Feature, Polygon } from "geojson";
import { createSmapProvider } from "../src/lib/buildings/smap-provider";
import type { BuildingQuery } from "../src/lib/buildings/types";

const bounds: [number, number, number, number] = [127, 37.5, 127.01, 37.51];
const query: BuildingQuery = {
  bounds,
  purpose: "point-report",
  target: [127.005, 37.505],
  minimumSunElevation: 5,
};

function building(id: number, x = 127.001): Feature<Polygon, Record<string, unknown>> {
  return {
    type: "Feature",
    id: `footprint_w_minmax.${id}`,
    properties: { id, min: 10, max: 25 },
    geometry: {
      type: "Polygon",
      coordinates: [[[x, 37.501], [x + 0.0001, 37.501], [x + 0.0001, 37.5011], [x, 37.5011], [x, 37.501]]],
    },
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function innerParams(input: RequestInfo | URL): URLSearchParams {
  const proxy = new URL(String(input));
  return new URL(`https://smap.seoul.go.kr${proxy.searchParams.get("param")}`).searchParams;
}

function fakeSmap(total: number, pages: Map<number, Feature<Polygon, Record<string, unknown>>[]>) {
  const requests: URLSearchParams[] = [];
  const fetcher: typeof fetch = async (input) => {
    const params = innerParams(input);
    requests.push(params);
    if (params.get("resultType") === "hits") return json({ numberMatched: total });
    return json({ type: "FeatureCollection", features: pages.get(Number(params.get("startIndex"))) ?? [] });
  };
  return { fetcher, requests };
}

test("marks a 1999-feature result complete after hits and one stable page", async () => {
  const features = Array.from({ length: 1999 }, (_, id) => building(id));
  const { fetcher, requests } = fakeSmap(1999, new Map([[0, features]]));

  const result = await createSmapProvider({ fetch: fetcher }).getBuildings(query);

  assert.equal(result.features.length, 1999);
  assert.equal(result.meta.complete, true);
  assert.equal(result.meta.expectedFeatureCount, 1999);
  assert.equal(result.meta.receivedFeatureCount, 1999);
  assert.equal(result.meta.pageCount, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].get("resultType"), "hits");
  assert.equal(requests[1].get("count"), "2000");
  assert.equal(requests[1].get("startIndex"), "0");
  assert.equal(requests[1].get("sortBy"), "id");
});

test("fetches every stable page when hits reports 2175 features", async () => {
  const first = Array.from({ length: 2000 }, (_, id) => building(id));
  const second = Array.from({ length: 175 }, (_, offset) => building(2000 + offset));
  const { fetcher, requests } = fakeSmap(2175, new Map([[0, first], [2000, second]]));

  const result = await createSmapProvider({ fetch: fetcher }).getBuildings(query);

  assert.equal(result.features.length, 2175);
  assert.equal(result.meta.complete, true);
  assert.equal(result.meta.pageCount, 2);
  assert.deepEqual(requests.slice(1).map((params) => params.get("startIndex")), ["0", "2000"]);
});

test("deduplicates repeated upstream IDs and reports a union-count mismatch as incomplete", async () => {
  const duplicate = building(1);
  const { fetcher } = fakeSmap(3, new Map([[0, [duplicate, duplicate, building(2)]]]));

  const result = await createSmapProvider({ fetch: fetcher }).getBuildings(query);

  assert.deepEqual(result.features.map((feature) => feature.id), [duplicate.id, building(2).id]);
  assert.equal(result.meta.complete, false);
  assert.equal(result.meta.expectedFeatureCount, 3);
  assert.equal(result.meta.receivedFeatureCount, 2);
  assert.match(result.meta.warnings.join(" "), /count mismatch/i);
});

test("filters boundary spillover without marking fully fetched coverage incomplete", async () => {
  const { fetcher } = fakeSmap(2, new Map([[0, [building(1), building(2, 127.02)]]]));

  const result = await createSmapProvider({ fetch: fetcher }).getBuildings(query);

  assert.equal(result.features.length, 1);
  assert.deepEqual(result.meta.requestedBounds, bounds);
  assert.deepEqual(result.meta.coveredBounds, bounds);
  assert.equal(result.meta.complete, true);
  assert.equal(result.meta.expectedFeatureCount, 2);
  assert.equal(result.meta.receivedFeatureCount, 2);
  assert.match(result.meta.warnings.join(" "), /outside/i);
});

test("does not silently declare a full 2000-feature page complete", async () => {
  const features = Array.from({ length: 2000 }, (_, id) => building(id));
  const { fetcher, requests } = fakeSmap(2001, new Map([[0, features], [2000, [building(2000)]]]));

  const result = await createSmapProvider({ fetch: fetcher }).getBuildings(query);

  assert.equal(result.meta.complete, true);
  assert.equal(result.features.length, 2001);
  assert.deepEqual(requests.slice(1).map((params) => params.get("startIndex")), ["0", "2000"]);
});

test("propagates an upstream page failure", async () => {
  const fetcher: typeof fetch = async (input) => {
    const params = innerParams(input);
    return params.get("resultType") === "hits" ? json({ numberMatched: 1 }) : json({ error: "down" }, 503);
  };

  await assert.rejects(
    createSmapProvider({ fetch: fetcher }).getBuildings(query),
    /S-MAP WFS 503/,
  );
});

test("propagates caller aborts to hits and page requests", async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.signal, controller.signal);
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  };

  await assert.rejects(
    createSmapProvider({ fetch: fetcher }).getBuildings(query, controller.signal),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});
