import assert from "node:assert/strict";
import test from "node:test";
import type { BuildingProvider } from "../src/lib/buildings/types";
import { handleBuildingsRequest } from "../src/lib/buildings/http-route";

const provider: BuildingProvider = {
  async getBuildings(query) {
    return {
      buildings: [],
      meta: {
        complete: true,
        provider: "smap",
        requestedBounds: query.bounds,
        coveredBounds: query.bounds,
        sourceVersion: "test-source",
        featureCount: 0,
        truncatedCells: [],
        estimatedHeightRatio: 0,
        warnings: [],
      },
    };
  },
};

test("analysis buildings API validates and forwards a bounded point query", async () => {
  const request = new Request("https://example.test/api/buildings?bounds=127,37.49,127.02,37.51&purpose=point-report&minimumSunElevation=5&target=127.01,37.5");
  const response = await handleBuildingsRequest(request, provider);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.meta.complete, true);
  assert.equal(body.meta.sourceVersion, "test-source");
});

test("analysis buildings API rejects malformed, oversized, and unsupported queries", async () => {
  const malformed = await handleBuildingsRequest(new Request("https://example.test/api/buildings?bounds=nope"), provider);
  assert.equal(malformed.status, 400);

  const oversized = await handleBuildingsRequest(new Request("https://example.test/api/buildings?bounds=126,37,127,38"), provider);
  assert.equal(oversized.status, 400);

  const unsupported = await handleBuildingsRequest(new Request("https://example.test/api/buildings?bounds=127,37.49,127.02,37.51&purpose=legal-pass"), provider);
  assert.equal(unsupported.status, 400);

  const outsideKorea = await handleBuildingsRequest(new Request("https://example.test/api/buildings?bounds=0,0,0.02,0.02"), provider);
  assert.equal(outsideKorea.status, 400);
});

test("analysis buildings API maps upstream failure and abort timeout without leaking details", async () => {
  const failing: BuildingProvider = { async getBuildings() { throw new Error("private upstream detail"); } };
  const response = await handleBuildingsRequest(new Request("https://example.test/api/buildings?bounds=127,37.49,127.02,37.51"), failing);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "건물 데이터를 불러오지 못했습니다" });
});
