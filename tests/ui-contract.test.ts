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
  assert.match(mobile, /\.glass-panel\s*\{[^}]*backdrop-filter:none/);
  assert.doesNotMatch(component, /map-grid|map-vignette/);
  assert.match(mapCanvas, /details\.maplibregl-ctrl-attrib/);
  assert.match(mapCanvas, /removeAttribute\("open"\)/);
  assert.match(mapCanvas, /classList\.remove\("maplibregl-compact-show"\)/);
  assert.match(mapCanvas, /if \(attributionInteracted\) return/);
  assert.match(mobile, /\.maplibregl-ctrl-attrib-button\s*\{[^}]*min-width:40px[^}]*min-height:40px/);
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

test("the visual system is minimal, unified, and the sun identity stays friendly", () => {
  assert.match(component, /className="sun-face"/);
  assert.match(component, /className="sun-eye/);
  assert.match(component, /className="sun-smile"/);
  assert.doesNotMatch(component, /sun-eye-highlight|sun-cheek|map-grid|map-vignette|prototype-badge|district-badge/);
  assert.match(component, /className="topbar glass-panel"/);
  assert.match(css, /--solar:\s*#f5b301/i);
  assert.match(css, /--radius-panel:\s*14px/);
  assert.match(css, /--radius-control:\s*10px/);
  assert.match(css, /--radius-pill:\s*999px/);
  assert.match(css, /--shadow-panel:\s*0 4px 16px rgba\(26,29,36,\.1\)/);
  assert.doesNotMatch(css, /--pink|--sky|--violet|--mint|#ff6fae|#7967d8/i);
  assert.match(css, /\.sun-eye\s*\{[^}]*fill:var\(--ink\)/);
  assert.doesNotMatch(css, /\.sun-face\s*\{[^}]*drop-shadow/);
  assert.doesNotMatch(css, /button:hover\s*\{[^}]*transform/);
  assert.match(appIcon, /class="sun-smile"/);
  assert.match(appIcon, /#f5b301/i);
  assert.doesNotMatch(appIcon, /sun-eye-highlight|sun-cheek|#ff6fae/i);
});

test("map-center locality changes remain available to assistive technology", () => {
  assert.match(component, /className="sr-only" role="status" aria-live="polite"/);
  assert.match(component, /지도 중심 위치: \{currentLocation\}/);
});

test("essential interface copy stays readable on desktop and mobile", () => {
  assert.match(css, /\.brand-block p\s*\{[^}]*font-size:11px/);
  assert.match(css, /\.geo-search input\s*\{[^}]*font-size:15px/);
  assert.match(css, /\.readout-values span\s*\{[^}]*font-size:11px/);
  assert.match(css, /\.source\s*\{[^}]*font-size:10px/);
  assert.match(css, /\.ticks\s*\{[^}]*font:9px/);
  const mobile = css.slice(css.indexOf("@media (max-width:760px)"));
  assert.match(mobile, /\.brand-block p\s*\{[^}]*font-size:9px/);
  assert.match(mobile, /\.brand-block strong\s*\{[^}]*font-size:13px/);
  assert.match(mobile, /\.geo-search input\s*\{[^}]*font-size:14px/);
  assert.match(mobile, /\.readout-heading h1\s*\{[^}]*font-size:16px/);
  assert.match(mobile, /\.readout-values span\s*\{[^}]*font-size:10px/);
  assert.match(mobile, /\.readout-values strong\s*\{[^}]*font-size:15px/);
});

test("all ordinary nationwide OpenFreeMap footprints remain eligible for 3D rendering", () => {
  assert.match(mapCanvas, /const FALLBACK_LAYER = "building-3d"/);
  assert.match(mapCanvas, /setFilter\(FALLBACK_LAYER/);
  assert.match(mapCanvas, /hide_3d/);
  assert.match(mapCanvas, /DEFAULT_BUILDING_HEIGHT/);
  assert.match(mapCanvas, /setPaintProperty\(FALLBACK_LAYER, "fill-extrusion-height", fallbackHeight\)/);
});

test("regional moves refresh real OSM buildings after destination tiles are ready", () => {
  assert.match(mapCanvas, /map\.on\("moveend", \(\) => \{[\s\S]*?map\.once\("idle", refreshMapData\);[\s\S]*?void updatePrecisionBuildings\(\);/);
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
  assert.match(mapCanvas, /const FALLBACK_LAYER = "building-3d"/);
  assert.match(mapCanvas, /seoul-building-3d/);
});

test("the live map exposes its active building source and rendered feature count for QA", () => {
  assert.match(mapCanvas, /dataset\.buildingSource/);
  assert.match(mapCanvas, /dataset\.buildingCount/);
});

test("panning and precision loading keep nationwide buildings visible without coverage holes", () => {
  const moveStart = mapCanvas.slice(
    mapCanvas.indexOf("map.on(\"movestart\""),
    mapCanvas.indexOf("map.on(\"moveend\""),
  );
  assert.match(moveStart, /precisionAbortRef\.current\?\.abort\(\);[\s\S]*?precisionRequestRef\.current \+= 1/);
  assert.doesNotMatch(moveStart, /showFallback\(\)/);
  assert.match(mapCanvas, /map\.on\("moveend",\s*\(\)\s*=>\s*\{[\s\S]*?void updatePrecisionBuildings\(\)[\s\S]*?\}\)/);
  assert.match(mapCanvas, /setData\(\{[\s\S]*?features: \[\.\.\.unique\.values\(\)\][\s\S]*?map\.setLayoutProperty\(FALLBACK_LAYER, "visibility", "visible"\);\s*map\.setLayoutProperty\(SEOUL_LAYER, "visibility", "visible"\)/);
});

test("nearby panning reuses prefetched precision buildings instead of waiting for another request", () => {
  assert.match(mapCanvas, /precisionCoverageRef/);
  assert.match(mapCanvas, /buildingBoundsContain\(precisionCoverageRef\.current, viewportBounds\)/);
  assert.match(mapCanvas, /expandSeoulBuildingBounds\(viewportBounds\)/);
});

test("a real nearby place jump paints reusable center-first cells before full coverage", () => {
  assert.match(mapCanvas, /splitSeoulBuildingBounds\(requestBounds\)/);
  assert.match(mapCanvas, /loadSeoulBuildingCells/);
  assert.match(mapCanvas, /center:\s*\[center\.lng, center\.lat\]/);
  assert.match(mapCanvas, /precisionCellCacheRef\.current/);
  assert.match(mapCanvas, /duration:\s*350/);
});

test("precision building loading is visibly and accessibly announced", () => {
  assert.match(mapCanvas, /useState\(false\)/);
  assert.match(mapCanvas, /className="building-loading"/);
  assert.match(mapCanvas, /role="status"/);
  assert.match(mapCanvas, /aria-live="polite"/);
  assert.match(mapCanvas, /건물 불러오는 중/);
  assert.match(css, /\.building-loading\s*\{/);
});

test("a selected place updates coordinates and locality before precision buildings finish", () => {
  const selectPlace = component.slice(
    component.indexOf("function selectPlace"),
    component.indexOf("function viewKorea"),
  );
  assert.match(selectPlace, /localityAbortRef\.current\?\.abort\(\)/);
  assert.match(selectPlace, /setCoordinates\(place\.coordinates\)/);
  assert.match(selectPlace, /setCurrentLocation\(place\.label\)/);
  assert.ok(selectPlace.indexOf("setCoordinates") < selectPlace.indexOf("setCameraRequest"));

  assert.match(mapCanvas, /map\.on\("moveend",\s*\(\)\s*=>\s*\{[\s\S]*?onCenterChange\(\[center\.lng, center\.lat\]\)[\s\S]*?void updatePrecisionBuildings\(\)/);
  assert.doesNotMatch(component, /window\.setTimeout\(async \(\) => \{[\s\S]*?reverseKoreaLocation/);
});

test("initial building paint reuses and restyles the basemap building layer before precision data arrives", () => {
  assert.match(mapCanvas, /const FALLBACK_LAYER = "building-3d"/);
  assert.doesNotMatch(mapCanvas, /addSource\("fallback-buildings"/);
  assert.doesNotMatch(mapCanvas, /id: FALLBACK_LAYER/);
  assert.match(mapCanvas, /setLayerZoomRange\(FALLBACK_LAYER, 13, 24\)/);
  assert.match(mapCanvas, /setPaintProperty\(FALLBACK_LAYER, "fill-extrusion-height", fallbackHeight\)/);
  assert.match(mapCanvas, /id: "solar-shadow-fill"[\s\S]*?map\.moveLayer\(FALLBACK_LAYER\);[\s\S]*?id: SEOUL_LAYER/);
  assert.match(mapCanvas, /const initialCameraRequest = cameraRequestRef\.current;\s*applyCameraRequest\(map, initialCameraRequest\);\s*if \(!initialCameraRequest\) void updatePrecisionBuildings\(\);\s*map\.once\("idle", refreshMapData\);/);
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

test("shadow paint preserves solar-elevation strength at every map zoom", () => {
  assert.match(mapCanvas, /"fill-opacity":\s*\[\s*"interpolate",\s*\["linear"\],\s*\["zoom"\][\s\S]*?\["get",\s*"strength"\]/);
  assert.doesNotMatch(mapCanvas, /"fill-opacity":\s*\["step",\s*\["zoom"\],\s*0\.2/);
  assert.match(mapCanvas, /dataset\.shadowStrength\s*=\s*String\(shadowOpacityForElevation\(elevation\)\)/);
});

test("orange buildings use the exact opposite hue from blue shadows", () => {
  assert.match(mapCanvas, /const BUILDING_COLORS = \["#ffc370", "#ffae3d", "#f59714"\]/i);
  assert.match(mapCanvas, /const SHADOW_COLOR = "#1c6fe3"/i);
  assert.match(mapCanvas, /Complementary hues: building orange 35°, shadow blue 215°/);
  assert.match(mapCanvas, /"fill-color": SHADOW_COLOR/);
  assert.match(mapCanvas, /4, BUILDING_COLORS\[0\], 30, BUILDING_COLORS\[1\], 100, BUILDING_COLORS\[2\]/);
});

test("precision buildings load by reusable center-first cells instead of one oversized viewport payload", () => {
  assert.match(mapCanvas, /loadSeoulBuildingCells/);
  assert.match(mapCanvas, /splitSeoulBuildingBounds\(requestBounds\)/);
  assert.match(mapCanvas, /precisionCellCacheRef/);
  assert.doesNotMatch(mapCanvas, /loadViewport:\s*\(\)\s*=>\s*fetchPrecisionBuildings\(requestBounds\)/);
});

test("selected place names seed the locality cache before map movement", () => {
  const selectPlace = component.slice(
    component.indexOf("function selectPlace"),
    component.indexOf("function viewKorea"),
  );
  assert.match(component, /localityCacheKey/);
  assert.match(selectPlace, /localityCache\.current\.set\(localityCacheKey\(place\.coordinates\), place\.label\)/);
  assert.ok(selectPlace.indexOf("localityCache.current.set") < selectPlace.indexOf("setCoordinates"));
});
