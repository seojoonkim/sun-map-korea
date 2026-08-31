"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, type ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { SolarPosition } from "@/lib/solar";
import type { AnalysisPoint } from "@/lib/analysis/comparison";
import {
  buildingBoundsContain,
  buildSeoulBuildingRequest,
  expandSeoulBuildingBounds,
  isPotentialSeoulViewport,
  loadSeoulBuildingCells,
  normalizeSeoulBuildings,
  splitSeoulBuildingBounds,
  type BuildingBounds,
} from "@/lib/building-sources";
import {
  createBuildingShadows,
  DEFAULT_BUILDING_HEIGHT,
  normalizeBuildingFeatures,
  shadowOpacityForElevation,
} from "@/lib/shadows";

const SEOUL_CENTER: [number, number] = [127.02761, 37.49794];
const KOREA_BOUNDS: [[number, number], [number, number]] = [[124.0, 32.2], [132.2, 39.2]];
const EMPTY_BUILDINGS: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };
const EMPTY_SOURCE: FeatureCollection<Polygon | MultiPolygon> = { type: "FeatureCollection", features: [] };
const EMPTY_POINTS: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
const NIGHT_TINT: FeatureCollection<Polygon> = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[[123, 31], [134, 31], [134, 41], [123, 41], [123, 31]]],
    },
  }],
};
const BASE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK_LAYER = "building-3d";
const SEOUL_LAYER = "seoul-building-3d";
const NIGHT_TINT_LAYER = "night-map-tint";
// Complementary hues: building pink 345°, shadow teal 165°.
const BUILDING_COLORS = ["#ffd6e0", "#fdafc3", "#f87797"];
const SHADOW_COLOR = "#1ba784";
const MAX_PRECISION_CACHE_CELLS = 48;

type MapCanvasProps = {
  solar: SolarPosition;
  onCenterChange: (coordinates: [number, number]) => void;
  onSelectPoint: (coordinates: [number, number]) => void;
  selectedPoint: AnalysisPoint | null;
  comparisonPoints: AnalysisPoint[];
  shadowOverlay: FeatureCollection<Polygon> | null;
  showShadowOverlay: boolean;
  cameraRequest: {
    id: number;
    mode: "place" | "country";
    center?: [number, number];
  } | null;
};

type RenderedBuilding = {
  id?: string | number;
  properties: Record<string, unknown> | null;
  geometry: Polygon | MultiPolygon;
};

export default function MapCanvas({
  solar,
  onCenterChange,
  onSelectPoint,
  selectedPoint,
  comparisonPoints,
  shadowOverlay,
  showShadowOverlay,
  cameraRequest,
}: MapCanvasProps) {
  const [buildingLoading, setBuildingLoading] = useState(false);
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const buildingsRef = useRef<FeatureCollection<Polygon>>(EMPTY_BUILDINGS);
  const shadowTimerRef = useRef<number | null>(null);
  const precisionAbortRef = useRef<AbortController | null>(null);
  const precisionRequestRef = useRef(0);
  const precisionCoverageRef = useRef<BuildingBounds | null>(null);
  const precisionCellCacheRef = useRef(new Map<string, FeatureCollection<Polygon | MultiPolygon>>());
  const seoulPrecisionActiveRef = useRef(false);
  const solarRef = useRef(solar);
  const cameraRequestRef = useRef(cameraRequest);
  const onSelectPointRef = useRef(onSelectPoint);
  const selectedPointRef = useRef(selectedPoint);
  const comparisonPointsRef = useRef(comparisonPoints);
  const shadowOverlayRef = useRef(shadowOverlay);
  const showShadowOverlayRef = useRef(showShadowOverlay);
  solarRef.current = solar;
  cameraRequestRef.current = cameraRequest;
  onSelectPointRef.current = onSelectPoint;
  selectedPointRef.current = selectedPoint;
  comparisonPointsRef.current = comparisonPoints;
  shadowOverlayRef.current = shadowOverlay;
  showShadowOverlayRef.current = showShadowOverlay;

  const applyCameraRequest = useCallback((map: MapLibreMap, request: MapCanvasProps["cameraRequest"]) => {
    if (!request) return;
    const compactMap = window.innerWidth <= 760;
    if (request.mode === "country") {
      const camera = map.cameraForBounds(KOREA_BOUNDS, { padding: compactMap ? 28 : 82 });
      map.easeTo({ ...camera, pitch: 0, bearing: 0, duration: 900 });
      return;
    }
    if (request.center) {
      map.flyTo({
        center: request.center,
        zoom: compactMap ? 14.2 : 15.1,
        pitch: compactMap ? 38 : 50,
        bearing: -12,
        duration: 350,
      });
    }
  }, []);

  const scheduleShadowUpdate = useCallback((delay = 60) => {
    if (shadowTimerRef.current !== null) window.clearTimeout(shadowTimerRef.current);
    shadowTimerRef.current = window.setTimeout(() => {
      shadowTimerRef.current = null;
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      const { azimuth, elevation } = solarRef.current;
      if (mapContainer.current) {
        mapContainer.current.dataset.shadowStrength = String(shadowOpacityForElevation(elevation));
      }
      const source = map.getSource("solar-shadow") as GeoJSONSource | undefined;
      source?.setData(createBuildingShadows(buildingsRef.current, azimuth, elevation));
    }, delay);
  }, []);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const compactMap = window.innerWidth <= 760;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: BASE_MAP_STYLE,
      transformRequest: (url, resourceType) => ({
        url: resourceType === "Glyphs" && url.startsWith("https://tiles.openfreemap.org/fonts/")
          ? url.replace("https://tiles.openfreemap.org/fonts/", "https://fonts.openmaptiles.org/")
          : url,
      }),
      center: SEOUL_CENTER,
      zoom: compactMap ? 14.7 : 15.35,
      pitch: compactMap ? 38 : 53,
      bearing: compactMap ? -10 : -18,
      minZoom: 5.5,
      maxZoom: 18,
      maxBounds: KOREA_BOUNDS,
      attributionControl: false,
      fadeDuration: 0,
      refreshExpiredTiles: false,
      renderWorldCopies: false,
    });
    mapRef.current = map;
    if (!compactMap) map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    if (compactMap) {
      let attributionInteracted = false;
      mapContainer.current
        .querySelector(".maplibregl-ctrl-attrib-button")
        ?.addEventListener("click", () => { attributionInteracted = true; }, { once: true });
      const collapseAttribution = () => {
        if (attributionInteracted) return;
        const attribution = mapContainer.current?.querySelector("details.maplibregl-ctrl-attrib");
        attribution?.removeAttribute("open");
        attribution?.classList.remove("maplibregl-compact-show");
      };
      window.requestAnimationFrame(collapseAttribution);
      map.once("load", collapseAttribution);
    }

    const refreshMapData = () => {
      if (!map.getLayer(FALLBACK_LAYER) || !map.getLayer(SEOUL_LAYER)) return;
      const center = map.getCenter();
      onCenterChange([center.lng, center.lat]);
      const canvas = map.getCanvas();
      const layers = [seoulPrecisionActiveRef.current ? SEOUL_LAYER : FALLBACK_LAYER];
      const visibleFeatures = map.queryRenderedFeatures(
        [[0, 0], [canvas.clientWidth, canvas.clientHeight]],
        { layers },
      ).filter((feature) => feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon");
      buildingsRef.current = normalizeBuildingFeatures(visibleFeatures as unknown as RenderedBuilding[]);
      if (mapContainer.current) {
        mapContainer.current.dataset.buildingSource = seoulPrecisionActiveRef.current ? "smap-2025" : "openfreemap-osm";
        mapContainer.current.dataset.buildingCount = String(buildingsRef.current.features.length);
      }
      scheduleShadowUpdate(compactMap ? 140 : 50);
    };

    const showFallback = () => {
      seoulPrecisionActiveRef.current = false;
      if (map.getLayer(FALLBACK_LAYER)) map.setLayoutProperty(FALLBACK_LAYER, "visibility", "visible");
      if (map.getLayer(SEOUL_LAYER)) map.setLayoutProperty(SEOUL_LAYER, "visibility", "none");
    };

    const updatePrecisionBuildings = async () => {
      precisionAbortRef.current?.abort();
      const center = map.getCenter();
      if (!isPotentialSeoulViewport([center.lng, center.lat], map.getZoom())) {
        setBuildingLoading(false);
        showFallback();
        precisionCoverageRef.current = null;
        (map.getSource("seoul-buildings") as GeoJSONSource | undefined)?.setData(EMPTY_SOURCE);
        refreshMapData();
        return;
      }

      const bounds = map.getBounds();
      const viewportBounds: BuildingBounds = [
        bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
      ];
      if (
        seoulPrecisionActiveRef.current
        && buildingBoundsContain(precisionCoverageRef.current, viewportBounds)
      ) {
        setBuildingLoading(false);
        refreshMapData();
        return;
      }

      setBuildingLoading(true);
      const requestBounds = expandSeoulBuildingBounds(viewportBounds);
      const cells = splitSeoulBuildingBounds(requestBounds);
      const controller = new AbortController();
      precisionAbortRef.current = controller;
      const requestId = ++precisionRequestRef.current;
      const fetchPrecisionBuildings = async (cell: BuildingBounds) => {
        const response = await fetch(buildSeoulBuildingRequest(cell), { signal: controller.signal });
        if (!response.ok) throw new Error(`Seoul buildings ${response.status}`);
        const collection = await response.json() as FeatureCollection<Polygon | MultiPolygon>;
        return normalizeSeoulBuildings(collection.features);
      };
      const paintPrecisionBuildings = (collections: FeatureCollection<Polygon | MultiPolygon>[]) => {
        if (requestId !== precisionRequestRef.current) return;
        const unique = new Map<string, FeatureCollection<Polygon | MultiPolygon>["features"][number]>();
        for (const feature of collections.flatMap((collection) => collection.features)) {
          const key = String(feature.id ?? feature.properties?.id ?? JSON.stringify(feature.geometry));
          unique.set(key, feature);
        }
        if (unique.size === 0) return;
        (map.getSource("seoul-buildings") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [...unique.values()],
        });
        map.setLayoutProperty(FALLBACK_LAYER, "visibility", "visible");
        map.setLayoutProperty(SEOUL_LAYER, "visibility", "visible");
        seoulPrecisionActiveRef.current = true;
        map.once("idle", refreshMapData);
      };
      try {
        await loadSeoulBuildingCells({
          cells,
          center: [center.lng, center.lat],
          cache: precisionCellCacheRef.current,
          load: fetchPrecisionBuildings,
          paint: paintPrecisionBuildings,
        });
        if (requestId === precisionRequestRef.current) {
          precisionCoverageRef.current = requestBounds;
          while (precisionCellCacheRef.current.size > MAX_PRECISION_CACHE_CELLS) {
            const oldest = precisionCellCacheRef.current.keys().next().value;
            if (oldest === undefined) break;
            precisionCellCacheRef.current.delete(oldest);
          }
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        controller.abort();
        if (!seoulPrecisionActiveRef.current) showFallback();
        refreshMapData();
      } finally {
        if (requestId === precisionRequestRef.current) setBuildingLoading(false);
      }
    };

    map.on("style.load", () => {
      for (const layer of map.getStyle().layers) {
        if (
          layer.id !== FALLBACK_LAYER
          && layer.type === "fill-extrusion"
          && "source-layer" in layer
          && layer["source-layer"] === "building"
        ) {
          map.setLayoutProperty(layer.id, "visibility", "none");
        }
      }
      const fallbackHeight: ExpressionSpecification = [
        "case",
        [">", ["coalesce", ["get", "render_height"], 0], 0],
        ["get", "render_height"],
        DEFAULT_BUILDING_HEIGHT,
      ];
      map.setLayerZoomRange(FALLBACK_LAYER, 13, 24);
      map.setFilter(FALLBACK_LAYER, ["!", ["==", ["get", "hide_3d"], true]]);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-color", [
        "interpolate", ["linear"], fallbackHeight,
        4, BUILDING_COLORS[0], 30, BUILDING_COLORS[1], 100, BUILDING_COLORS[2],
      ]);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-height", fallbackHeight);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-base", ["coalesce", ["get", "render_min_height"], 0]);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-opacity", compactMap ? 0.88 : 0.92);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-vertical-gradient", !compactMap);
      map.addSource("seoul-buildings", { type: "geojson", data: EMPTY_SOURCE });
      map.addSource("solar-shadow", { type: "geojson", data: EMPTY_BUILDINGS });
      map.addSource("night-map-tint", { type: "geojson", data: NIGHT_TINT });
      map.addSource("analysis-points", { type: "geojson", data: EMPTY_POINTS });
      map.addSource("accumulated-shadow", { type: "geojson", data: EMPTY_BUILDINGS });
      map.addLayer({
        id: "night-map-tint",
        type: "fill",
        source: "night-map-tint",
        paint: {
          "fill-color": "#081426",
          "fill-opacity": solarRef.current.isDaylight ? 0 : 0.58,
        },
      });
      map.addLayer({
        id: "solar-shadow-fill",
        type: "fill",
        source: "solar-shadow",
        paint: {
          "fill-color": SHADOW_COLOR,
          "fill-opacity": [
            "interpolate", ["linear"], ["zoom"],
            13, ["*", 0.65, ["coalesce", ["get", "strength"], 0.2]],
            15.1, ["*", 1.25, ["coalesce", ["get", "strength"], 0.48]],
          ],
        },
      });
      map.addLayer({
        id: "accumulated-shadow-fill",
        type: "fill",
        source: "accumulated-shadow",
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["interpolate", ["linear"], ["coalesce", ["get", "shadowRatio"], 0], 0, "#fff7d1", 0.5, "#62c7ae", 1, "#087f6b"],
          "fill-opacity": 0.48,
          "fill-outline-color": "rgba(8,127,107,.28)",
        },
      });
      map.addLayer({
        id: "accumulated-shadow-label",
        type: "symbol",
        source: "accumulated-shadow",
        minzoom: 15,
        layout: { visibility: "none", "text-field": ["get", "label"], "text-size": 10 },
        paint: { "text-color": "#16453d", "text-halo-color": "#fff", "text-halo-width": 1 },
      });
      map.moveLayer(FALLBACK_LAYER);
      map.addLayer({
        id: SEOUL_LAYER,
        type: "fill-extrusion",
        source: "seoul-buildings",
        minzoom: 13,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "height"], 4, BUILDING_COLORS[0], 30, BUILDING_COLORS[1], 100, BUILDING_COLORS[2]],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": ["coalesce", ["get", "minHeight"], 0],
          "fill-extrusion-opacity": compactMap ? 0.9 : 0.94,
          "fill-extrusion-vertical-gradient": !compactMap,
        },
      });
      map.addLayer({
        id: "analysis-point-circles",
        type: "circle",
        source: "analysis-points",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 10, 8],
          "circle-color": ["match", ["get", "colorIndex"], 1, "#f05d5e", 2, "#377dff", 3, "#8e5bd9", 4, "#e18b18", "#f5b301"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });
      map.addLayer({
        id: "analysis-point-labels",
        type: "symbol",
        source: "analysis-points",
        layout: { "text-field": ["get", "indexLabel"], "text-size": 11, "text-allow-overlap": true },
        paint: { "text-color": "#252830", "text-halo-color": "#ffffff", "text-halo-width": 1 },
      });
      const initialPoints = comparisonPointsRef.current.map((point, index) => ({
        type: "Feature" as const,
        properties: { selected: selectedPointRef.current?.id === point.id, colorIndex: index + 1, indexLabel: String(index + 1) },
        geometry: { type: "Point" as const, coordinates: point.coordinates },
      }));
      if (selectedPointRef.current && !comparisonPointsRef.current.some((point) => point.id === selectedPointRef.current?.id)) {
        initialPoints.push({
          type: "Feature",
          properties: { selected: true, colorIndex: 0, indexLabel: "선택" },
          geometry: { type: "Point", coordinates: selectedPointRef.current.coordinates },
        });
      }
      (map.getSource("analysis-points") as GeoJSONSource).setData({ type: "FeatureCollection", features: initialPoints });
      (map.getSource("accumulated-shadow") as GeoJSONSource).setData(shadowOverlayRef.current ?? EMPTY_BUILDINGS);
      const overlayVisibility = showShadowOverlayRef.current && shadowOverlayRef.current ? "visible" : "none";
      map.setLayoutProperty("accumulated-shadow-fill", "visibility", overlayVisibility);
      map.setLayoutProperty("accumulated-shadow-label", "visibility", overlayVisibility);
      const initialCameraRequest = cameraRequestRef.current;
      applyCameraRequest(map, initialCameraRequest);
      if (!initialCameraRequest) void updatePrecisionBuildings();
      map.once("idle", refreshMapData);
    });
    map.on("movestart", () => {
      precisionAbortRef.current?.abort();
      precisionRequestRef.current += 1;
    });
    map.on("moveend", () => {
      const center = map.getCenter();
      onCenterChange([center.lng, center.lat]);
      // A long-distance jump can finish before the destination vector tiles.
      // Re-read real OSM footprints once those tiles are fully rendered.
      map.once("idle", refreshMapData);
      void updatePrecisionBuildings();
    });
    map.on("click", (event) => onSelectPointRef.current([event.lngLat.lng, event.lngLat.lat]));

    return () => {
      precisionAbortRef.current?.abort();
      if (shadowTimerRef.current !== null) window.clearTimeout(shadowTimerRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [applyCameraRequest, onCenterChange, scheduleShadowUpdate]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) applyCameraRequest(map, cameraRequest);
  }, [applyCameraRequest, cameraRequest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const points = comparisonPoints.map((point, index) => ({
      type: "Feature" as const,
      properties: { selected: selectedPoint?.id === point.id, colorIndex: index + 1, indexLabel: String(index + 1) },
      geometry: { type: "Point" as const, coordinates: point.coordinates },
    }));
    if (selectedPoint && !comparisonPoints.some((point) => point.id === selectedPoint.id)) {
      points.push({
        type: "Feature",
        properties: { selected: true, colorIndex: 0, indexLabel: "선택" },
        geometry: { type: "Point", coordinates: selectedPoint.coordinates },
      });
    }
    (map.getSource("analysis-points") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: points });
  }, [comparisonPoints, selectedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("accumulated-shadow") as GeoJSONSource | undefined)?.setData(shadowOverlay ?? EMPTY_BUILDINGS);
    const visibility = showShadowOverlay && shadowOverlay ? "visible" : "none";
    if (map.getLayer("accumulated-shadow-fill")) map.setLayoutProperty("accumulated-shadow-fill", "visibility", visibility);
    if (map.getLayer("accumulated-shadow-label")) map.setLayoutProperty("accumulated-shadow-label", "visibility", visibility);
  }, [shadowOverlay, showShadowOverlay]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer(NIGHT_TINT_LAYER)) {
      map.setPaintProperty("night-map-tint", "fill-opacity", solar.isDaylight ? 0 : 0.58);
    }
    if (mapContainer.current) mapContainer.current.dataset.theme = solar.isDaylight ? "day" : "night";
    scheduleShadowUpdate(35);
  }, [solar, scheduleShadowUpdate]);

  return (
    <>
      <div
        ref={mapContainer}
        className="map"
        aria-label="대한민국 인터랙티브 일조 지도"
        data-building-loading={buildingLoading ? "true" : "false"}
      />
      {buildingLoading && (
        <div className="building-loading" role="status" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true" />
          건물 불러오는 중
        </div>
      )}
    </>
  );
}
