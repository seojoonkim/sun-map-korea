import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeSharedAnalysis,
  encodeSharedAnalysis,
  type SharedAnalysisV1,
} from "../src/lib/analysis/share-state";

const shared: SharedAnalysisV1 = {
  v: 1,
  algorithm: "sun-ray-v1",
  date: "2026-06-21",
  sampleMinutes: 5,
  mode: "compare",
  points: [
    { id: "a", label: "후보 A", coordinates: [127.088, 37.504], targetHeight: 8.4, targetMode: "window-point", facadeAzimuth: 180 },
    { id: "b", label: "후보 B", coordinates: [129.0756, 35.1796], targetHeight: 1.5, targetMode: "ground-point" },
  ],
};

test("v1 share state round-trips Unicode labels in a URL-safe fragment", () => {
  const encoded = encodeSharedAnalysis(shared);
  assert.match(encoded, /^sunmap=/);
  assert.doesNotMatch(encoded, /[+/=]{2,}/);
  assert.deepEqual(decodeSharedAnalysis(encoded), { status: "ok", value: shared });
});

test("malformed and out-of-range fragments fail safely", () => {
  assert.equal(decodeSharedAnalysis("sunmap=not-json").status, "invalid");
  const invalid = { ...shared, points: [{ ...shared.points[0], targetHeight: 9000 }] };
  assert.equal(decodeSharedAnalysis(encodeSharedAnalysis(invalid as SharedAnalysisV1)).status, "invalid");
});

test("future versions return an explicit compatibility result", () => {
  const future = encodeURIComponent(JSON.stringify({ ...shared, v: 2 }));
  assert.deepEqual(decodeSharedAnalysis(`sunmap-json=${future}`), { status: "future-version", version: 2 });
});

test("four realistic candidates stay within a conservative fragment budget", () => {
  const four: SharedAnalysisV1 = {
    ...shared,
    points: Array.from({ length: 4 }, (_, index) => ({
      id: `candidate-${index + 1}`,
      label: `후보 ${index + 1}`,
      coordinates: [127.088 + index * 0.001, 37.504 + index * 0.001],
      targetHeight: 8.4,
      targetMode: "window-point" as const,
      facadeAzimuth: index * 90,
    })),
  };
  assert.ok(encodeSharedAnalysis(four).length < 2_000);
});
