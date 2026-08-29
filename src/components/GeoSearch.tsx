"use client";

import { FormEvent, useRef, useState } from "react";
import { PlaceResult, searchKorea } from "@/lib/geocode";

type GeoSearchProps = {
  onSelect: (place: PlaceResult) => void;
  onViewKorea: () => void;
};

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>;
}

export default function GeoSearch({ onSelect, onViewKorea }: GeoSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState("지역명이나 주소를 입력하세요");
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) {
      setStatus("두 글자 이상 입력해 주세요");
      setOpen(true);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setStatus("대한민국 안에서 찾는 중");
    setOpen(true);
    try {
      const nextResults = await searchKorea(normalized, abortRef.current.signal);
      setResults(nextResults);
      setStatus(nextResults.length ? `${nextResults.length}개 지역을 찾았습니다` : "검색 결과가 없습니다");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setStatus("검색을 완료하지 못했습니다. 다시 시도해 주세요");
    }
  }

  function choose(place: PlaceResult) {
    setQuery(place.label);
    setOpen(false);
    setStatus(`${place.label}로 이동했습니다`);
    onSelect(place);
  }

  function viewKorea() {
    setQuery("");
    setResults([]);
    setOpen(false);
    setStatus("대한민국 전체 지도로 이동했습니다");
    onViewKorea();
  }

  return (
    <div className="geo-search-shell">
      <form className="geo-search" role="search" onSubmit={submit}>
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="전국 주소 또는 지역 검색"
          aria-label="전국 주소 또는 지역 검색"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="geo-results"
          autoComplete="off"
        />
        <button className="geo-submit" type="submit">찾기</button>
        <button className="korea-view" type="button" onClick={viewKorea} aria-label="대한민국 전체 보기">전국</button>
      </form>
      <div className="geo-status" aria-live="polite">{status}</div>
      {open && (
        <div className="geo-results glass-panel" id="geo-results" role="listbox" aria-label="지역 검색 결과">
          {results.map((place) => (
            <button key={place.id} type="button" role="option" aria-selected="false" onClick={() => choose(place)}>
              <strong>{place.label}</strong><span>{place.detail}</span>
            </button>
          ))}
          {!results.length && <p>{status}</p>}
        </div>
      )}
    </div>
  );
}
