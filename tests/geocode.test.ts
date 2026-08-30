import test from "node:test";
import assert from "node:assert/strict";
import { formatLocality, localityCacheKey, parseSearchResults } from "../src/lib/geocode";

test("Korean geocoder results are normalized and deduplicated", () => {
  const results = parseSearchResults([
    { place_id: 1, display_name: "부산광역시 해운대구, 대한민국", lat: "35.1631", lon: "129.1635", type: "administrative" },
    { place_id: 2, display_name: "부산광역시 해운대구, 대한민국", lat: "35.1631", lon: "129.1635", type: "administrative" },
    { place_id: 3, display_name: "제주특별자치도 제주시, 대한민국", lat: "33.4996", lon: "126.5312", type: "city" },
    { place_id: 4, display_name: "잘못된 결과", lat: "oops", lon: "126.5", type: "city" },
  ]);

  assert.deepEqual(results, [
    { id: "1", label: "부산광역시 해운대구", detail: "대한민국", coordinates: [129.1635, 35.1631] },
    { id: "3", label: "제주특별자치도 제주시", detail: "대한민국", coordinates: [126.5312, 33.4996] },
  ]);
});

test("reverse geocoder address becomes a compact Korean locality", () => {
  assert.equal(formatLocality({ province: "강원특별자치도", city: "강릉시", suburb: "교동" }), "강원특별자치도 · 강릉시 · 교동");
  assert.equal(formatLocality({ state: "전라남도", county: "신안군" }), "전라남도 · 신안군");
  assert.equal(formatLocality({}), "대한민국");
});

test("nearby map centers share a stable locality cache key", () => {
  assert.equal(localityCacheKey([127.08017, 37.53586]), "127.08:37.54");
  assert.equal(localityCacheKey([127.0812, 37.5364]), "127.08:37.54");
  assert.notEqual(localityCacheKey([127.094, 37.5364]), "127.08:37.54");
});
