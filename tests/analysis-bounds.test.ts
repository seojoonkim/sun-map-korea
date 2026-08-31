import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysisBounds } from "../src/lib/analysis/analysis-bounds";

test("point analysis keeps provider queries bounded to a local 1.7km neighborhood", () => {
  const bounds = createAnalysisBounds([127.02713, 37.4974]);
  assert.ok(bounds[2] - bounds[0] < 0.04);
  assert.ok(bounds[3] - bounds[1] <= 0.0300000001);
  assert.equal((bounds[1] + bounds[3]) / 2, 37.4974);
  assert.equal((bounds[0] + bounds[2]) / 2, 127.02713);
});
