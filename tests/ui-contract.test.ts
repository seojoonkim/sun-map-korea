import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(join(process.cwd(), "src/components/SunMapExperience.tsx"), "utf8");
const mapCanvas = readFileSync(join(process.cwd(), "src/components/MapCanvas.tsx"), "utf8");
const geoSearch = readFileSync(join(process.cwd(), "src/components/GeoSearch.tsx"), "utf8");
const appIcon = readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8");
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
const openGraphImage = readFileSync(join(process.cwd(), "src/app/opengraph-image.tsx"), "utf8");

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
  assert.match(mapCanvas, /tiles\.openfreemap\.org\/styles\/liberty/);
  assert.doesNotMatch(mapCanvas, /cartocdn|API KEY REQUIRED/i);
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

test("all ordinary nationwide OpenFreeMap footprints remain eligible for 3D rendering", () => {
  assert.match(mapCanvas, /"source-layer": "building"/);
  assert.match(mapCanvas, /hide_3d/);
  assert.match(mapCanvas, /DEFAULT_BUILDING_HEIGHT/);
  assert.match(mapCanvas, /"fill-extrusion-height": fallbackHeight/);
});

test("sun position and daylight metrics share one compact information row", () => {
  const regionStart = component.indexOf('className="solar-readout glass-panel"');
  const regionEnd = component.indexOf("</section>", regionStart);
  const region = component.slice(regionStart, regionEnd);
  assert.match(region, /currentLocation/);
  assert.match(region, /방위각/);
  assert.match(region, /고도각/);
  assert.match(region, /일조 가능/);
  assert.match(region, /일출 \/ 일몰/);
  assert.doesNotMatch(region, /지도 중심 · 햇빛 리포트/);
  assert.match(css, /\.readout-values\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css, /\.readout-values\s*\{[^}]*border-block/);
  assert.doesNotMatch(css, /\.readout-values div\+div\s*\{[^}]*border-left/);
  assert.doesNotMatch(css, /\.readout-values div:nth-child\(n\+3\)\s*\{[^}]*border-top/);
  assert.doesNotMatch(component, /className="summary-panel glass-panel"/);
});

test("floating panels use whitespace instead of internal divider lines", () => {
  assert.doesNotMatch(css, /\.date-controls\s*\{[^}]*border-bottom/);
  assert.doesNotMatch(css, /\.glass-panel\s*\{[^}]*inset\s+0\s+0\s+0\s+1px/);
});

test("social sharing has concise copy and a dedicated minimal image", () => {
  assert.match(layout, /대한민국 어디서나, 시간에 따라 달라지는 햇빛과 건물 그림자를 한눈에\./);
  assert.match(layout, /openGraph:\s*\{/);
  assert.match(layout, /images:\s*\[\{\s*url:\s*["']\/opengraph-image["']/);
  assert.match(openGraphImage, /SUN MAP/);
  assert.match(openGraphImage, /1200/);
  assert.match(openGraphImage, /630/);
});

test("date label remains on one line in the mobile layout", () => {
  assert.match(css, /\.date-input span\s*\{[^}]*white-space:nowrap/);
  const mobile = css.slice(css.indexOf("@media (max-width:760px)"));
  assert.match(mobile, /\.date-input\s*\{[^}]*flex:1[^}]*min-width:0/);
});

test("height copy distinguishes Seoul precision data from the nationwide fallback", () => {
  assert.match(component, /서울 S-MAP 2025 정밀 높이/);
  assert.match(component, /전국 OpenFreeMap\/OSM 높이 우선/);
  assert.match(component, /미입력은 9m 추정/);
  assert.match(mapCanvas, /NATIONWIDE_BUILDINGS_URL/);
  assert.match(mapCanvas, /seoul-building-3d/);
});

test("the live map exposes its active building source and rendered feature count for QA", () => {
  assert.match(mapCanvas, /dataset\.buildingSource/);
  assert.match(mapCanvas, /dataset\.buildingCount/);
});

test("panning reveals nationwide buildings while the next Seoul precision viewport loads", () => {
  assert.match(mapCanvas, /map\.on\("movestart",\s*\(\)\s*=>\s*\{[\s\S]*?precisionAbortRef\.current\?\.abort\(\);[\s\S]*?precisionRequestRef\.current \+= 1;[\s\S]*?showFallback\(\);[\s\S]*?\}\)/);
  assert.match(mapCanvas, /map\.on\("moveend",\s*\(\)\s*=>\s*void updatePrecisionBuildings\(\)\)/);
});

test("night mode darkens the base map while keeping the daytime map clear", () => {
  assert.match(mapCanvas, /id:\s*"night-map-tint"/);
  assert.match(mapCanvas, /coordinates:\s*\[\[\[123, 31\]/);
  assert.match(mapCanvas, /"fill-color":\s*"#081426"/i);
  assert.match(mapCanvas, /solar\.isDaylight\s*\?\s*0\s*:\s*0\.58/);
  assert.match(mapCanvas, /setPaintProperty\("night-map-tint",\s*"fill-opacity"/);
  assert.match(css, /\.is-night>\.map \.maplibregl-canvas\s*\{[^}]*filter:brightness\(\.38\)/);
  assert.match(css, /\.is-day>\.map \.maplibregl-canvas\s*\{[^}]*filter:none/);
});
