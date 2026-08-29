"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { LANDMARKS } from "@/data/landmarks";
import { createBuildingShadows, createPrototypeBuildings } from "@/lib/shadows";
import {
  dateAtKst,
  daylightHours,
  formatKstTime,
  formatMinutes,
  getSolarPosition,
  getSunTimes,
  seasonalDate,
} from "@/lib/solar";

const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{
    id: "osm-base",
    type: "raster",
    source: "carto",
    paint: {
      "raster-brightness-max": 0.62,
      "raster-contrast": 0.18,
      "raster-saturation": -0.55,
    },
  }],
};

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function Icon({ name }: { name: "search" | "play" | "pause" | "sun" | "locate" | "info" | "layers" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    play: <path d="m9 7 8 5-8 5Z"/>,
    pause: <><path d="M9 7v10M15 7v10"/></>,
    sun: <><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
    locate: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    layers: <><path d="m12 3 8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

export default function SunMapExperience() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [selectedId, setSelectedId] = useState("gangnam");
  const [date, setDate] = useState(todayInSeoul);
  const [minutes, setMinutes] = useState(12 * 60 + 30);
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const selected = LANDMARKS.find((item) => item.id === selectedId) ?? LANDMARKS[0];

  const currentDate = useMemo(() => dateAtKst(date, minutes), [date, minutes]);
  const solar = useMemo(
    () => getSolarPosition(currentDate, selected.coordinates[1], selected.coordinates[0]),
    [currentDate, selected],
  );
  const sunTimes = useMemo(
    () => getSunTimes(dateAtKst(date, 720), selected.coordinates[1], selected.coordinates[0]),
    [date, selected],
  );
  const daylight = daylightHours(sunTimes.sunrise, sunTimes.sunset);
  const estimatedSunlight = daylight * selected.sunlightScore / 100;
  const year = Number(date.slice(0, 4));
  const filtered = LANDMARKS.filter((place) => place.name.toLowerCase().includes(query.trim().toLowerCase()));

  const updateMapLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const buildings = createPrototypeBuildings(selected.coordinates);
    const shadows = createBuildingShadows(buildings, solar.azimuth, solar.elevation);
    const shadowSource = map.getSource("solar-shadow") as GeoJSONSource | undefined;
    shadowSource?.setData(shadows);
    const buildingSource = map.getSource("prototype-buildings") as GeoJSONSource | undefined;
    buildingSource?.setData(buildings);
    const pointSource = map.getSource("selected-point") as GeoJSONSource | undefined;
    pointSource?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: selected.coordinates } }],
    });
  }, [selected, solar]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: RASTER_STYLE,
      center: LANDMARKS[0].coordinates,
      zoom: 15.35,
      pitch: 53,
      bearing: -18,
      minZoom: 12.2,
      maxZoom: 18,
      maxBounds: [[126.965, 37.455], [127.115, 37.565]],
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("style.load", () => {
      if (!map.getSource("solar-shadow")) {
        map.addSource("solar-shadow", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "solar-shadow-fill",
          type: "fill",
          source: "solar-shadow",
          paint: { "fill-color": "#07162d", "fill-opacity": ["coalesce", ["get", "strength"], 0.78] },
        });
        map.addLayer({
          id: "solar-shadow-edge",
          type: "line",
          source: "solar-shadow",
          paint: { "line-color": "#55deee", "line-opacity": 0.72, "line-width": 1.25 },
        });
      }
      if (!map.getSource("prototype-buildings")) {
        map.addSource("prototype-buildings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "prototype-building-3d",
          type: "fill-extrusion",
          source: "prototype-buildings",
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["get", "height"], 15, "#58615e", 95, "#99a39e"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.94,
          },
        });
      }
      if (!map.getSource("selected-point")) {
        map.addSource("selected-point", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "selected-glow",
          type: "circle",
          source: "selected-point",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 12, 18, 35],
            "circle-color": "#f6c945",
            "circle-opacity": 0.14,
            "circle-stroke-color": "#f6c945",
            "circle-stroke-opacity": 0.5,
            "circle-stroke-width": 1,
          },
        });
      }
      setMapReady(true);
    });

    LANDMARKS.forEach((place) => {
      const element = document.createElement("button");
      element.className = "map-marker";
      element.type = "button";
      element.setAttribute("aria-label", `${place.name} 선택`);
      element.innerHTML = `<span></span>`;
      element.addEventListener("click", () => setSelectedId(place.id));
      markersRef.current.push(new maplibregl.Marker({ element, anchor: "center" }).setLngLat(place.coordinates).addTo(map));
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(updateMapLayers, [updateMapLayers, mapReady]);

  useEffect(() => {
    const markerElements = document.querySelectorAll<HTMLButtonElement>(".map-marker");
    markerElements.forEach((element, index) => element.classList.toggle("is-selected", LANDMARKS[index]?.id === selectedId));
  }, [selectedId]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMinutes((value) => (value + 10) % 1440), 600);
    return () => window.clearInterval(timer);
  }, [playing]);

  function selectPlace(id: string) {
    const place = LANDMARKS.find((item) => item.id === id);
    if (!place) return;
    setSelectedId(id);
    mapRef.current?.flyTo({ center: place.coordinates, zoom: 15.35, pitch: 56, duration: 1100, essential: true });
  }

  const datePresets = [
    { label: "오늘", value: todayInSeoul() },
    { label: "춘분", value: seasonalDate(year, "spring") },
    { label: "하지", value: seasonalDate(year, "summer") },
    { label: "추분", value: seasonalDate(year, "autumn") },
    { label: "동지", value: seasonalDate(year, "winter") },
  ];

  return (
    <main className={`app ${solar.isDaylight ? "is-day" : "is-night"}`}>
      <div ref={mapContainer} className="map" aria-label="강남구 인터랙티브 일조 지도" />
      <div className="map-vignette" />
      <div className="map-grid" />

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><Icon name="sun" /></div>
          <div><p>SUN MAP</p><strong>KOREA</strong></div>
        </div>
        <div className="district-badge"><span /> 서울특별시 · 강남구</div>
        <div className="prototype-badge">PROTOTYPE · 추정치</div>
      </header>

      <aside className="place-panel glass-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">LOCATION INDEX</span><h1>햇빛을 탐색할 장소</h1></div>
          <span className="count">04</span>
        </div>
        <label className="search-box">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="장소 또는 랜드마크 검색" aria-label="장소 검색" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="place-list">
          {filtered.map((place) => (
            <button key={place.id} className={`place-item ${selectedId === place.id ? "active" : ""}`} onClick={() => selectPlace(place.id)}>
              <span className="place-index">0{LANDMARKS.indexOf(place) + 1}</span>
              <span className="place-copy"><strong>{place.name}</strong><small>{place.subtitle}</small></span>
              <span className="place-score">{place.sunlightScore}<small>/100</small></span>
            </button>
          ))}
          {!filtered.length && <p className="empty">일치하는 강남구 프리셋이 없습니다.</p>}
        </div>
        <div className="panel-foot"><Icon name="layers" /> <span>건물·지면 그림자</span><b>활성</b></div>
      </aside>

      <section className="solar-readout glass-panel" aria-label="태양 위치 정보">
        <div className="sun-orbit">
          <div className="orbit-line" />
          <span className="sun-dot" style={{ left: `${Math.min(90, Math.max(10, 50 + (solar.azimuth - 180) / 4))}%`, top: `${Math.min(76, Math.max(8, 68 - solar.elevation * 0.72))}%` }} />
          <span className="north">N</span>
        </div>
        <div className="readout-values">
          <div><span>방위각 AZI</span><strong>{solar.azimuth.toFixed(1)}°</strong></div>
          <div><span>고도각 ALT</span><strong className="accent">{solar.elevation.toFixed(1)}°</strong></div>
        </div>
        <p><span className={`status-dot ${solar.isDaylight ? "live" : ""}`} /> {solar.isDaylight ? "일조 시뮬레이션 활성" : "태양이 지평선 아래에 있습니다"}</p>
      </section>

      <aside className="summary-panel glass-panel">
        <div className="summary-title"><div><span className="eyebrow">DAILY SOLAR REPORT</span><h2>{selected.name}</h2></div><button onClick={() => mapRef.current?.flyTo({ center: selected.coordinates, zoom: 16, duration: 800 })} aria-label="선택 장소로 이동"><Icon name="locate" /></button></div>
        <div className="score-ring" style={{ "--score": `${selected.sunlightScore * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{selected.sunlightScore}</strong><span>일조 지수</span></div>
        </div>
        <div className="summary-metrics">
          <div><span>예상 일조</span><strong>{estimatedSunlight.toFixed(1)}<small>시간</small></strong></div>
          <div><span>낮 길이</span><strong>{daylight.toFixed(1)}<small>시간</small></strong></div>
        </div>
        <div className="sun-times"><span>일출 <b>{formatKstTime(sunTimes.sunrise)}</b></span><i /><span>일몰 <b>{formatKstTime(sunTimes.sunset)}</b></span></div>
        <div className="disclosure"><Icon name="info" /><p><strong>프로토타입 추정치</strong> 태양 위치는 천문 계산, 회색 건물과 남색 지면 그림자는 제품 검증용 가상 매스입니다.</p></div>
        <p className="source">지도: © OpenStreetMap 기여자 · 태양 계산: SunCalc</p>
      </aside>

      <section className="timeline glass-panel">
        <div className="date-controls">
          {datePresets.map((preset) => <button key={preset.label} className={date === preset.value ? "active" : ""} onClick={() => setDate(preset.value)}>{preset.label}</button>)}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="날짜 직접 선택" />
        </div>
        <div className="time-controls">
          <button className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "시간 재생 정지" : "시간 재생"}><Icon name={playing ? "pause" : "play"} /></button>
          <div className="slider-wrap">
            <div className="time-labels"><span>{date.replaceAll("-", ".")}</span><strong>{formatMinutes(minutes)} <small>KST</small></strong><span>{solar.isDaylight ? "DAYLIGHT" : "NIGHT"}</span></div>
            <input className="time-slider" type="range" min="0" max="1439" step="1" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} aria-label="시간 선택" style={{ "--progress": `${minutes / 1439 * 100}%` } as React.CSSProperties} />
            <div className="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}
