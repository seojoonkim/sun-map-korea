"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import GeoSearch from "./GeoSearch";
import PointSetup, { type FacadeDirection } from "./analysis/PointSetup";
import ReportCard from "./analysis/ReportCard";
import SunTimeline from "./analysis/SunTimeline";
import ConfidenceDetails from "./analysis/ConfidenceDetails";
import type { PlaceResult } from "@/lib/geocode";
import { localityCacheKey, reverseKoreaLocation } from "@/lib/geocode";
import { addComparisonPoint, summarizeComparison, type AnalysisPoint } from "@/lib/analysis/comparison";
import { createAnalysisBounds } from "@/lib/analysis/analysis-bounds";
import type { DailySunReport } from "@/lib/analysis/daily-report";
import { projectAnalysisBuildings } from "@/lib/analysis/local-coordinates";
import { createSavedAnalysesStore, type SavedAnalysis } from "@/lib/analysis/saved-analyses";
import { decodeSharedAnalysis, encodeSharedAnalysis, type SharedAnalysisV1 } from "@/lib/analysis/share-state";
import type { GroundShadowOverlay } from "@/lib/analysis/ground-shadow-overlay";
import type { AnalysisBuilding, BuildingQueryMeta } from "@/lib/buildings/types";
import type { DirectSunWorkerResponse } from "@/workers/direct-sun.worker";
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
const FACADE_AZIMUTH: Record<FacadeDirection, number> = { N: 0, E: 90, S: 180, W: 270 };
const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => <div className="map map-loading" aria-label="대한민국 일조 지도 불러오는 중" />,
});

type CameraRequest = { id: number; mode: "place" | "country"; center?: [number, number] };
type BuildingResponse = { buildings: AnalysisBuilding[]; meta: BuildingQueryMeta };

type CandidateReport = { point: AnalysisPoint; report: DailySunReport };

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function Icon({ name }: { name: "play" | "pause" }) {
  const paths = { play: <path d="m9 7 8 5-8 5Z"/>, pause: <><path d="M9 7v10M15 7v10"/></> };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function SunLogo() {
  return <svg className="sun-face" aria-hidden="true" viewBox="0 0 64 64">
    <path className="sun-rays" d="M32 4v7M32 53v7M4 32h7M53 32h7M12.2 12.2l5 5M46.8 46.8l5 5M51.8 12.2l-5 5M17.2 46.8l-5 5" />
    <circle className="sun-disc" cx="32" cy="32" r="19" />
    <circle className="sun-eye left" cx="25" cy="30" r="2.7" /><circle className="sun-eye right" cx="39" cy="30" r="2.7" />
    <path className="sun-smile" d="M27.5 38c3 2.8 6 2.8 9 0" />
  </svg>;
}

function facadeDirection(azimuth?: number): FacadeDirection {
  if (azimuth === 90) return "E";
  if (azimuth === 180) return "S";
  if (azimuth === 270) return "W";
  return "N";
}

export default function SunMapExperience() {
  const [date, setDate] = useState("2000-01-01");
  const [minutes, setMinutes] = useState(12 * 60 + 30);
  const [playing, setPlaying] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>(SEOUL_CENTER);
  const [selectedPoint, setSelectedPoint] = useState<AnalysisPoint | null>(null);
  const [comparisonPoints, setComparisonPoints] = useState<AnalysisPoint[]>([]);
  const [candidateReports, setCandidateReports] = useState<CandidateReport[]>([]);
  const [report, setReport] = useState<DailySunReport | null>(null);
  const [reportMeta, setReportMeta] = useState<BuildingQueryMeta | null>(null);
  const [shadowOverlay, setShadowOverlay] = useState<GroundShadowOverlay | null>(null);
  const [showShadowOverlay, setShowShadowOverlay] = useState(false);
  const [mode, setMode] = useState<AnalysisPoint["targetMode"]>("ground-point");
  const [heightMeters, setHeightMeters] = useState(0);
  const [floor, setFloor] = useState<number | "">("");
  const [facade, setFacade] = useState<FacadeDirection>("S");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [currentLocation, setCurrentLocation] = useState("서울 · 강남");
  const [cameraRequest, setCameraRequest] = useState<CameraRequest | null>(null);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [savedName, setSavedName] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const localityCache = useRef(new Map<string, string>());
  const localityAbortRef = useRef<AbortController | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const savedStoreRef = useRef<ReturnType<typeof createSavedAnalysesStore> | null>(null);

  useEffect(() => setDate(todayInSeoul()), []);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/direct-sun.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const store = createSavedAnalysesStore(window.localStorage);
    savedStoreRef.current = store;
    setSavedAnalyses(store.list());
    const decoded = decodeSharedAnalysis(window.location.hash);
    if (decoded.status === "ok") {
      setDate(decoded.value.date);
      setComparisonPoints(decoded.value.points);
      setSelectedPoint(decoded.value.points[0] ?? null);
      if (decoded.value.points[0]) {
        setMode(decoded.value.points[0].targetMode);
        setHeightMeters(decoded.value.points[0].targetHeight);
        setFacade(facadeDirection(decoded.value.points[0].facadeAzimuth));
        setCameraRequest({ id: Date.now(), mode: "place", center: decoded.value.points[0].coordinates });
      }
      setShowShadowOverlay(decoded.value.mode === "overlay");
    }
    return () => { worker.terminate(); analysisAbortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    const key = localityCacheKey(mapCenter);
    const cached = localityCache.current.get(key);
    if (cached) { setCurrentLocation(cached); return; }
    localityAbortRef.current?.abort();
    const controller = new AbortController();
    localityAbortRef.current = controller;
    void reverseKoreaLocation(mapCenter, controller.signal)
      .then((locality) => { localityCache.current.set(key, locality); setCurrentLocation(locality); })
      .catch((error) => { if ((error as Error).name !== "AbortError") setCurrentLocation("대한민국"); });
    return () => controller.abort();
  }, [mapCenter]);

  const currentDate = useMemo(() => dateAtKst(date, minutes), [date, minutes]);
  const solar = useMemo(() => getSolarPosition(currentDate, mapCenter[1], mapCenter[0]), [currentDate, mapCenter]);
  const sunTimes = useMemo(() => getSunTimes(dateAtKst(date, 720), mapCenter[1], mapCenter[0]), [date, mapCenter]);
  const daylight = daylightHours(sunTimes.sunrise, sunTimes.sunset);
  const year = Number(date.slice(0, 4));
  const comparison = useMemo(() => summarizeComparison(candidateReports.map(({ point, report: itemReport }) => ({
    id: point.id, label: point.label, report: itemReport,
  }))), [candidateReports]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMinutes((value) => (value + 10) % 1440), 600);
    return () => window.clearInterval(timer);
  }, [playing]);

  const datePresets = [
    { label: "춘분", value: seasonalDate(year, "spring") }, { label: "하지", value: seasonalDate(year, "summer") },
    { label: "추분", value: seasonalDate(year, "autumn") }, { label: "동지", value: seasonalDate(year, "winter") },
  ];

  function selectPlace(place: PlaceResult) {
    localityAbortRef.current?.abort();
    localityCache.current.set(localityCacheKey(place.coordinates), place.label);
    setMapCenter(place.coordinates); setCurrentLocation(place.label);
    setCameraRequest({ id: Date.now(), mode: "place", center: place.coordinates });
  }

  function viewKorea() { setCurrentLocation("대한민국 전역"); setCameraRequest({ id: Date.now(), mode: "country" }); }

  function selectAnalysisPoint(coordinates: [number, number]) {
    const point: AnalysisPoint = {
      id: `point-${coordinates[0].toFixed(6)}-${coordinates[1].toFixed(6)}`,
      label: `후보 ${comparisonPoints.length + 1}`,
      coordinates, targetHeight: heightMeters, targetMode: mode,
      facadeAzimuth: mode === "window-point" ? FACADE_AZIMUTH[facade] : undefined,
    };
    setSelectedPoint(point); setReport(null); setReportMeta(null); setShadowOverlay(null); setAnalysisError("");
  }

  function sharedState(points = comparisonPoints.length ? comparisonPoints : selectedPoint ? [selectedPoint] : []): SharedAnalysisV1 | null {
    if (!points.length) return null;
    return { v: 1, algorithm: "sun-ray-v1", date, sampleMinutes: 10, mode: showShadowOverlay ? "overlay" : points.length > 1 ? "compare" : "report", points };
  }

  async function runAnalysis() {
    if (!selectedPoint || !workerRef.current) { setAnalysisError("지도에서 분석할 지점을 먼저 눌러줘."); return; }
    const nextPoint: AnalysisPoint = {
      ...selectedPoint, targetHeight: heightMeters, targetMode: mode,
      facadeAzimuth: mode === "window-point" ? FACADE_AZIMUTH[facade] : undefined,
    };
    const requestId = ++activeRequestRef.current;
    setSelectedPoint(nextPoint); setAnalysisLoading(true); setAnalysisError("");
    analysisAbortRef.current?.abort();
    const controller = new AbortController(); analysisAbortRef.current = controller;
    const bounds = createAnalysisBounds(nextPoint.coordinates);
    const params = new URLSearchParams({
      bounds: bounds.join(","), purpose: "point-report", minimumSunElevation: "10", target: nextPoint.coordinates.join(","),
    });
    try {
      const response = await fetch(`/api/buildings?bounds=${params.get("bounds")}&purpose=point-report&minimumSunElevation=10&target=${params.get("target")}`, { signal: controller.signal });
      if (!response.ok) throw new Error("건물 데이터를 불러오지 못했어.");
      const data = await response.json() as BuildingResponse;
      const buildings = projectAnalysisBuildings(data.buildings, nextPoint.coordinates);
      const worker = workerRef.current;
      const result = await new Promise<DirectSunWorkerResponse>((resolve, reject) => {
        const cleanup = () => { worker.removeEventListener("message", onMessage); worker.removeEventListener("error", onError); };
        const onMessage = (event: MessageEvent<DirectSunWorkerResponse>) => {
          const response = event.data;
          if (response.requestId !== requestId) return;
          if (response.requestId !== activeRequestRef.current) {
            cleanup(); reject(new DOMException("Superseded analysis", "AbortError")); return;
          }
          cleanup(); resolve(response);
        };
        const onError = () => { cleanup(); reject(new Error("분석 계산에 실패했어.")); };
        worker.addEventListener("message", onMessage); worker.addEventListener("error", onError);
        worker.postMessage({
          requestId,
          input: {
            date, coordinates: nextPoint.coordinates, target: { x: 0, y: 0, z: nextPoint.targetHeight }, buildings,
            buildingMeta: data.meta, sampleMinutes: 10, minimumPreciseElevation: 10, facadeAzimuth: nextPoint.facadeAzimuth,
          },
          overlayInput: {
            date, coordinates: nextPoint.coordinates, bounds, columns: 18, rows: 18, buildings,
            buildingMeta: data.meta, sampleMinutes: 10, minimumPreciseElevation: 10,
          },
        });
      });
      if (requestId !== activeRequestRef.current) return;
      setReport(result.report); setReportMeta(data.meta); setShadowOverlay(result.overlay ?? null);
      setCandidateReports((items) => [...items.filter(({ point }) => point.id !== nextPoint.id), { point: nextPoint, report: result.report }]);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setAnalysisError((error as Error).message || "분석에 실패했어.");
    } finally { if (requestId === activeRequestRef.current) setAnalysisLoading(false); }
  }

  function addCandidate() {
    if (!selectedPoint) return;
    if (comparisonPoints.length >= 4) { setAnalysisError("후보는 최대 4개까지 비교할 수 있어."); return; }
    try { setComparisonPoints((points) => addComparisonPoint(points, selectedPoint)); }
    catch (error) { setAnalysisError((error as Error).message); }
  }

  function removeCandidate(id: string) {
    setComparisonPoints((points) => points.filter((point) => point.id !== id));
    setCandidateReports((items) => items.filter(({ point }) => point.id !== id));
  }

  function saveCurrent() {
    const state = sharedState(); const store = savedStoreRef.current;
    if (!state || !store) { setShareStatus("저장할 분석 지점이 없어."); return; }
    try { store.save(savedName || currentLocation, state); setSavedAnalyses(store.list()); setSavedName(""); setShareStatus("이 브라우저에 저장했어."); }
    catch (error) { setShareStatus((error as Error).message); }
  }

  function restoreSaved(saved: SavedAnalysis) {
    setDate(saved.state.date); setComparisonPoints(saved.state.points); setSelectedPoint(saved.state.points[0] ?? null);
    setShowShadowOverlay(saved.state.mode === "overlay");
    if (saved.state.points[0]) setCameraRequest({ id: Date.now(), mode: "place", center: saved.state.points[0].coordinates });
  }

  async function shareCurrent() {
    const state = sharedState(); if (!state) { setShareStatus("공유할 분석 지점이 없어."); return; }
    const fragment = encodeSharedAnalysis(state); window.location.hash = fragment;
    try { await navigator.clipboard.writeText(window.location.href); setShareStatus("공유 링크를 복사했어."); }
    catch { setShareStatus("주소창의 링크를 복사해줘."); }
  }

  return <main className={`app ${solar.isDaylight ? "is-day" : "is-night"}`}>
    <MapCanvas solar={solar} onCenterChange={setMapCenter} cameraRequest={cameraRequest}
      onSelectPoint={selectAnalysisPoint} selectedPoint={selectedPoint} comparisonPoints={comparisonPoints}
      shadowOverlay={shadowOverlay?.geojson ?? null} showShadowOverlay={showShadowOverlay} />
    <div className="map-center-reticle" aria-hidden="true"><span /><span /></div>
    <p className="sr-only" role="status" aria-live="polite">지도 중심 위치: {currentLocation}</p>

    <header className="topbar glass-panel"><div className="brand-block"><div className="brand-mark"><SunLogo /></div><div><p>SUN MAP</p><strong>KOREA</strong></div></div><GeoSearch onSelect={selectPlace} onViewKorea={viewKorea} /></header>

    <section className="solar-readout glass-panel" aria-label="지도 중심 태양과 일조 정보">
      <div className="readout-heading"><h1>{currentLocation}</h1><span className="center-coordinates">{mapCenter[1].toFixed(3)}<br/>{mapCenter[0].toFixed(3)}</span></div>
      <div className="readout-values"><div><span>방위각</span><strong>{solar.azimuth.toFixed(1)}°</strong></div><div><span>고도각</span><strong className="accent">{solar.elevation.toFixed(1)}°</strong></div><div><span>일조 가능</span><strong>{daylight.toFixed(1)}<small>시간</small></strong></div><div><span>일출 / 일몰</span><strong>{formatKstTime(sunTimes.sunrise)}<small> / {formatKstTime(sunTimes.sunset)}</small></strong></div></div>
      <p className="source"><span className={`status-dot ${solar.isDaylight ? "live" : ""}`} /> {solar.isDaylight ? "일조 시뮬레이션" : "야간"} · <strong>건물 데이터</strong> 서울 S-MAP 2025 정밀 높이 · 전국 OpenFreeMap/OSM 높이 우선 · 미입력은 9m 추정</p>
    </section>

    <aside className="analysis-panel" aria-label="분석 지점과 일조 리포트">
      <PointSetup mode={mode} heightMeters={heightMeters} floor={floor} facade={facade}
        onModeChange={(value) => { setMode(value); if (value === "ground-point") setHeightMeters(0); }}
        onHeightMetersChange={(value) => setHeightMeters(Number.isFinite(value) ? value : 0)}
        onFloorChange={(value, estimate) => { setFloor(value); if (estimate !== undefined) { setMode("window-point"); setHeightMeters(estimate); } }}
        onFacadeChange={setFacade} onSubmit={() => void runAnalysis()} disabled={analysisLoading} />
      <p className="analysis-point-copy">{selectedPoint ? `분석 지점 · ${selectedPoint.coordinates[1].toFixed(5)}, ${selectedPoint.coordinates[0].toFixed(5)}` : "지도에서 분석 지점을 눌러줘."}</p>
      {analysisLoading && <p className="analysis-status" role="status">건물과 하루 햇빛을 계산하는 중…</p>}
      {analysisError && <p className="analysis-error" role="alert">{analysisError}</p>}
      {report && <><ReportCard report={report} /><SunTimeline intervals={report.intervals} />{reportMeta && <ConfidenceDetails sourceVersion={reportMeta.sourceVersion} estimatedHeightRatio={reportMeta.estimatedHeightRatio} />}</>}
      <div className="analysis-actions"><button onClick={addCandidate} disabled={!selectedPoint || comparisonPoints.length >= 4}>후보에 추가</button><button onClick={() => setShowShadowOverlay((value) => !value)} disabled={!shadowOverlay}>누적 그림자 {showShadowOverlay ? "끄기" : "보기"}</button></div>
      <section className="comparison-list" aria-label="후보 비교"><h2>후보 비교 <small>{comparisonPoints.length}/4</small></h2>{comparisonPoints.map((point, index) => {
        const summary = comparison.find(({ id }) => id === point.id);
        return <article key={point.id}><span className={`candidate-dot candidate-${index + 1}`} /> <strong>{point.label}</strong><span>{summary?.comparable ? `${summary.totalSunMinutes}분 · ${summary.rank}위` : "분석 필요"}</span><button onClick={() => removeCandidate(point.id)} aria-label={`${point.label} 삭제`}>삭제</button></article>;
      })}</section>
      <section className="saved-list" aria-label="저장과 공유"><h2>저장 · 공유</h2><div><input value={savedName} onChange={(event) => setSavedName(event.target.value)} maxLength={40} placeholder="이름" aria-label="저장 이름"/><button onClick={saveCurrent}>저장</button><button onClick={() => void shareCurrent()}>링크 복사</button></div>{savedAnalyses.map((saved) => <article key={saved.id}><button onClick={() => restoreSaved(saved)}>{saved.name}</button><button onClick={() => { savedStoreRef.current?.remove(saved.id); setSavedAnalyses(savedStoreRef.current?.list() ?? []); }} aria-label={`${saved.name} 저장 삭제`}>삭제</button></article>)}{shareStatus && <p role="status">{shareStatus}</p>}</section>
    </aside>

    <section className="timeline glass-panel" aria-label="날짜와 시간 설정"><div className="date-controls"><label className="date-input"><span>날짜</span><input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} aria-label="날짜 직접 선택" /></label><button className={date === todayInSeoul() ? "active" : ""} onClick={() => setDate(todayInSeoul())}>오늘</button><div className="season-presets">{datePresets.map((preset) => <button key={preset.label} className={date === preset.value ? "active" : ""} onClick={() => setDate(preset.value)}>{preset.label}</button>)}</div></div><div className="time-controls"><button className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "시간 재생 정지" : "시간 재생"}><Icon name={playing ? "pause" : "play"} /></button><div className="slider-wrap"><div className="time-labels"><strong>{formatMinutes(minutes)} <small>KST</small></strong><span>{solar.isDaylight ? "DAYLIGHT" : "NIGHT"}</span></div><input className="time-slider" type="range" min="0" max="1439" step="1" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} aria-label="시간 선택" style={{ "--progress": `${minutes / 1439 * 100}%` } as React.CSSProperties} /><div className="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div></div></section>
  </main>;
}
