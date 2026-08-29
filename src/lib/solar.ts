import SunCalc from "suncalc";

export type SolarPosition = {
  azimuth: number;
  elevation: number;
  isDaylight: boolean;
};

export function dateAtKst(date: string, minutes: number): Date {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new Date(`${date}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00+09:00`);
}

export function getSolarPosition(date: Date, latitude: number, longitude: number): SolarPosition {
  const position = SunCalc.getPosition(date, latitude, longitude);
  const azimuth = (position.azimuth * 180 / Math.PI + 180 + 360) % 360;
  const elevation = position.altitude * 180 / Math.PI;
  return { azimuth, elevation, isDaylight: elevation > 0 };
}

export function getSunTimes(date: Date, latitude: number, longitude: number) {
  return SunCalc.getTimes(date, latitude, longitude);
}

export function formatMinutes(total: number): string {
  const safe = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function formatKstTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function daylightHours(rise: Date, set: Date): number {
  return Math.max(0, (set.getTime() - rise.getTime()) / 3_600_000);
}

export function seasonalDate(year: number, kind: "spring" | "summer" | "autumn" | "winter"): string {
  const dates = { spring: "03-20", summer: "06-21", autumn: "09-22", winter: "12-21" };
  return `${year}-${dates[kind]}`;
}
