"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import GeoSearch from "./GeoSearch";
import type { PlaceResult } from "@/lib/geocode";
import { localityCacheKey, reverseKoreaLocation } from "@/lib/geocode";
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
      <path className="sun-rays" d="M32 4v7M32 53v7M4 32h7M53 32h7M12.2 12.2l5 5M46.8 46.8l5 5M51.8 12.2l-5 5M17.2 46.8l-5 5" />
      <circle className="sun-disc" cx="32" cy="32" r="19" />
      <circle className="sun-eye left" cx="25" cy="30" r="2.7" />
      <circle className="sun-eye right" cx="39" cy="30" r="2.7" />
      <path className="sun-smile" d="M27.5 38c3 2.8 6 2.8 9 0" />
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
  const localityAbortRef = useRef<AbortController | null>(null);

  useEffect(() => setDate(todayInSeoul()), []);

  useEffect(() => {
    const key = localityCacheKey(coordinates);
    const cached = localityCache.current.get(key);
    if (cached) {
      setCurrentLocation(cached);
      return;
    }
    localityAbortRef.current?.abort();
    const controller = new AbortController();
    localityAbortRef.current = controller;
    void (async () => {
      try {
        const locality = await reverseKoreaLocation(coordinates, controller.signal);
        localityCache.current.set(key, locality);
        setCurrentLocation(locality);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setCurrentLocation("대한민국");
      }
    })();
    return () => {
      controller.abort();
      if (localityAbortRef.current === controller) localityAbortRef.current = null;
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
    localityAbortRef.current?.abort();
    localityCache.current.set(localityCacheKey(place.coordinates), place.label);
    setCoordinates(place.coordinates);
    setCurrentLocation(place.label);
    setCameraRequest({ id: Date.now(), mode: "place", center: place.coordinates });
  }

  function viewKorea() {
    setCurrentLocation("대한민국 전역");
    setCameraRequest({ id: Date.now(), mode: "country" });
  }

  return (
    <main className={`app ${solar.isDaylight ? "is-day" : "is-night"}`}>
      <MapCanvas solar={solar} solarTimestamp={currentDate.getTime()} onCenterChange={setCoordinates} cameraRequest={cameraRequest} />
      <div className="map-center-reticle" aria-hidden="true"><span /><span /></div>
      <p className="map-rotate-hint"><kbd>Control</kbd> + 마우스 왼쪽 버튼으로 화면 회전</p>
      <p className="sr-only" role="status" aria-live="polite">지도 중심 위치: {currentLocation}</p>

      <header className="topbar glass-panel">
        <div className="brand-block">
          <div className="brand-mark"><SunLogo /></div>
          <div><p>SUN MAP</p><strong>KOREA</strong></div>
        </div>
        <GeoSearch onSelect={selectPlace} onViewKorea={viewKorea} />
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
        <p className="source"><span className={`status-dot ${solar.isDaylight ? "live" : ""}`} /> {solar.isDaylight ? "일조 시뮬레이션" : "야간"} · <strong>건물 데이터</strong> 서울 S-MAP 2025 정밀 높이 · 전국 OpenFreeMap/OSM 높이 우선 · 미입력은 9m 추정</p>
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
