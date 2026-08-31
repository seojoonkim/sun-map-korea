import type { DailySunReport } from "./daily-report";

export type AnalysisPoint = {
  id: string;
  label: string;
  coordinates: [number, number];
  targetHeight: number;
  targetMode: "ground-point" | "window-point";
  facadeAzimuth?: number;
};

export type ComparisonInput = {
  id: string;
  label: string;
  report: DailySunReport;
};

export function addComparisonPoint(points: AnalysisPoint[], point: AnalysisPoint): AnalysisPoint[] {
  if (points.length >= 4) throw new Error("A comparison supports a maximum of four points");
  if (points.some(({ id }) => id === point.id)) throw new Error("Comparison point IDs must be unique");
  return [...points, point];
}

export function summarizeComparison(inputs: ComparisonInput[]) {
  const comparableTotals = inputs
    .filter(({ report }) => report.complete && report.totals)
    .map(({ id, report }) => ({ id, total: report.totals!.sunMinutes }))
    .sort((a, b) => b.total - a.total);
  const rankById = new Map(comparableTotals.map((entry, index) => [entry.id, index + 1]));

  return inputs.map(({ id, label, report }) => {
    if (!report.complete || !report.totals) {
      return {
        id,
        label,
        comparable: false,
        rank: null,
        totalSunMinutes: null,
        morningSunMinutes: null,
        afternoonSunMinutes: null,
        uncertainMinutes: null,
        warnings: report.warnings,
      };
    }
    const morningSunMinutes = report.samples
      .filter(({ minute, state }) => minute < 720 && state === "sun")
      .length * report.sampleMinutes;
    const afternoonSunMinutes = report.samples
      .filter(({ minute, state }) => minute >= 720 && state === "sun")
      .length * report.sampleMinutes;
    return {
      id,
      label,
      comparable: true,
      rank: rankById.get(id) ?? null,
      totalSunMinutes: report.totals.sunMinutes,
      morningSunMinutes,
      afternoonSunMinutes,
      uncertainMinutes: report.totals.uncertainMinutes,
      warnings: report.warnings,
    };
  });
}
