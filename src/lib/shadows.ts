import type { Feature, FeatureCollection, Polygon } from "geojson";

const EARTH_RADIUS = 6_371_000;

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

function pointFromMeters(center: [number, number], east: number, north: number): [number, number] {
  const latRadians = center[1] * Math.PI / 180;
  return [center[0] + east / (111_320 * Math.cos(latRadians)), center[1] + north / 110_540];
}

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

export function createPrototypeBuildings(center: [number, number]): FeatureCollection<Polygon> {
  const specs = [
    [-190, -105, 58, 34, 48, -12], [-105, -135, 42, 60, 31, 8], [-25, -120, 64, 35, 76, -8],
    [80, -130, 48, 54, 42, 14], [175, -90, 72, 38, 64, -5], [-175, -5, 44, 72, 27, 10],
    [-85, -20, 65, 45, 88, -14], [35, -10, 46, 74, 52, 6], [145, 5, 75, 42, 36, -9],
    [-165, 100, 62, 38, 57, 12], [-70, 105, 45, 65, 34, -6], [25, 115, 70, 40, 92, 9],
    [125, 105, 42, 55, 46, -12], [-115, 195, 76, 38, 39, 5], [0, 200, 48, 70, 67, -8],
    [120, 195, 68, 40, 29, 11],
  ] as const;
  const features: Feature<Polygon>[] = specs.map(([east, north, width, depth, height, rotation], index) => {
    const angle = rotation * Math.PI / 180;
    const corners: [number, number][] = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
    const ring = corners.map(([x, y]) => pointFromMeters(
      center,
      east + x * Math.cos(angle) - y * Math.sin(angle),
      north + x * Math.sin(angle) + y * Math.cos(angle),
    ));
    ring.push(ring[0]);
    return { type: "Feature", properties: { id: `prototype-${index + 1}`, height }, geometry: { type: "Polygon", coordinates: [ring] } };
  });
  return { type: "FeatureCollection", features };
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
