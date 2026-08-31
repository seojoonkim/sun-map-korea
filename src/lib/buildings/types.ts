import type { MultiPolygon, Polygon } from "geojson";

export type HeightQuality =
  | "surveyed"
  | "tagged"
  | "floors-estimated"
  | "default-estimated";

export type FootprintSource = "smap-2025" | "openfreemap-osm";

export type AnalysisBuilding = {
  id: string;
  geometry: Polygon | MultiPolygon;
  height: number;
  minHeight: number;
  groundElevation?: number;
  topElevation?: number;
  heightQuality: HeightQuality;
  footprintSource: FootprintSource;
};

export type BuildingBounds = [number, number, number, number];

export type BuildingQuery = {
  bounds: BuildingBounds;
  purpose: "point-report" | "comparison" | "ground-overlay";
  target?: [number, number];
  minimumSunElevation: number;
};

export type BuildingQueryMeta = {
  complete: boolean;
  provider: "smap" | "openfreemap" | "hybrid";
  requestedBounds: BuildingBounds;
  coveredBounds: BuildingBounds;
  sourceVersion: string;
  featureCount: number;
  truncatedCells: string[];
  estimatedHeightRatio: number;
  warnings: string[];
};

export interface BuildingProvider {
  getBuildings(query: BuildingQuery, signal?: AbortSignal): Promise<{
    buildings: AnalysisBuilding[];
    meta: BuildingQueryMeta;
  }>;
}
