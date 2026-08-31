import React from "react";
import type { SunInterval, SunSampleState } from "@/lib/analysis/daily-report";

type SunTimelineProps = {
  intervals: readonly SunInterval[];
  ariaLabel?: string;
};

const STATE_LABELS: Record<SunSampleState, string> = {
  sun: "직사광",
  shade: "그늘",
  uncertain: "불확실",
  "below-horizon": "해가 지평선 아래",
};

function formatClock(minute: number) {
  const boundedMinute = Math.max(0, Math.min(1_440, minute));
  const hours = Math.floor(boundedMinute / 60);
  const minutes = boundedMinute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function SunTimeline({
  intervals,
  ariaLabel = "건물 기준 일조 시간대",
}: SunTimelineProps) {
  return (
    <section className="sun-timeline" aria-label={ariaLabel}>
      <ol className="sun-timeline-track">
        {intervals.map((interval, index) => (
          <li
            className={`sun-timeline-segment is-${interval.state}`}
            key={`${interval.startMinute}-${interval.endMinute}-${interval.state}-${index}`}
            style={{ flexGrow: interval.endMinute - interval.startMinute }}
          >
            <span className="sun-timeline-state">{STATE_LABELS[interval.state]}</span>{" "}
            <time>{formatClock(interval.startMinute)}–{formatClock(interval.endMinute)}</time>
          </li>
        ))}
      </ol>
      <ul className="sun-timeline-legend" aria-label="시간대 상태 범례">
        {(Object.entries(STATE_LABELS) as Array<[SunSampleState, string]>).map(([state, label]) => (
          <li key={state} className={`is-${state}`}><span aria-hidden="true" />{label}</li>
        ))}
      </ul>
    </section>
  );
}
