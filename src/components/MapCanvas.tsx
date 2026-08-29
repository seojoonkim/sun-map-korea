"use client";

import { useCallback, useEffect, useRef } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { SolarPosition } from "@/lib/solar";
import { createBuildingShadows, normalizeBuildingFeatures } from "@/lib/shadows";

const GANGNAM_CENTER: [number, number] = [127.02761, 37.49794];
const EMPTY_BUILDINGS: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };

const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{
    id: "osm-base",
    type: "raster",
    source: "carto",
    paint: {
      "raster-brightness-max": 0.62,
      "raster-contrast": 0.18,
      "raster-saturation": -0.55,
      "raster-fade-duration": 0,
    },
  }],
};

type MapCanvasProps = {
  solar: SolarPosition;
  onCenterChange: (coordinates: [number, number]) => void;
};

export default function MapCanvas({ solar, onCenterChange }: MapCanvasProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const buildingsRef = useRef<FeatureCollection<Polygon>>(EMPTY_BUILDINGS);
  const shadowTimerRef = useRef<number | null>(null);
  const solarRef = useRef(solar);
  solarRef.current = solar;

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
      style: RASTER_STYLE,
      center: GANGNAM_CENTER,
      zoom: compactMap ? 14.7 : 15.35,
      pitch: compactMap ? 38 : 53,
      bearing: compactMap ? -10 : -18,
      minZoom: 12.2,
      maxZoom: 18,
      maxBounds: [[126.965, 37.455], [127.115, 37.565]],
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
          "fill-color": "#263348",
          "fill-opacity": ["step", ["zoom"], 0.24, 15.1, ["coalesce", ["get", "strength"], 0.62]],
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
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "render_height"], 4, "#505b57", 30, "#7e8c86", 100, "#bcc8c2"],
          "fill-extrusion-height": ["get", "render_height"],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": compactMap ? 0.88 : 0.92,
          "fill-extrusion-vertical-gradient": !compactMap,
        },
      });
      map.once("idle", refreshMapData);
    });
    map.on("moveend", refreshMapData);

    return () => {
      if (shadowTimerRef.current !== null) window.clearTimeout(shadowTimerRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [onCenterChange, scheduleShadowUpdate]);

  useEffect(() => scheduleShadowUpdate(35), [solar, scheduleShadowUpdate]);

  return <div ref={mapContainer} className="map" aria-label="강남구 인터랙티브 일조 지도" />;
}
