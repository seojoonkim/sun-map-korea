import type { BuildingQueryMeta } from "@/lib/buildings/types";
import { dateAtKst, getSolarPosition } from "@/lib/solar";
import {
  createSunPrismIndex,
  evaluateDirectSun,
  type SunPrism,
  type TargetPoint,
} from "./direct-sun";

export type SunSampleState = "sun" | "shade" | "below-horizon" | "uncertain";

export type SunSample = {
  minute: number;
  azimuth: number;
  elevation: number;
  state: SunSampleState;
  blockerId?: string;
};

export type SunInterval = {
  state: SunSampleState;
  startMinute: number;
  endMinute: number;
  blockerIds: string[];
};

export type DailyReportTotals = {
  sunMinutes: number;
  shadeMinutes: number;
  uncertainMinutes: number;
  belowHorizonMinutes: number;
};

export type DailySunReport = {
  complete: boolean;
  algorithm: "sun-ray-v1";
  sourceVersion: string;
  date: string;
  sampleMinutes: 5 | 10;
  samples: SunSample[];
  intervals: SunInterval[];
  totals?: DailyReportTotals;
  firstSunMinute?: number;
  lastSunMinute?: number;
  errorMinutes: number;
  warnings: string[];
};

export type GenerateDailyReportInput = {
  date: string;
  coordinates: [number, number];
  target: TargetPoint;
  buildings: SunPrism[];
  buildingMeta: BuildingQueryMeta;
  sampleMinutes?: 5 | 10;
  minimumPreciseElevation?: number;
  facadeAzimuth?: number;
  excludeBuildingIds?: readonly string[];
  solarPosition?: (
    date: Date,
    minute: number,
  ) => { azimuth: number; elevation: number };
};

export function mergeSunSamples(samples: SunSample[], sampleMinutes: number): SunInterval[] {
  const intervals: SunInterval[] = [];
  for (const sample of samples) {
    const previous = intervals.at(-1);
    if (previous?.state === sample.state && previous.endMinute === sample.minute) {
      previous.endMinute += sampleMinutes;
      if (sample.blockerId && !previous.blockerIds.includes(sample.blockerId)) {
        previous.blockerIds.push(sample.blockerId);
      }
      continue;
    }
    intervals.push({
      state: sample.state,
      startMinute: sample.minute,
      endMinute: sample.minute + sampleMinutes,
      blockerIds: sample.blockerId ? [sample.blockerId] : [],
    });
  }
  return intervals;
}

export function generateDailyReport(input: GenerateDailyReportInput): DailySunReport {
  const sampleMinutes = input.sampleMinutes ?? 5;
  const base = {
    complete: input.buildingMeta.complete,
    algorithm: "sun-ray-v1" as const,
    sourceVersion: input.buildingMeta.sourceVersion,
    date: input.date,
    sampleMinutes,
    errorMinutes: sampleMinutes,
    warnings: [...input.buildingMeta.warnings],
  };
  if (!input.buildingMeta.complete) {
    return { ...base, samples: [], intervals: [] };
  }

  const minimumPreciseElevation = input.minimumPreciseElevation ?? 10;
  const index = createSunPrismIndex(input.buildings);
  const solarPosition = input.solarPosition
    ?? ((date: Date) => getSolarPosition(date, input.coordinates[1], input.coordinates[0]));
  const samples: SunSample[] = [];

  for (let minute = 0; minute < 1_440; minute += sampleMinutes) {
    const position = solarPosition(dateAtKst(input.date, minute), minute);
    let sample: SunSample;
    if (position.elevation <= 0) {
      sample = { minute, ...position, state: "below-horizon" };
    } else if (position.elevation < minimumPreciseElevation) {
      sample = { minute, ...position, state: "uncertain" };
    } else {
      const result = evaluateDirectSun({
        target: input.target,
        azimuth: position.azimuth,
        elevation: position.elevation,
        buildings: index,
        facadeAzimuth: input.facadeAzimuth,
        excludeBuildingIds: input.excludeBuildingIds,
      });
      if (result.state === "behind-facade") {
        sample = { minute, ...position, state: "shade", blockerId: "facade" };
      } else {
        sample = {
          minute,
          ...position,
          state: result.state === "shade" ? "shade" : "sun",
          blockerId: result.blockerId,
        };
      }
    }
    samples.push(sample);
  }

  const totals: DailyReportTotals = {
    sunMinutes: 0,
    shadeMinutes: 0,
    uncertainMinutes: 0,
    belowHorizonMinutes: 0,
  };
  for (const sample of samples) {
    if (sample.state === "sun") totals.sunMinutes += sampleMinutes;
    if (sample.state === "shade") totals.shadeMinutes += sampleMinutes;
    if (sample.state === "uncertain") totals.uncertainMinutes += sampleMinutes;
    if (sample.state === "below-horizon") totals.belowHorizonMinutes += sampleMinutes;
  }
  const sunSamples = samples.filter(({ state }) => state === "sun");

  return {
    ...base,
    samples,
    intervals: mergeSunSamples(samples, sampleMinutes),
    totals,
    firstSunMinute: sunSamples.at(0)?.minute,
    lastSunMinute: sunSamples.at(-1)?.minute,
  };
}
