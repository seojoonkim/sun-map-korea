import type { MultiPolygon, Polygon, Position } from "geojson";
import type { AnalysisBuilding } from "@/lib/buildings/types";
import type { SunPrism } from "./direct-sun";

const EARTH_RADIUS_METERS = 6_371_008.8;
const toRadians = (degrees: number) => degrees * Math.PI / 180;
const toDegrees = (radians: number) => radians * 180 / Math.PI;

export function createLocalProjector(origin: [number, number]) {
  const [originLongitude, originLatitude] = origin;
  const originLatitudeRadians = toRadians(originLatitude);
  const longitudeScale = EARTH_RADIUS_METERS * Math.cos(originLatitudeRadians);

  return {
    project(coordinates: Position): [number, number] {
      return [
        toRadians(coordinates[0] - originLongitude) * longitudeScale,
        toRadians(coordinates[1] - originLatitude) * EARTH_RADIUS_METERS,
      ];
    },
    unproject(coordinates: [number, number]): [number, number] {
      return [
        originLongitude + toDegrees(coordinates[0] / longitudeScale),
        originLatitude + toDegrees(coordinates[1] / EARTH_RADIUS_METERS),
      ];
    },
  };
}

function projectGeometry(
  geometry: Polygon | MultiPolygon,
  project: (position: Position) => [number, number],
): Polygon | MultiPolygon {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => ring.map(project)),
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map(
      (polygon) => polygon.map((ring) => ring.map(project)),
    ),
  };
}

export function projectAnalysisBuildings(
  buildings: AnalysisBuilding[],
  origin: [number, number],
): SunPrism[] {
  const projector = createLocalProjector(origin);
  return buildings.map((building) => ({
    id: building.id,
    geometry: projectGeometry(building.geometry, projector.project),
    minZ: building.minHeight,
    maxZ: building.height,
  }));
}
