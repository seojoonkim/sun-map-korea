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
