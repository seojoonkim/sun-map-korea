import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(join(process.cwd(), "src/components/SunMapExperience.tsx"), "utf8");
const mapCanvas = readFileSync(join(process.cwd(), "src/components/MapCanvas.tsx"), "utf8");
const geoSearch = readFileSync(join(process.cwd(), "src/components/GeoSearch.tsx"), "utf8");
const appIcon = readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8");
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
  assert.match(component, /dynamic\(\(\)\s*=>\s*import\("\.\/MapCanvas"\)/);
  assert.doesNotMatch(component, /from\s+["']maplibre-gl["']/);
  assert.match(mapCanvas, /from\s+["']maplibre-gl["']/);
});

test("current Seoul date is applied after hydration, not during static render", () => {
  assert.doesNotMatch(component, /useState\(todayInSeoul\)/);
  assert.match(component, /useState\("2000-01-01"\)/);
  assert.match(component, /useEffect\(\(\)\s*=>\s*setDate\(todayInSeoul\(\)\),\s*\[\]\)/);
});

test("nationwide exploration replaces the Gangnam-locked map", () => {
  assert.match(component, /<GeoSearch/);
  assert.match(component, /currentLocation/);
  assert.doesNotMatch(component, /서울특별시 · 강남구/);
  assert.match(mapCanvas, /KOREA_BOUNDS/);
  assert.doesNotMatch(mapCanvas, /\[\[126\.965, 37\.455\], \[127\.115, 37\.565\]\]/);
  assert.match(mapCanvas, /대한민국 인터랙티브 일조 지도/);
});

test("nationwide search is explicit, accessible, and keeps the map marker-free", () => {
  assert.match(geoSearch, /role="search"/);
  assert.match(geoSearch, /전국 주소 또는 지역 검색/);
  assert.match(geoSearch, /대한민국 전체 보기/);
  assert.match(geoSearch, /aria-live="polite"/);
  assert.doesNotMatch(geoSearch, /map-marker|selected-point/);
});

test("the visual system is pop and the sun identity is friendly", () => {
  assert.match(component, /className="sun-face"/);
  assert.match(component, /className="sun-eye/);
  assert.match(component, /className="sun-smile"/);
  assert.match(css, /--pink:\s*#ff6fae/i);
  assert.match(css, /--sky:\s*#72d7ff/i);
  assert.match(css, /border-radius:\s*24px/);
  assert.match(appIcon, /class="sun-smile"/);
  assert.match(appIcon, /#ff6fae/i);
});

test("height copy accurately distinguishes OSM-derived data from survey-grade data", () => {
  assert.match(component, /OSM 입력·층수 기반 높이/);
  assert.match(component, /정밀 측량값이 아니며/);
  assert.doesNotMatch(component, /실제 OSM 건물 footprint\/높이/);
  assert.match(mapCanvas, /render_height/);
});
