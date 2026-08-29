"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  dateAtKst,
  daylightHours,
  formatKstTime,
  formatMinutes,
  getSolarPosition,
  getSunTimes,
  seasonalDate,
} from "@/lib/solar";

const GANGNAM_CENTER: [number, number] = [127.02761, 37.49794];
const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => <div className="map map-loading" aria-label="강남구 일조 지도 불러오는 중" />,
});

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function Icon({ name }: { name: "play" | "pause" | "sun" }) {
  const paths = {
    play: <path d="m9 7 8 5-8 5Z"/>,
    pause: <><path d="M9 7v10M15 7v10"/></>,
    sun: <><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

export default function SunMapExperience() {
  const [date, setDate] = useState(todayInSeoul);
  const [minutes, setMinutes] = useState(12 * 60 + 30);
  const [playing, setPlaying] = useState(false);
  const [coordinates, setCoordinates] = useState<[number, number]>(GANGNAM_CENTER);

  const currentDate = useMemo(() => dateAtKst(date, minutes), [date, minutes]);
  const solar = useMemo(
    () => getSolarPosition(currentDate, coordinates[1], coordinates[0]),
    [currentDate, coordinates],
  );
  const sunTimes = useMemo(
    () => getSunTimes(dateAtKst(date, 720), coordinates[1], coordinates[0]),
    [date, coordinates],
  );
  const daylight = daylightHours(sunTimes.sunrise, sunTimes.sunset);
  const year = Number(date.slice(0, 4));

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMinutes((value) => (value + 10) % 1440), 600);
    return () => window.clearInterval(timer);
  }, [playing]);

  const datePresets = [
    { label: "춘분", value: seasonalDate(year, "spring") },
    { label: "하지", value: seasonalDate(year, "summer") },
    { label: "추분", value: seasonalDate(year, "autumn") },
    { label: "동지", value: seasonalDate(year, "winter") },
  ];

  return (
    <main className={`app ${solar.isDaylight ? "is-day" : "is-night"}`}>
      <MapCanvas solar={solar} onCenterChange={setCoordinates} />
      <div className="map-vignette" />
      <div className="map-grid" />

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><Icon name="sun" /></div>
          <div><p>SUN MAP</p><strong>KOREA</strong></div>
        </div>
        <div className="district-badge"><span /> 서울특별시 · 강남구</div>
        <div className="prototype-badge">LIVE OSM · 3D</div>
      </header>

      <section className="solar-readout glass-panel" aria-label="태양 위치 정보">
        <div className="readout-values">
          <div><span>방위각</span><strong>{solar.azimuth.toFixed(1)}°</strong></div>
          <div><span>고도각</span><strong className="accent">{solar.elevation.toFixed(1)}°</strong></div>
        </div>
        <p><span className={`status-dot ${solar.isDaylight ? "live" : ""}`} /> {solar.isDaylight ? "일조 시뮬레이션" : "야간"}</p>
      </section>

      <aside className="summary-panel glass-panel">
        <div className="summary-title">
          <div><span className="eyebrow">MAP CENTER SOLAR REPORT</span><h1>지도 중심</h1></div>
          <span className="center-coordinates">{coordinates[1].toFixed(3)}<br/>{coordinates[0].toFixed(3)}</span>
        </div>
        <div className="summary-metrics">
          <div><span>일조 가능</span><strong>{daylight.toFixed(1)}<small>시간</small></strong></div>
          <div><span>일출 / 일몰</span><strong>{formatKstTime(sunTimes.sunrise)}<small> / {formatKstTime(sunTimes.sunset)}</small></strong></div>
        </div>
        <p className="source">화면 중앙 좌표 기준 · 실제 OSM 건물 footprint/높이</p>
      </aside>

      <section className="timeline glass-panel" aria-label="날짜와 시간 설정">
        <div className="date-controls">
          <label className="date-input">
            <span>날짜</span>
            <input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} aria-label="날짜 직접 선택" />
          </label>
          <button className={date === todayInSeoul() ? "active" : ""} onClick={() => setDate(todayInSeoul())}>오늘</button>
          <div className="season-presets">
            {datePresets.map((preset) => <button key={preset.label} className={date === preset.value ? "active" : ""} onClick={() => setDate(preset.value)}>{preset.label}</button>)}
          </div>
        </div>
        <div className="time-controls">
          <button className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "시간 재생 정지" : "시간 재생"}><Icon name={playing ? "pause" : "play"} /></button>
          <div className="slider-wrap">
            <div className="time-labels"><strong>{formatMinutes(minutes)} <small>KST</small></strong><span>{solar.isDaylight ? "DAYLIGHT" : "NIGHT"}</span></div>
            <input className="time-slider" type="range" min="0" max="1439" step="1" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} aria-label="시간 선택" style={{ "--progress": `${minutes / 1439 * 100}%` } as React.CSSProperties} />
            <div className="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}
