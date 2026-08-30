"use client";

import { useCallback, useEffect, useRef } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, type ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { SolarPosition } from "@/lib/solar";
import {
  buildSeoulBuildingRequest,
  isPotentialSeoulViewport,
  normalizeSeoulBuildings,
} from "@/lib/building-sources";
import { createBuildingShadows, DEFAULT_BUILDING_HEIGHT, normalizeBuildingFeatures } from "@/lib/shadows";

const SEOUL_CENTER: [number, number] = [127.02761, 37.49794];
const KOREA_BOUNDS: [[number, number], [number, number]] = [[124.0, 32.2], [132.2, 39.2]];
const EMPTY_BUILDINGS: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };
const EMPTY_SOURCE: FeatureCollection<Polygon | MultiPolygon> = { type: "FeatureCollection", features: [] };
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

type MapCanvasProps = {
  solar: SolarPosition;
  onCenterChange: (coordinates: [number, number]) => void;
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

export default function MapCanvas({ solar, onCenterChange, cameraRequest }: MapCanvasProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const buildingsRef = useRef<FeatureCollection<Polygon>>(EMPTY_BUILDINGS);
  const shadowTimerRef = useRef<number | null>(null);
  const precisionAbortRef = useRef<AbortController | null>(null);
  const precisionRequestRef = useRef(0);
  const seoulPrecisionActiveRef = useRef(false);
  const solarRef = useRef(solar);
  const cameraRequestRef = useRef(cameraRequest);
  solarRef.current = solar;
  cameraRequestRef.current = cameraRequest;

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
        duration: 1000,
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
        showFallback();
        (map.getSource("seoul-buildings") as GeoJSONSource | undefined)?.setData(EMPTY_SOURCE);
        refreshMapData();
        return;
      }

      const bounds = map.getBounds();
      let requestUrl: string;
      try {
        requestUrl = buildSeoulBuildingRequest([
          bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
        ]);
      } catch {
        showFallback();
        refreshMapData();
        return;
      }

      const controller = new AbortController();
      precisionAbortRef.current = controller;
      const requestId = ++precisionRequestRef.current;
      try {
        const response = await fetch(requestUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`Seoul buildings ${response.status}`);
        const collection = await response.json() as FeatureCollection<Polygon | MultiPolygon>;
        if (requestId !== precisionRequestRef.current) return;
        const normalized = normalizeSeoulBuildings(collection.features);
        if (normalized.features.length === 0) {
          showFallback();
        } else {
          (map.getSource("seoul-buildings") as GeoJSONSource).setData(normalized);
          map.setLayoutProperty(FALLBACK_LAYER, "visibility", "visible");
          map.setLayoutProperty(SEOUL_LAYER, "visibility", "visible");
          seoulPrecisionActiveRef.current = true;
        }
        map.once("idle", refreshMapData);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        showFallback();
        refreshMapData();
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
        4, "#ffb9d7", 30, "#92ddff", 100, "#fff0a6",
      ]);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-height", fallbackHeight);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-base", ["coalesce", ["get", "render_min_height"], 0]);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-opacity", compactMap ? 0.88 : 0.92);
      map.setPaintProperty(FALLBACK_LAYER, "fill-extrusion-vertical-gradient", !compactMap);
      map.addSource("seoul-buildings", { type: "geojson", data: EMPTY_SOURCE });
      map.addSource("solar-shadow", { type: "geojson", data: EMPTY_BUILDINGS });
      map.addSource("night-map-tint", { type: "geojson", data: NIGHT_TINT });
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
          "fill-color": "#7967d8",
          "fill-opacity": ["step", ["zoom"], 0.2, 15.1, ["coalesce", ["get", "strength"], 0.48]],
        },
      });
      map.moveLayer(FALLBACK_LAYER);
      map.addLayer({
        id: SEOUL_LAYER,
        type: "fill-extrusion",
        source: "seoul-buildings",
        minzoom: 13,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "height"], 4, "#ffb9d7", 30, "#92ddff", 100, "#fff0a6"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": ["coalesce", ["get", "minHeight"], 0],
          "fill-extrusion-opacity": compactMap ? 0.9 : 0.94,
          "fill-extrusion-vertical-gradient": !compactMap,
        },
      });
      const initialCameraRequest = cameraRequestRef.current;
      applyCameraRequest(map, initialCameraRequest);
      if (!initialCameraRequest) void updatePrecisionBuildings();
      map.once("idle", refreshMapData);
    });
    map.on("movestart", () => {
      precisionAbortRef.current?.abort();
      precisionRequestRef.current += 1;
      showFallback();
    });
    map.on("moveend", () => void updatePrecisionBuildings());

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
    if (map?.getLayer(NIGHT_TINT_LAYER)) {
      map.setPaintProperty("night-map-tint", "fill-opacity", solar.isDaylight ? 0 : 0.58);
    }
    if (mapContainer.current) mapContainer.current.dataset.theme = solar.isDaylight ? "day" : "night";
    scheduleShadowUpdate(35);
  }, [solar, scheduleShadowUpdate]);

  return <div ref={mapContainer} className="map" aria-label="대한민국 인터랙티브 일조 지도" />;
}
