import assert from "node:assert/strict";
import test from "node:test";
import { createSavedAnalysesStore } from "../src/lib/analysis/saved-analyses";
import type { SharedAnalysisV1 } from "../src/lib/analysis/share-state";

const state: SharedAnalysisV1 = {
  v: 1,
  algorithm: "sun-ray-v1",
  date: "2026-06-21",
  sampleMinutes: 5,
  mode: "report",
  points: [{ id: "a", label: "A", coordinates: [127, 37.5], targetHeight: 1.5, targetMode: "ground-point" }],
};

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

test("saved analyses persist named inputs and preserve stable creation order", () => {
  const store = createSavedAnalysesStore(memoryStorage());
  store.save("첫 분석", state, "2026-08-31T01:00:00.000Z");
  store.save("둘째 분석", { ...state, date: "2026-12-21" }, "2026-08-31T02:00:00.000Z");
  assert.deepEqual(store.list().map(({ name, state }) => [name, state.date]), [
    ["첫 분석", "2026-06-21"],
    ["둘째 분석", "2026-12-21"],
  ]);
  store.remove(store.list()[0].id);
  assert.deepEqual(store.list().map(({ name }) => name), ["둘째 분석"]);
});

test("unavailable localStorage falls back to an in-memory session store", () => {
  const broken = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  const store = createSavedAnalysesStore(broken);
  const saved = store.save("임시", state, "2026-08-31T01:00:00.000Z");
  assert.equal(store.persistenceAvailable, false);
  assert.equal(store.list()[0].id, saved.id);
});
