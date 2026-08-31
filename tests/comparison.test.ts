import assert from "node:assert/strict";
import test from "node:test";
import { addComparisonPoint, summarizeComparison } from "../src/lib/analysis/comparison";
import type { DailySunReport } from "../src/lib/analysis/daily-report";

function report(sunMinutes: number, uncertainMinutes = 0, complete = true): DailySunReport {
  return {
    complete,
    algorithm: "sun-ray-v1",
    sourceVersion: "test",
    date: "2026-06-21",
    sampleMinutes: 5,
    samples: complete ? [
      { minute: 600, azimuth: 100, elevation: 30, state: sunMinutes > 0 ? "sun" : "shade" },
      { minute: 900, azimuth: 240, elevation: 30, state: sunMinutes > 300 ? "sun" : "shade" },
    ] : [],
    intervals: [],
    totals: complete ? {
      sunMinutes,
      shadeMinutes: 1440 - sunMinutes - uncertainMinutes,
      uncertainMinutes,
      belowHorizonMinutes: 0,
    } : undefined,
    errorMinutes: 5,
    warnings: complete ? [] : ["incomplete"],
  };
}

test("comparison blocks a fifth point and preserves addition order", () => {
  const four = ["a", "b", "c", "d"].reduce(
    (points, id) => addComparisonPoint(points, { id, label: id, coordinates: [127, 37], targetHeight: 1.5, targetMode: "ground-point" }),
    [] as Parameters<typeof addComparisonPoint>[0],
  );
  assert.deepEqual(four.map(({ id }) => id), ["a", "b", "c", "d"]);
  assert.throws(
    () => addComparisonPoint(four, { id: "e", label: "e", coordinates: [127, 37], targetHeight: 1.5, targetMode: "ground-point" }),
    /maximum of four/i,
  );
});

test("comparison reports total, morning, afternoon, and uncertainty without auto-sorting", () => {
  const summaries = summarizeComparison([
    { id: "later", label: "후보 1", report: report(500, 30) },
    { id: "earlier", label: "후보 2", report: report(300, 60) },
  ]);
  assert.deepEqual(summaries.map(({ id }) => id), ["later", "earlier"]);
  assert.equal(summaries[0].totalSunMinutes, 500);
  assert.equal(summaries[0].morningSunMinutes, 5);
  assert.equal(summaries[0].afternoonSunMinutes, 5);
  assert.equal(summaries[0].uncertainMinutes, 30);
});

test("incomplete candidates have no comparable rank or numeric result", () => {
  const summaries = summarizeComparison([
    { id: "ok", label: "완료", report: report(400) },
    { id: "bad", label: "불완전", report: report(0, 0, false) },
  ]);
  assert.equal(summaries[0].rank, 1);
  assert.equal(summaries[1].comparable, false);
  assert.equal(summaries[1].rank, null);
  assert.equal(summaries[1].totalSunMinutes, null);
});
