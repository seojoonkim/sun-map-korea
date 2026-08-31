import type { BuildingBounds } from "./types";

const WEB_MERCATOR_LIMIT = 85.0511287798066;

export type SlippyTile = {
  z: number;
  x: number;
  y: number;
  key: string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateZoom(zoom: number): void {
  if (!Number.isSafeInteger(zoom) || zoom < 0 || zoom > 30) {
    throw new Error("zoom must be an integer between 0 and 30");
  }
}

function validateBounds(bounds: BuildingBounds): void {
  if (!bounds.every(Number.isFinite)) throw new Error("bounds must contain finite coordinates");
  const [west, south, east, north] = bounds;
  if (west < -180 || east > 180 || west > east) throw new Error("bounds must use ordered longitudes within [-180, 180]");
  if (south < -90 || north > 90 || south > north) throw new Error("bounds must use ordered latitudes within [-90, 90]");
}

function longitudePosition(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

function latitudePosition(latitude: number, zoom: number): number {
  const clamped = clamp(latitude, -WEB_MERCATOR_LIMIT, WEB_MERCATOR_LIMIT);
  const radians = clamped * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom;
}

function inclusiveTileRange(start: number, end: number, maximum: number): [number, number] {
  const first = clamp(Math.floor(start), 0, maximum);
  const last = clamp(end === start ? Math.floor(end) : Math.ceil(end) - 1, 0, maximum);
  return [first, Math.max(first, last)];
}

export function tilesForBounds(bounds: BuildingBounds, zoom: number): SlippyTile[] {
  validateZoom(zoom);
  validateBounds(bounds);
  const maximum = 2 ** zoom - 1;
  const [west, south, east, north] = bounds;
  const [minimumX, maximumX] = inclusiveTileRange(
    longitudePosition(west, zoom),
    longitudePosition(east, zoom),
    maximum,
  );
  const [minimumY, maximumY] = inclusiveTileRange(
    latitudePosition(north, zoom),
    latitudePosition(south, zoom),
    maximum,
  );
  const tiles: SlippyTile[] = [];
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      tiles.push({ z: zoom, x, y, key: `${zoom}/${x}/${y}` });
    }
  }
  return tiles;
}

export function tileBounds(x: number, y: number, zoom: number): BuildingBounds {
  validateZoom(zoom);
  const scale = 2 ** zoom;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= scale || y >= scale) {
    throw new Error("tile x/y must be integers within the zoom grid");
  }
  const longitude = (tileX: number) => tileX / scale * 360 - 180;
  const latitude = (tileY: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / scale))) * 180 / Math.PI;
  return [longitude(x), latitude(y + 1), longitude(x + 1), latitude(y)];
}
