export type AnalysisBounds = [number, number, number, number];

const ANALYSIS_RADIUS_LATITUDE_DEGREES = 0.008;

export function createAnalysisBounds([longitude, latitude]: [number, number]): AnalysisBounds {
  const longitudeRadius = ANALYSIS_RADIUS_LATITUDE_DEGREES / Math.max(Math.cos(latitude * Math.PI / 180), 0.6);
  return [
    longitude - longitudeRadius,
    latitude - ANALYSIS_RADIUS_LATITUDE_DEGREES,
    longitude + longitudeRadius,
    latitude + ANALYSIS_RADIUS_LATITUDE_DEGREES,
  ];
}
