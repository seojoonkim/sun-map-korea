import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

export const NATIONWIDE_BUILDINGS_URL = "https://tiles.openfreemap.org/planet";

export const SEOUL_PRECISION_MIN_ZOOM = 13.5;
const SEOUL_BOUNDS = {
  west: 126.76,
  south: 37.41,
  east: 127.19,
  north: 37.72,
};
const MAX_VIEWPORT_SPAN = 0.25;
const PRECISION_PREFETCH_RATIO = 0.25;

export type BuildingBounds = [number, number, number, number];
type BuildingGeometry = Polygon | MultiPolygon;
type SourceFeature = Feature<BuildingGeometry>;

export function isPotentialSeoulViewport(center: [number, number], zoom: number) {
  const [longitude, latitude] = center;
  return zoom >= SEOUL_PRECISION_MIN_ZOOM
    && longitude >= SEOUL_BOUNDS.west
    && longitude <= SEOUL_BOUNDS.east
    && latitude >= SEOUL_BOUNDS.south
    && latitude <= SEOUL_BOUNDS.north;
}

export function buildingBoundsContain(outer: BuildingBounds | null, inner: BuildingBounds) {
  if (!outer) return false;
  return outer[0] <= inner[0]
    && outer[1] <= inner[1]
    && outer[2] >= inner[2]
    && outer[3] >= inner[3];
}

export function expandSeoulBuildingBounds(bounds: BuildingBounds): BuildingBounds {
  const [west, south, east, north] = bounds;
  const longitudePadding = (east - west) * PRECISION_PREFETCH_RATIO;
  const latitudePadding = (north - south) * PRECISION_PREFETCH_RATIO;
  const expanded: BuildingBounds = [
    Math.max(SEOUL_BOUNDS.west, west - longitudePadding),
    Math.max(SEOUL_BOUNDS.south, south - latitudePadding),
    Math.min(SEOUL_BOUNDS.east, east + longitudePadding),
    Math.min(SEOUL_BOUNDS.north, north + latitudePadding),
  ];
  const centerLongitude = (west + east) / 2;
  const centerLatitude = (south + north) / 2;
  if (expanded[2] - expanded[0] > MAX_VIEWPORT_SPAN) {
    expanded[0] = centerLongitude - MAX_VIEWPORT_SPAN / 2;
    expanded[2] = centerLongitude + MAX_VIEWPORT_SPAN / 2;
  }
  if (expanded[3] - expanded[1] > MAX_VIEWPORT_SPAN) {
    expanded[1] = centerLatitude - MAX_VIEWPORT_SPAN / 2;
    expanded[3] = centerLatitude + MAX_VIEWPORT_SPAN / 2;
  }
  return expanded.map((coordinate) => Number(coordinate.toFixed(6))) as BuildingBounds;
}

export function buildSeoulBuildingRequest(bbox: BuildingBounds) {
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every(Number.isFinite)
    || west >= east
    || south >= north
    || east - west > MAX_VIEWPORT_SPAN
    || north - south > MAX_VIEWPORT_SPAN) {
    throw new Error("Building viewport is invalid or too large");
  }
  return `/api/buildings/seoul?bbox=${bbox.map((coordinate) => coordinate.toFixed(6)).join(",")}`;
}

export function normalizeSeoulBuildings(features: SourceFeature[]): FeatureCollection<BuildingGeometry> {
  const normalized = features.flatMap((feature) => {
    const rawMinimum = feature.properties?.min;
    const rawMaximum = feature.properties?.max;
    if (rawMinimum === null || rawMinimum === undefined || rawMaximum === null || rawMaximum === undefined) return [];
    const minimum = Number(rawMinimum);
    const maximum = Number(rawMaximum);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return [];
    const height = Math.round((maximum - minimum) * 100) / 100;
    return [{
      type: "Feature" as const,
      id: feature.id ?? feature.properties?.id as string | number | undefined,
      geometry: feature.geometry,
      properties: {
        height,
        minHeight: 0,
        heightEstimated: false,
        heightSource: "smap-2025-elevation-span",
        heightConfidence: "A",
        footprintSource: "smap-2025",
      },
    }];
  });
  return { type: "FeatureCollection", features: normalized };
}
