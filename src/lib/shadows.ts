import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

const EARTH_RADIUS = 6_371_000;
export const DEFAULT_BUILDING_HEIGHT = 9;

function destination([lng, lat]: [number, number], bearing: number, distance: number): [number, number] {
  const angular = distance / EARTH_RADIUS;
  const brng = bearing * Math.PI / 180;
  const phi1 = lat * Math.PI / 180;
  const lambda1 = lng * Math.PI / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angular) + Math.cos(phi1) * Math.sin(angular) * Math.cos(brng));
  const lambda2 = lambda1 + Math.atan2(Math.sin(brng) * Math.sin(angular) * Math.cos(phi1), Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2));
  return [lambda2 * 180 / Math.PI, phi2 * 180 / Math.PI];
}

export function createShadowFan(center: [number, number], sunAzimuth: number, elevation: number): FeatureCollection<Polygon> {
  if (elevation <= 0) return { type: "FeatureCollection", features: [] };
  const shadowBearing = (sunAzimuth + 180) % 360;
  const length = Math.min(1050, Math.max(170, 580 / Math.tan(Math.max(7, elevation) * Math.PI / 180)));
  const features: Feature<Polygon>[] = [-16, -8, 0, 8, 16].map((offset, index) => {
    const startLeft = destination(center, shadowBearing + offset - 2.5, 36);
    const end = destination(center, shadowBearing + offset, length * (0.72 + index * 0.07));
    const startRight = destination(center, shadowBearing + offset + 2.5, 36);
    return {
      type: "Feature",
      properties: { strength: 0.58 - Math.abs(index - 2) * 0.07 },
      geometry: { type: "Polygon", coordinates: [[center, startLeft, end, startRight, center]] },
    };
  });
  return { type: "FeatureCollection", features };
}

type RawBuildingFeature = Pick<Feature<Polygon | MultiPolygon>, "geometry" | "properties"> & { id?: string | number };

function convexHull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: [number, number][] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Converts the currently loaded OpenMapTiles building features to one polygon per
 * real OSM footprint. A conservative three-storey estimate keeps footprints
 * without height tags visible while preserving explicit OSM heights.
 */
export function normalizeBuildingFeatures(features: readonly RawBuildingFeature[]): FeatureCollection<Polygon> {
  const normalized: Feature<Polygon>[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    if (feature.properties?.hide_3d === true) continue;
    const explicitHeight = Number(feature.properties?.render_height ?? feature.properties?.height);
    const floorCount = Number(feature.properties?.num_floors ?? feature.properties?.levels);
    const hasExplicitHeight = Number.isFinite(explicitHeight) && explicitHeight > 0;
    const hasFloorEstimate = Number.isFinite(floorCount) && floorCount > 0;
    const height = hasExplicitHeight
      ? explicitHeight
      : hasFloorEstimate
        ? floorCount * 3
        : DEFAULT_BUILDING_HEIGHT;
    const heightEstimated = feature.properties?.heightEstimated === false
      ? false
      : !hasExplicitHeight;
    const rawMinHeight = Number(
      feature.properties?.render_min_height
      ?? feature.properties?.min_height
      ?? feature.properties?.minHeight
      ?? 0,
    );
    const minHeight = Number.isFinite(rawMinHeight) && rawMinHeight >= 0 ? Math.min(rawMinHeight, height) : 0;
    const polygons = feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

    polygons.forEach((coordinates, partIndex) => {
      if (!coordinates[0] || coordinates[0].length < 4) return;
      const fingerprint = `${height}:${JSON.stringify(coordinates)}`;
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      normalized.push({
        type: "Feature",
        properties: {
          id: feature.id == null ? `osm-${normalized.length + 1}` : `${feature.id}-${partIndex}`,
          height,
          minHeight,
          heightEstimated,
          source: feature.properties?.footprintSource ?? feature.properties?.source ?? "OpenStreetMap",
        },
        geometry: { type: "Polygon", coordinates },
      });
    });
  }

  return { type: "FeatureCollection", features: normalized };
}

export function createBuildingShadows(
  buildings: FeatureCollection<Polygon>,
  sunAzimuth: number,
  elevation: number,
): FeatureCollection<Polygon> {
  if (elevation <= 0) return { type: "FeatureCollection", features: [] };
  const bearing = (sunAzimuth + 180) % 360;
  const features: Feature<Polygon>[] = buildings.features.map((building, index) => {
    const height = Number(building.properties?.height ?? 24);
    const shadowLength = Math.min(520, height / Math.tan(Math.max(4, elevation) * Math.PI / 180));
    const footprint = building.geometry.coordinates[0].slice(0, -1) as [number, number][];
    const shifted = footprint.map((point) => destination(point, bearing, shadowLength));
    const hull = convexHull([...footprint, ...shifted]);
    hull.push(hull[0]);
    return {
      type: "Feature",
      properties: { id: building.properties?.id ?? `shadow-${index}`, height, shadowLength, strength: 0.78 },
      geometry: { type: "Polygon", coordinates: [hull] },
    };
  });
  return { type: "FeatureCollection", features };
}
