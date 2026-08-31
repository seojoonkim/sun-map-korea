import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ConfidenceDetails from "../src/components/analysis/ConfidenceDetails";
import PointSetup, { estimateWindowCenterHeight } from "../src/components/analysis/PointSetup";
import ReportCard from "../src/components/analysis/ReportCard";
import SunTimeline from "../src/components/analysis/SunTimeline";
import type { DailySunReport, SunInterval } from "../src/lib/analysis/daily-report";

const completeReport: DailySunReport = {
  complete: true,
  algorithm: "sun-ray-v1",
  sourceVersion: "smap-2025.08",
  date: "2026-06-21",
  sampleMinutes: 5,
  samples: [],
  intervals: [],
  totals: {
    sunMinutes: 125,
    shadeMinutes: 600,
    uncertainMinutes: 15,
    belowHorizonMinutes: 700,
  },
  firstSunMinute: 365,
  lastSunMinute: 1_075,
  errorMinutes: 5,
  warnings: [],
};

const noop = () => {};

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

test("point setup is controlled, labels both modes, and marks floor height as an estimate", () => {
  assert.equal(estimateWindowCenterHeight(3), 9.6);
  const html = render(createElement(PointSetup, {
    mode: "window-point",
    heightMeters: 9.6,
    floor: 3,
    facade: "S",
    onModeChange: noop,
    onHeightMetersChange: noop,
    onFloorChange: noop,
    onFacadeChange: noop,
    onSubmit: noop,
  }));

  assert.match(html, /지면 지점/);
  assert.match(html, /창문 지점/);
  assert.match(html, /높이 직접 입력/);
  assert.match(html, /층수 빠른 입력/);
  assert.match(html, /3층.*9\.6m.*추정/);
  assert.match(html, /창문 방향/);
  assert.match(html, /value="N"/);
  assert.match(html, /value="E"/);
  assert.match(html, /value="S"/);
  assert.match(html, /value="W"/);
  assert.match(html, /required=""/);
  assert.match(html, /직사광 추정/);
});

test("incomplete reports refuse numeric totals even if stale totals are present", () => {
  const html = render(createElement(ReportCard, {
    report: {
      ...completeReport,
      complete: false,
      warnings: ["건물 범위를 전부 불러오지 못했습니다"],
    },
  }));

  assert.match(html, /건물 기준 일조/);
  assert.match(html, /완전한 리포트를 만들 수 없습니다/);
  assert.match(html, /건물 범위를 전부 불러오지 못했습니다/);
  assert.doesNotMatch(html, /2시간 5분/);
  assert.doesNotMatch(html, /125분/);
});

test("complete report displays total, bounds, sample uncertainty, and optional day parts", () => {
  const html = render(createElement(ReportCard, {
    report: completeReport,
    morningSunMinutes: 80,
    afternoonSunMinutes: 45,
  }));

  assert.match(html, /직사광 추정/);
  assert.match(html, /2시간 5분/);
  assert.match(html, /06:05/);
  assert.match(html, /17:55/);
  assert.match(html, /±5분/);
  assert.match(html, /오전.*1시간 20분/);
  assert.match(html, /오후.*45분/);

  const withoutParts = render(createElement(ReportCard, { report: completeReport }));
  assert.doesNotMatch(withoutParts, /오전/);
  assert.doesNotMatch(withoutParts, /오후/);
});

test("timeline distinguishes every interval state with visible text", () => {
  const intervals: SunInterval[] = [
    { state: "below-horizon", startMinute: 0, endMinute: 360, blockerIds: [] },
    { state: "uncertain", startMinute: 360, endMinute: 420, blockerIds: [] },
    { state: "sun", startMinute: 420, endMinute: 600, blockerIds: [] },
    { state: "shade", startMinute: 600, endMinute: 720, blockerIds: ["building:1"] },
  ];
  const html = render(createElement(SunTimeline, { intervals }));

  assert.match(html, /직사광/);
  assert.match(html, /그늘/);
  assert.match(html, /불확실/);
  assert.match(html, /해가 지평선 아래/);
  assert.match(html, /00:00–06:00/);
  assert.match(html, /10:00–12:00/);
});

test("confidence details disclose exclusions, provenance, height estimates, and legal limits", () => {
  const html = render(createElement(ConfidenceDetails, {
    sourceVersion: "smap-2025.08",
    estimatedHeightRatio: 0.25,
  }));

  assert.match(html, /지형/);
  assert.match(html, /수목/);
  assert.match(html, /차양/);
  assert.match(html, /창호 구조/);
  assert.match(html, /날씨/);
  assert.match(html, /제외/);
  assert.match(html, /smap-2025\.08/);
  assert.match(html, /25%/);
  assert.match(html, /법적 일조권 감정이나 판정 자료가 아닙니다/);
});

test("point-report component copy avoids precision and legal-pass claims", () => {
  const files = ["PointSetup.tsx", "SunTimeline.tsx", "ReportCard.tsx", "ConfidenceDetails.tsx"];
  const source = files
    .map((file) => readFileSync(new URL(`../src/components/analysis/${file}`, import.meta.url), "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /정확한 일조 시간/);
  assert.doesNotMatch(source, /법적 기준 (충족|통과)|일조권 (충족|통과)/);
});
