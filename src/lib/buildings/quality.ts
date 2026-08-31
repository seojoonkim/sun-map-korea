import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { AnalysisBuilding, FootprintSource, HeightQuality } from "./types";

const DEFAULT_HEIGHT_METERS = 9;
const FLOOR_HEIGHT_METERS = 3;
const MIN_BUILDING_HEIGHT_METERS = 0.5;
const MAX_BUILDING_HEIGHT_METERS = 1_000;

type BuildingFeature = Feature<Polygon | MultiPolygon, Record<string, unknown> | null>;

function finitePositive(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNonNegative(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sourceId(feature: BuildingFeature, source: FootprintSource): string {
  const upstream = feature.id ?? feature.properties?.id ?? JSON.stringify(feature.geometry);
  return `${source}:${String(upstream)}`;
}

function validHeight(height: number): boolean {
  return height >= MIN_BUILDING_HEIGHT_METERS && height <= MAX_BUILDING_HEIGHT_METERS;
}

export function normalizeSmapBuilding(feature: BuildingFeature): AnalysisBuilding | null {
  const properties = feature.properties ?? {};
  const groundElevation = finiteNonNegative(properties.min);
  const topElevation = finitePositive(properties.max);
  if (groundElevation === null || topElevation === null) return null;
  const height = topElevation - groundElevation;
  if (!validHeight(height)) return null;

  return {
    id: sourceId(feature, "smap-2025"),
    geometry: feature.geometry,
    height,
    minHeight: 0,
    groundElevation,
    topElevation,
    heightQuality: "surveyed",
    footprintSource: "smap-2025",
  };
}

export function normalizeOpenFreeMapBuilding(feature: BuildingFeature): AnalysisBuilding | null {
  const properties = feature.properties ?? {};
  if (properties.hide_3d === true) return null;

  const explicitHeight = finitePositive(properties.render_height ?? properties.height);
  const floors = finitePositive(properties.num_floors ?? properties.levels);
  let height: number;
  let heightQuality: HeightQuality;
  if (explicitHeight !== null && validHeight(explicitHeight)) {
    height = explicitHeight;
    heightQuality = "tagged";
  } else if (floors !== null && validHeight(floors * FLOOR_HEIGHT_METERS)) {
    height = floors * FLOOR_HEIGHT_METERS;
    heightQuality = "floors-estimated";
  } else {
    height = DEFAULT_HEIGHT_METERS;
    heightQuality = "default-estimated";
  }

  const rawMinHeight = finiteNonNegative(
    properties.render_min_height ?? properties.min_height,
  );
  const minHeight = rawMinHeight !== null && rawMinHeight < height ? rawMinHeight : 0;

  return {
    id: sourceId(feature, "openfreemap-osm"),
    geometry: feature.geometry,
    height,
    minHeight,
    heightQuality,
    footprintSource: "openfreemap-osm",
  };
}

export function summarizeBuildingQuality(buildings: AnalysisBuilding[]) {
  const estimatedHeightCount = buildings.filter(
    ({ heightQuality }) => heightQuality === "floors-estimated" || heightQuality === "default-estimated",
  ).length;
  return {
    featureCount: buildings.length,
    estimatedHeightCount,
    estimatedHeightRatio: buildings.length === 0 ? 0 : estimatedHeightCount / buildings.length,
  };
}
