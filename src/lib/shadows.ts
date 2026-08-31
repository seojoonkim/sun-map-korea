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

export function shadowOpacityForElevation(elevation: number): number {
  if (elevation <= 0) return 0;
  const normalizedHeight = Math.sin(Math.min(90, elevation) * Math.PI / 180);
  return Math.min(0.78, 0.18 + 0.6 * normalizedHeight ** 0.65);
}

export function createBuildingShadows(
  buildings: FeatureCollection<Polygon>,
  sunAzimuth: number,
  elevation: number,
): FeatureCollection<Polygon> {
  if (elevation <= 0) return { type: "FeatureCollection", features: [] };
  const bearing = (sunAzimuth + 180) % 360;
  const strength = shadowOpacityForElevation(elevation);
  const features: Feature<Polygon>[] = buildings.features.map((building, index) => {
    const height = Number(building.properties?.height ?? 24);
    const shadowLength = Math.min(520, height / Math.tan(Math.max(4, elevation) * Math.PI / 180));
    const footprint = building.geometry.coordinates[0].slice(0, -1) as [number, number][];
    const shifted = footprint.map((point) => destination(point, bearing, shadowLength));
    const hull = convexHull([...footprint, ...shifted]);
    hull.push(hull[0]);
    return {
      type: "Feature",
      properties: {
        id: building.properties?.id ?? `shadow-${index}`,
        height,
        shadowLength,
        strength,
      },
      geometry: { type: "Polygon", coordinates: [hull] },
    };
  });
  return { type: "FeatureCollection", features };
}

type WallShadowProperties = {
  height: number;
  minHeight: number;
  segmentHeight: number;
  wallShade: "sunlit" | "occluded";
  sourceHeight: number;
};

type BuildingMetric = {
  feature: Feature<Polygon>;
  index: number;
  x: number;
  y: number;
  radius: number;
  height: number;
  minHeight: number;
};

function withAltitude(coordinates: Polygon["coordinates"], altitude: number): Polygon["coordinates"] {
  return coordinates.map((ring) => ring.map(([lng, lat]) => [lng, lat, altitude]));
}

/** Split receiver walls at the height reached by a neighbouring building's shadow. */
export function createWallShadowSegments(
  buildings: FeatureCollection<Polygon>,
  sunAzimuth: number,
  elevation: number,
): FeatureCollection<Polygon, WallShadowProperties> {
  if (buildings.features.length === 0) return { type: "FeatureCollection", features: [] };
  const origin = buildings.features[0].geometry.coordinates[0][0] as [number, number];
  const latScale = Math.PI * EARTH_RADIUS / 180;
  const lngScale = latScale * Math.cos(origin[1] * Math.PI / 180);
  const cellSize = 48;
  const metrics: BuildingMetric[] = buildings.features.map((feature, index) => {
    const ring = feature.geometry.coordinates[0].slice(0, -1) as [number, number][];
    const center = ring.reduce((sum, [lng, lat]) => [sum[0] + lng, sum[1] + lat], [0, 0]);
    const lng = center[0] / ring.length;
    const lat = center[1] / ring.length;
    const x = (lng - origin[0]) * lngScale;
    const y = (lat - origin[1]) * latScale;
    const radius = Math.max(3, ...ring.map(([px, py]) => Math.hypot(
      (px - lng) * lngScale,
      (py - lat) * latScale,
    )));
    const height = Math.max(DEFAULT_BUILDING_HEIGHT, Number(feature.properties?.height ?? DEFAULT_BUILDING_HEIGHT));
    const minHeight = Math.max(0, Number(feature.properties?.minHeight ?? 0));
    return { feature, index, x, y, radius, height, minHeight };
  });
  const grid = new Map<string, BuildingMetric[]>();
  const gridKey = (x: number, y: number) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
  for (const metric of metrics) {
    const key = gridKey(metric.x, metric.y);
    const bucket = grid.get(key) ?? [];
    bucket.push(metric);
    grid.set(key, bucket);
  }

  const shadowTopByReceiver = new Map<number, number>();
  if (elevation > 1) {
    const elevationRadians = elevation * Math.PI / 180;
    const shadowBearing = (sunAzimuth + 180) * Math.PI / 180;
    const dx = Math.sin(shadowBearing);
    const dy = Math.cos(shadowBearing);
    for (const blocker of metrics) {
      const length = Math.min(420, blocker.height / Math.tan(elevationRadians));
      const visited = new Set<string>();
      for (let distance = cellSize * 0.5; distance <= length + cellSize; distance += cellSize * 0.7) {
        const sampleX = blocker.x + dx * distance;
        const sampleY = blocker.y + dy * distance;
        const gx = Math.floor(sampleX / cellSize);
        const gy = Math.floor(sampleY / cellSize);
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            const key = `${gx + ox}:${gy + oy}`;
            if (visited.has(key)) continue;
            visited.add(key);
            for (const receiver of grid.get(key) ?? []) {
              if (receiver.index === blocker.index) continue;
              const vx = receiver.x - blocker.x;
              const vy = receiver.y - blocker.y;
              const along = vx * dx + vy * dy;
              if (along <= 0 || along > length + receiver.radius) continue;
              const lateral = Math.abs(vx * dy - vy * dx);
              if (lateral > blocker.radius + receiver.radius * 0.7) continue;
              const shadowTop = blocker.height - along * Math.tan(elevationRadians);
              const visibleTop = Math.min(receiver.height - 1.5, shadowTop);
              if (visibleTop <= receiver.minHeight + 2) continue;
              shadowTopByReceiver.set(
                receiver.index,
                Math.max(shadowTopByReceiver.get(receiver.index) ?? receiver.minHeight, visibleTop),
              );
            }
          }
        }
      }
    }
  }

  const segments: Feature<Polygon, WallShadowProperties>[] = [];
  for (const metric of metrics) {
    const shadowTop = shadowTopByReceiver.get(metric.index);
    const common = { sourceHeight: metric.height };
    if (shadowTop) {
      segments.push({
        type: "Feature",
        properties: { ...common, height: shadowTop, minHeight: metric.minHeight, segmentHeight: shadowTop - metric.minHeight, wallShade: "occluded" },
        geometry: { type: "Polygon", coordinates: withAltitude(metric.feature.geometry.coordinates, metric.minHeight) },
      });
      segments.push({
        type: "Feature",
        properties: { ...common, height: metric.height, minHeight: shadowTop, segmentHeight: metric.height - shadowTop, wallShade: "sunlit" },
        geometry: { type: "Polygon", coordinates: withAltitude(metric.feature.geometry.coordinates, shadowTop) },
      });
    } else {
      segments.push({
        type: "Feature",
        properties: { ...common, height: metric.height, minHeight: metric.minHeight, segmentHeight: metric.height - metric.minHeight, wallShade: "sunlit" },
        geometry: { type: "Polygon", coordinates: withAltitude(metric.feature.geometry.coordinates, metric.minHeight) },
      });
    }
  }
  return { type: "FeatureCollection", features: segments };
}
