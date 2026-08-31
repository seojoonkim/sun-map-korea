import React from "react";
import type { DailySunReport } from "@/lib/analysis/daily-report";

type ReportCardProps = {
  report: DailySunReport;
  morningSunMinutes?: number;
  afternoonSunMinutes?: number;
};

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes}분`;
  if (remainingMinutes === 0) return `${hours}시간`;
  return `${hours}시간 ${remainingMinutes}분`;
}

function formatClock(minute: number | undefined) {
  if (minute === undefined) return "없음";
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function ReportCard({
  report,
  morningSunMinutes,
  afternoonSunMinutes,
}: ReportCardProps) {
  if (!report.complete || !report.totals) {
    return (
      <article className="report-card glass-panel" aria-label="건물 기준 일조 리포트">
        <p className="report-card-eyebrow">건물 기준 일조</p>
        <h2>완전한 리포트를 만들 수 없습니다</h2>
        <p>필요한 건물 데이터 범위가 완전하지 않아 직사광 추정 합계를 표시하지 않습니다.</p>
        {report.warnings.length > 0 ? (
          <ul aria-label="리포트 경고">
            {report.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
          </ul>
        ) : null}
      </article>
    );
  }

  return (
    <article className="report-card glass-panel" aria-label="건물 기준 일조 리포트">
      <p className="report-card-eyebrow">건물 기준 일조 · 직사광 추정</p>
      <h2>{formatDuration(report.totals.sunMinutes)}</h2>
      <dl>
        <div><dt>첫 직사광</dt><dd>{formatClock(report.firstSunMinute)}</dd></div>
        <div><dt>마지막 직사광</dt><dd>{formatClock(report.lastSunMinute)}</dd></div>
        <div><dt>표본 간격 불확실성</dt><dd>±{report.sampleMinutes}분</dd></div>
        {morningSunMinutes !== undefined ? (
          <div><dt>오전</dt><dd>{formatDuration(morningSunMinutes)}</dd></div>
        ) : null}
        {afternoonSunMinutes !== undefined ? (
          <div><dt>오후</dt><dd>{formatDuration(afternoonSunMinutes)}</dd></div>
        ) : null}
      </dl>
      {report.warnings.length > 0 ? (
        <ul aria-label="리포트 경고">
          {report.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
        </ul>
      ) : null}
    </article>
  );
}
