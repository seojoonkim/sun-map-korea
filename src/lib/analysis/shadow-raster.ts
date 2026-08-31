import type { FeatureCollection, Polygon } from "geojson";
import type { BuildingBounds } from "@/lib/buildings/types";

export function accumulateShadowMasks(
  masks: Array<Uint8Array | null>,
  cellCount: number,
) {
  const shadowedSamples = new Uint16Array(cellCount);
  let validSamples = 0;
  for (const mask of masks) {
    if (!mask) continue;
    if (mask.length !== cellCount) throw new Error("Shadow mask size does not match the grid");
    validSamples += 1;
    for (let index = 0; index < cellCount; index += 1) {
      if (mask[index] > 0) shadowedSamples[index] += 1;
    }
  }
  const ratios = new Float32Array(cellCount);
  if (validSamples > 0) {
    for (let index = 0; index < cellCount; index += 1) {
      ratios[index] = shadowedSamples[index] / validSamples;
    }
  }
  return { validSamples, shadowedSamples, ratios };
}

type GridGeoJsonInput = {
  bounds: BuildingBounds;
  columns: number;
  rows: number;
  ratios: Float32Array;
};

export function shadowRatiosToGeoJson({
  bounds,
  columns,
  rows,
  ratios,
}: GridGeoJsonInput): FeatureCollection<Polygon, {
  shadowRatio: number;
  shadowPercent: number;
  label: string;
}> {
  if (columns <= 0 || rows <= 0 || ratios.length !== columns * rows) {
    throw new Error("Shadow ratio grid dimensions are invalid");
  }
  const [west, south, east, north] = bounds;
  const cellWidth = (east - west) / columns;
  const cellHeight = (north - south) / rows;
  return {
    type: "FeatureCollection",
    features: Array.from({ length: rows * columns }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellWest = west + column * cellWidth;
      const cellEast = cellWest + cellWidth;
      const cellSouth = south + row * cellHeight;
      const cellNorth = cellSouth + cellHeight;
      const shadowRatio = ratios[index];
      const shadowPercent = Math.round(shadowRatio * 100);
      return {
        type: "Feature",
        properties: { shadowRatio, shadowPercent, label: `${shadowPercent}% 그늘` },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [cellWest, cellSouth],
            [cellEast, cellSouth],
            [cellEast, cellNorth],
            [cellWest, cellNorth],
            [cellWest, cellSouth],
          ]],
        },
      };
    }),
  };
}
