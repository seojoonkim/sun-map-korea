"use client";

import { useCallback, useEffect, useRef } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { SolarPosition } from "@/lib/solar";
import { createBuildingShadows, normalizeBuildingFeatures } from "@/lib/shadows";

const SEOUL_CENTER: [number, number] = [127.02761, 37.49794];
const KOREA_BOUNDS: [[number, number], [number, number]] = [[124.0, 32.2], [132.2, 39.2]];
const EMPTY_BUILDINGS: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };

const BASE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

type MapCanvasProps = {
  solar: SolarPosition;
  onCenterChange: (coordinates: [number, number]) => void;
  cameraRequest: {
    id: number;
    mode: "place" | "country";
    center?: [number, number];
  } | null;
};

export default function MapCanvas({ solar, onCenterChange, cameraRequest }: MapCanvasProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const buildingsRef = useRef<FeatureCollection<Polygon>>(EMPTY_BUILDINGS);
  const shadowTimerRef = useRef<number | null>(null);
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
      if (!map.getLayer("osm-building-3d")) return;
      const center = map.getCenter();
      onCenterChange([center.lng, center.lat]);
      const canvas = map.getCanvas();
      const visibleFeatures = map.queryRenderedFeatures(
        [[0, 0], [canvas.clientWidth, canvas.clientHeight]],
        { layers: ["osm-building-3d"] },
      ).filter((feature) => feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon");
      buildingsRef.current = normalizeBuildingFeatures(visibleFeatures as unknown as Array<{
        id?: string | number;
        properties: Record<string, unknown> | null;
        geometry: Polygon | MultiPolygon;
      }>);
      scheduleShadowUpdate(compactMap ? 140 : 50);
    };

    map.on("style.load", () => {
      map.addSource("osm-buildings", { type: "vector", url: "https://tiles.openfreemap.org/planet" });
      map.addSource("solar-shadow", { type: "geojson", data: EMPTY_BUILDINGS });
      map.addLayer({
        id: "solar-shadow-fill",
        type: "fill",
        source: "solar-shadow",
        paint: {
          "fill-color": "#7967d8",
          "fill-opacity": ["step", ["zoom"], 0.2, 15.1, ["coalesce", ["get", "strength"], 0.48]],
        },
      });
      map.addLayer({
        id: "osm-building-3d",
        type: "fill-extrusion",
        source: "osm-buildings",
        "source-layer": "building",
        minzoom: 13,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "render_height"], 4, "#ffb9d7", 30, "#92ddff", 100, "#fff0a6"],
          "fill-extrusion-height": ["get", "render_height"],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": compactMap ? 0.88 : 0.92,
          "fill-extrusion-vertical-gradient": !compactMap,
        },
      });
      applyCameraRequest(map, cameraRequestRef.current);
      map.once("idle", refreshMapData);
    });
    map.on("moveend", refreshMapData);

    return () => {
      if (shadowTimerRef.current !== null) window.clearTimeout(shadowTimerRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [applyCameraRequest, onCenterChange, scheduleShadowUpdate]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) applyCameraRequest(map, cameraRequest);
  }, [applyCameraRequest, cameraRequest]);

  useEffect(() => scheduleShadowUpdate(35), [solar, scheduleShadowUpdate]);

  return <div ref={mapContainer} className="map" aria-label="대한민국 인터랙티브 일조 지도" />;
}
