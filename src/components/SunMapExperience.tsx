"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import GeoSearch from "./GeoSearch";
import type { PlaceResult } from "@/lib/geocode";
import { reverseKoreaLocation } from "@/lib/geocode";
import {
  dateAtKst,
  daylightHours,
  formatKstTime,
  formatMinutes,
  getSolarPosition,
  getSunTimes,
  seasonalDate,
} from "@/lib/solar";

const SEOUL_CENTER: [number, number] = [127.02761, 37.49794];
const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => <div className="map map-loading" aria-label="대한민국 일조 지도 불러오는 중" />,
});

type CameraRequest = {
  id: number;
  mode: "place" | "country";
  center?: [number, number];
};

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function Icon({ name }: { name: "play" | "pause" }) {
  const paths = {
    play: <path d="m9 7 8 5-8 5Z"/>,
    pause: <><path d="M9 7v10M15 7v10"/></>,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function SunLogo() {
  return (
    <svg className="sun-face" aria-hidden="true" viewBox="0 0 64 64">
      <g className="sun-rays"><path d="M32 3v7M32 54v7M3 32h7M54 32h7M11.5 11.5l5 5M47.5 47.5l5 5M52.5 11.5l-5 5M16.5 47.5l-5 5" /></g>
      <circle className="sun-disc" cx="32" cy="32" r="20" />
      <circle className="sun-cheek" cx="20" cy="37" r="3" />
      <circle className="sun-cheek" cx="44" cy="37" r="3" />
      <path className="sun-eye left" d="M21 29c2-3 5-3 7 0" />
      <path className="sun-eye right" d="M36 29c2-3 5-3 7 0" />
      <path className="sun-smile" d="M25 38c4 5 10 5 14 0" />
    </svg>
  );
}

export default function SunMapExperience() {
  const [date, setDate] = useState("2000-01-01");
  const [minutes, setMinutes] = useState(12 * 60 + 30);
  const [playing, setPlaying] = useState(false);
  const [coordinates, setCoordinates] = useState<[number, number]>(SEOUL_CENTER);
  const [currentLocation, setCurrentLocation] = useState("서울 · 강남");
  const [cameraRequest, setCameraRequest] = useState<CameraRequest | null>(null);
  const localityCache = useRef(new Map<string, string>());

  useEffect(() => setDate(todayInSeoul()), []);

  useEffect(() => {
    const key = `${coordinates[0].toFixed(2)}:${coordinates[1].toFixed(2)}`;
    const cached = localityCache.current.get(key);
    if (cached) {
      setCurrentLocation(cached);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const locality = await reverseKoreaLocation(coordinates, controller.signal);
        localityCache.current.set(key, locality);
        setCurrentLocation(locality);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setCurrentLocation("대한민국");
      }
    }, 850);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [coordinates]);

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

  function selectPlace(place: PlaceResult) {
    setCurrentLocation(place.label);
    setCameraRequest({ id: Date.now(), mode: "place", center: place.coordinates });
  }

  function viewKorea() {
    setCurrentLocation("대한민국 전역");
    setCameraRequest({ id: Date.now(), mode: "country" });
  }

  return (
    <main className={`app ${solar.isDaylight ? "is-day" : "is-night"}`}>
      <MapCanvas solar={solar} onCenterChange={setCoordinates} cameraRequest={cameraRequest} />
      <div className="map-vignette" />
      <div className="map-grid" />
      <div className="map-center-reticle" aria-hidden="true"><span /><span /></div>

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><SunLogo /></div>
          <div><p>SUN MAP</p><strong>KOREA</strong></div>
        </div>
        <GeoSearch onSelect={selectPlace} onViewKorea={viewKorea} />
        <div className="district-badge" aria-live="polite"><span /> {currentLocation}</div>
        <div className="prototype-badge">NATIONWIDE · LIVE 3D</div>
      </header>

      <section className="solar-readout glass-panel" aria-label="지도 중심 태양과 일조 정보">
        <div className="readout-heading">
          <h1>{currentLocation}</h1>
          <span className="center-coordinates">{coordinates[1].toFixed(3)}<br/>{coordinates[0].toFixed(3)}</span>
        </div>
        <div className="readout-values">
          <div><span>방위각</span><strong>{solar.azimuth.toFixed(1)}°</strong></div>
          <div><span>고도각</span><strong className="accent">{solar.elevation.toFixed(1)}°</strong></div>
          <div><span>일조 가능</span><strong>{daylight.toFixed(1)}<small>시간</small></strong></div>
          <div><span>일출 / 일몰</span><strong>{formatKstTime(sunTimes.sunrise)}<small> / {formatKstTime(sunTimes.sunset)}</small></strong></div>
        </div>
        <p className="source"><span className={`status-dot ${solar.isDaylight ? "live" : ""}`} /> {solar.isDaylight ? "일조 시뮬레이션" : "야간"} · <strong>높이 데이터</strong> OSM 입력·층수 우선 · 높이 미입력 건물은 9m로 추정 · 정밀 측량값 아님</p>
      </section>

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
