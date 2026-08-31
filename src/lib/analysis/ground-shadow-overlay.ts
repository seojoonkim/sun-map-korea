import type { FeatureCollection, Polygon } from "geojson";
import type { BuildingBounds, BuildingQueryMeta } from "@/lib/buildings/types";
import { dateAtKst, getSolarPosition } from "@/lib/solar";
import { createSunPrismIndex, evaluateDirectSun, type SunPrism } from "./direct-sun";
import { createLocalProjector } from "./local-coordinates";
import { accumulateShadowMasks, shadowRatiosToGeoJson } from "./shadow-raster";

export type GenerateGroundShadowOverlayInput = {
  date: string;
  coordinates: [number, number];
  bounds: BuildingBounds;
  columns: number;
  rows: number;
  buildings: SunPrism[];
  buildingMeta: BuildingQueryMeta;
  sampleMinutes?: 5 | 10;
  minimumPreciseElevation?: number;
  solarPosition?: (date: Date, minute: number) => { azimuth: number; elevation: number };
};

export type GroundShadowOverlay = {
  complete: boolean;
  sourceVersion: string;
  validSamples: number;
  warnings: string[];
  geojson: FeatureCollection<Polygon, {
    shadowRatio: number;
    shadowPercent: number;
    label: string;
  }>;
};

function emptyGeoJson(): GroundShadowOverlay["geojson"] {
  return { type: "FeatureCollection", features: [] };
}

export function generateGroundShadowOverlay(input: GenerateGroundShadowOverlayInput): GroundShadowOverlay {
  if (!Number.isSafeInteger(input.columns) || !Number.isSafeInteger(input.rows) || input.columns <= 0 || input.rows <= 0) {
    throw new Error("Ground shadow grid dimensions are invalid");
  }
  if (!input.buildingMeta.complete) {
    return {
      complete: false,
      sourceVersion: input.buildingMeta.sourceVersion,
      validSamples: 0,
      warnings: [...input.buildingMeta.warnings],
      geojson: emptyGeoJson(),
    };
  }

  const sampleMinutes = input.sampleMinutes ?? 10;
  const minimumPreciseElevation = input.minimumPreciseElevation ?? 10;
  const projector = createLocalProjector(input.coordinates);
  const index = createSunPrismIndex(input.buildings);
  const [west, south, east, north] = input.bounds;
  const cellWidth = (east - west) / input.columns;
  const cellHeight = (north - south) / input.rows;
  const targets = Array.from({ length: input.columns * input.rows }, (_, cellIndex) => {
    const column = cellIndex % input.columns;
    const row = Math.floor(cellIndex / input.columns);
    const longitude = west + (column + 0.5) * cellWidth;
    const latitude = south + (row + 0.5) * cellHeight;
    const [x, y] = projector.project([longitude, latitude]);
    return { x, y, z: 0 };
  });
  const solarPosition = input.solarPosition
    ?? ((date: Date) => getSolarPosition(date, input.coordinates[1], input.coordinates[0]));
  const masks: Array<Uint8Array | null> = [];

  for (let minute = 0; minute < 1_440; minute += sampleMinutes) {
    const position = solarPosition(dateAtKst(input.date, minute), minute);
    if (position.elevation < minimumPreciseElevation) {
      masks.push(null);
      continue;
    }
    const mask = new Uint8Array(targets.length);
    for (let cellIndex = 0; cellIndex < targets.length; cellIndex += 1) {
      const result = evaluateDirectSun({
        target: targets[cellIndex],
        azimuth: position.azimuth,
        elevation: position.elevation,
        buildings: index,
      });
      mask[cellIndex] = result.state === "shade" ? 1 : 0;
    }
    masks.push(mask);
  }

  const accumulation = accumulateShadowMasks(masks, targets.length);
  return {
    complete: true,
    sourceVersion: input.buildingMeta.sourceVersion,
    validSamples: accumulation.validSamples,
    warnings: [...input.buildingMeta.warnings],
    geojson: shadowRatiosToGeoJson({
      bounds: input.bounds,
      columns: input.columns,
      rows: input.rows,
      ratios: accumulation.ratios,
    }),
  };
}
