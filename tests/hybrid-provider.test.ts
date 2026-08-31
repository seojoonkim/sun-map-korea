import assert from "node:assert/strict";
import test from "node:test";
import { createHybridBuildingProvider } from "../src/lib/buildings/hybrid-provider";
import type { BuildingProvider, BuildingQuery, BuildingQueryMeta } from "../src/lib/buildings/types";

function meta(provider: "smap" | "openfreemap", complete = true): BuildingQueryMeta {
  return {
    complete,
    provider,
    requestedBounds: [0, 0, 1, 1],
    coveredBounds: [0, 0, 1, 1],
    sourceVersion: provider,
    featureCount: 0,
    truncatedCells: complete ? [] : ["failed"],
    estimatedHeightRatio: 0,
    warnings: complete ? [] : ["failed"],
  };
}

function fake(provider: "smap" | "openfreemap", calls: BuildingQuery[], complete = true): BuildingProvider {
  return {
    async getBuildings(query) {
      calls.push(query);
      return { buildings: [], meta: meta(provider, complete) };
    },
  };
}

test("hybrid provider uses S-MAP for analysis bounds fully inside Seoul", async () => {
  const smapCalls: BuildingQuery[] = [];
  const mvtCalls: BuildingQuery[] = [];
  const provider = createHybridBuildingProvider({
    smap: fake("smap", smapCalls),
    openfreemap: fake("openfreemap", mvtCalls),
  });
  const query: BuildingQuery = {
    bounds: [127.02, 37.45, 127.10, 37.55],
    target: [127.06, 37.5],
    purpose: "point-report",
    minimumSunElevation: 10,
  };
  const result = await provider.getBuildings(query);
  assert.equal(result.meta.provider, "smap");
  assert.equal(smapCalls.length, 1);
  assert.equal(mvtCalls.length, 0);
});

test("hybrid provider uses OpenFreeMap outside Seoul", async () => {
  const smapCalls: BuildingQuery[] = [];
  const mvtCalls: BuildingQuery[] = [];
  const provider = createHybridBuildingProvider({
    smap: fake("smap", smapCalls),
    openfreemap: fake("openfreemap", mvtCalls),
  });
  const result = await provider.getBuildings({
    bounds: [129.02, 35.13, 129.12, 35.23],
    target: [129.07, 35.18],
    purpose: "comparison",
    minimumSunElevation: 10,
  });
  assert.equal(result.meta.provider, "openfreemap");
  assert.equal(mvtCalls.length, 1);
  assert.equal(smapCalls.length, 0);
});

test("an incomplete primary result is not relabeled as complete by fallback", async () => {
  const provider = createHybridBuildingProvider({
    smap: fake("smap", [], false),
    openfreemap: fake("openfreemap", []),
  });
  const result = await provider.getBuildings({
    bounds: [127.02, 37.45, 127.10, 37.55],
    target: [127.06, 37.5],
    purpose: "point-report",
    minimumSunElevation: 10,
  });
  assert.equal(result.meta.complete, false);
  assert.equal(result.meta.provider, "smap");
});
