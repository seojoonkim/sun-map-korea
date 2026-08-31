import Flatbush from "flatbush";
import type { MultiPolygon, Polygon, Position } from "geojson";

const EPSILON = 1e-7;

export type SunPrism = {
  id: string;
  geometry: Polygon | MultiPolygon;
  minZ: number;
  maxZ: number;
};

export type DirectSunState = "sun" | "shade" | "below-horizon" | "behind-facade";

export type DirectSunResult = {
  state: DirectSunState;
  blockerId?: string;
  distance?: number;
  blockerHeight?: number;
};

export type TargetPoint = { x: number; y: number; z: number };

type Bounds = [number, number, number, number];

type DirectSunInput = {
  target: TargetPoint;
  azimuth: number;
  elevation: number;
  buildings: SunPrism[] | SunPrismIndex;
  excludeBuildingIds?: readonly string[];
  facadeAzimuth?: number;
};

function polygons(geometry: Polygon | MultiPolygon): Position[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function geometryBounds(geometry: Polygon | MultiPolygon): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons(geometry)) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

export class SunPrismIndex {
  readonly buildings: SunPrism[];
  readonly maxZ: number;
  private readonly index: Flatbush | null;

  constructor(buildings: SunPrism[]) {
    this.buildings = buildings;
    this.maxZ = buildings.reduce((maximum, building) => Math.max(maximum, building.maxZ), -Infinity);
    if (buildings.length === 0) {
      this.index = null;
      return;
    }
    this.index = new Flatbush(buildings.length);
    for (const building of buildings) this.index.add(...geometryBounds(building.geometry));
    this.index.finish();
  }

  search(bounds: Bounds): SunPrism[] {
    if (!this.index) return [];
    return this.index.search(...bounds).map((index) => this.buildings[index]);
  }
}

export function createSunPrismIndex(buildings: SunPrism[]) {
  return new SunPrismIndex(buildings);
}

function normalizedAngleDelta(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function pointInRing(x: number, y: number, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(x: number, y: number, polygon: Position[][]) {
  if (!pointInRing(x, y, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(x, y, hole));
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx;
}

function rayPolygonIntervals(
  target: TargetPoint,
  direction: [number, number],
  polygon: Position[][],
): Array<[number, number]> {
  const intersections = [0];
  for (const ring of polygon) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [ax, ay] = ring[index];
      const [bx, by] = ring[index + 1];
      const edgeX = bx - ax;
      const edgeY = by - ay;
      const denominator = cross(direction[0], direction[1], edgeX, edgeY);
      if (Math.abs(denominator) < EPSILON) continue;
      const offsetX = ax - target.x;
      const offsetY = ay - target.y;
      const distance = cross(offsetX, offsetY, edgeX, edgeY) / denominator;
      const edgePosition = cross(offsetX, offsetY, direction[0], direction[1]) / denominator;
      if (distance >= -EPSILON && edgePosition >= -EPSILON && edgePosition <= 1 + EPSILON) {
        intersections.push(Math.max(0, distance));
      }
    }
  }

  const sorted = intersections
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > EPSILON);
  const intervals: Array<[number, number]> = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    const middle = (start + end) / 2;
    if (pointInPolygon(
      target.x + direction[0] * middle,
      target.y + direction[1] * middle,
      polygon,
    )) intervals.push([start, end]);
  }
  return intervals;
}

function firstBlockingDistance(
  target: TargetPoint,
  direction: [number, number],
  elevationRadians: number,
  building: SunPrism,
): number | null {
  const slope = Math.tan(elevationRadians);
  let nearest = Infinity;
  for (const polygon of polygons(building.geometry)) {
    for (const [entry, exit] of rayPolygonIntervals(target, direction, polygon)) {
      const verticalEntry = Math.max(entry, (building.minZ - target.z) / slope, 0);
      const verticalExit = Math.min(exit, (building.maxZ - target.z) / slope);
      if (verticalEntry <= verticalExit + EPSILON) nearest = Math.min(nearest, verticalEntry);
    }
  }
  return Number.isFinite(nearest) ? nearest : null;
}

function candidatesForRay(
  buildings: SunPrism[] | SunPrismIndex,
  target: TargetPoint,
  direction: [number, number],
  elevationRadians: number,
) {
  if (Array.isArray(buildings)) return buildings;
  const maxDistance = Math.max(0, (buildings.maxZ - target.z) / Math.tan(elevationRadians));
  const endX = target.x + direction[0] * maxDistance;
  const endY = target.y + direction[1] * maxDistance;
  return buildings.search([
    Math.min(target.x, endX),
    Math.min(target.y, endY),
    Math.max(target.x, endX),
    Math.max(target.y, endY),
  ]);
}

export function evaluateDirectSun(input: DirectSunInput): DirectSunResult {
  if (input.elevation <= 0) return { state: "below-horizon" };
  if (
    input.facadeAzimuth !== undefined
    && normalizedAngleDelta(input.azimuth, input.facadeAzimuth) > 90
  ) return { state: "behind-facade" };

  const azimuthRadians = input.azimuth * Math.PI / 180;
  const elevationRadians = input.elevation * Math.PI / 180;
  const direction: [number, number] = [Math.sin(azimuthRadians), Math.cos(azimuthRadians)];
  const excluded = new Set(input.excludeBuildingIds ?? []);
  let nearest: { building: SunPrism; distance: number } | null = null;

  for (const building of candidatesForRay(input.buildings, input.target, direction, elevationRadians)) {
    if (excluded.has(building.id) || building.maxZ <= building.minZ) continue;
    const distance = firstBlockingDistance(input.target, direction, elevationRadians, building);
    if (distance !== null && (!nearest || distance < nearest.distance)) nearest = { building, distance };
  }

  if (!nearest) return { state: "sun" };
  return {
    state: "shade",
    blockerId: nearest.building.id,
    distance: nearest.distance,
    blockerHeight: nearest.building.maxZ,
  };
}
