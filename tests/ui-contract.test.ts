import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(join(process.cwd(), "src/components/SunMapExperience.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

test("map-first experience removes landmark picking surfaces", () => {
  assert.doesNotMatch(component, /LANDMARKS|place-panel|search-box|map-marker|selected-point/);
  assert.match(component, /지도 중심/);
});

test("date is a first-class labeled control", () => {
  assert.match(component, /className="date-input"/);
  assert.match(component, /type="date"/);
  assert.match(component, /aria-label="날짜 직접 선택"/);
});

test("mobile rendering disables expensive decorative compositing", () => {
  const mobile = css.slice(css.indexOf("@media (max-width:760px)"));
  assert.match(mobile, /\.map-grid\s*\{[^}]*display:none/);
  assert.match(mobile, /\.glass-panel\s*\{[^}]*backdrop-filter:none/);
});

test("heavy map engine is deferred behind a dynamic map canvas", () => {
  assert.doesNotMatch(component, /from "maplibre-gl"/);
  assert.match(component, /dynamic\(\(\) => import\("\.\/MapCanvas"\)/);
});
