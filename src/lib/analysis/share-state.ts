export type SharedAnalysisPoint = {
  id: string;
  label: string;
  coordinates: [number, number];
  targetHeight: number;
  targetMode: "ground-point" | "window-point";
  facadeAzimuth?: number;
};

export type SharedAnalysisV1 = {
  v: 1;
  algorithm: "sun-ray-v1";
  date: string;
  sampleMinutes: 5 | 10;
  mode: "report" | "compare" | "overlay";
  points: SharedAnalysisPoint[];
  range?: [number, number];
};

export type DecodedSharedAnalysis =
  | { status: "ok"; value: SharedAnalysisV1 }
  | { status: "future-version"; version: number }
  | { status: "invalid" };

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToText(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validPoint(value: unknown): value is SharedAnalysisPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  const coordinates = point.coordinates;
  const facadeAzimuth = point.facadeAzimuth;
  return typeof point.id === "string" && point.id.length > 0 && point.id.length <= 64
    && typeof point.label === "string" && point.label.length > 0 && point.label.length <= 32
    && Array.isArray(coordinates) && coordinates.length === 2
    && isFiniteNumber(coordinates[0]) && coordinates[0] >= 124 && coordinates[0] <= 132.2
    && isFiniteNumber(coordinates[1]) && coordinates[1] >= 32.2 && coordinates[1] <= 39.2
    && isFiniteNumber(point.targetHeight) && point.targetHeight >= 0 && point.targetHeight <= 500
    && (point.targetMode === "ground-point" || point.targetMode === "window-point")
    && (facadeAzimuth === undefined || (isFiniteNumber(facadeAzimuth) && facadeAzimuth >= 0 && facadeAzimuth < 360));
}

function validV1(value: unknown): value is SharedAnalysisV1 {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  const points = state.points;
  const range = state.range;
  return state.v === 1
    && state.algorithm === "sun-ray-v1"
    && validDate(state.date)
    && (state.sampleMinutes === 5 || state.sampleMinutes === 10)
    && (state.mode === "report" || state.mode === "compare" || state.mode === "overlay")
    && Array.isArray(points) && points.length >= 1 && points.length <= 4 && points.every(validPoint)
    && (range === undefined || (
      Array.isArray(range) && range.length === 2
      && range.every(isFiniteNumber)
      && range[0] >= 0 && range[0] < range[1] && range[1] <= 1_440
    ));
}

export function encodeSharedAnalysis(value: SharedAnalysisV1): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return `sunmap=${bytesToBase64Url(bytes)}`;
}

export function decodeSharedAnalysis(fragment: string): DecodedSharedAnalysis {
  try {
    const clean = fragment.startsWith("#") ? fragment.slice(1) : fragment;
    let parsed: unknown;
    if (clean.startsWith("sunmap=")) {
      parsed = JSON.parse(base64UrlToText(clean.slice("sunmap=".length)));
    } else if (clean.startsWith("sunmap-json=")) {
      parsed = JSON.parse(decodeURIComponent(clean.slice("sunmap-json=".length)));
    } else {
      return { status: "invalid" };
    }
    if (parsed && typeof parsed === "object") {
      const version = (parsed as Record<string, unknown>).v;
      if (typeof version === "number" && version > 1) return { status: "future-version", version };
    }
    return validV1(parsed) ? { status: "ok", value: parsed } : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}
