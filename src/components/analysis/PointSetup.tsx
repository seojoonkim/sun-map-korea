"use client";

import React, { type FormEvent } from "react";
import type { AnalysisPoint } from "@/lib/analysis/comparison";

export type FacadeDirection = "N" | "E" | "S" | "W";

type PointSetupProps = {
  mode: AnalysisPoint["targetMode"];
  heightMeters: number;
  floor: number | "";
  facade?: FacadeDirection;
  onModeChange: (mode: AnalysisPoint["targetMode"]) => void;
  onHeightMetersChange: (heightMeters: number) => void;
  onFloorChange: (floor: number | "", estimatedHeightMeters?: number) => void;
  onFacadeChange: (facade: FacadeDirection) => void;
  onSubmit: () => void;
  disabled?: boolean;
};

const FACADES: ReadonlyArray<{ value: FacadeDirection; label: string }> = [
  { value: "N", label: "북향" },
  { value: "E", label: "동향" },
  { value: "S", label: "남향" },
  { value: "W", label: "서향" },
];

export function estimateWindowCenterHeight(floor: number) {
  return Math.round((floor * 2.8 + 1.2) * 10) / 10;
}

export default function PointSetup({
  mode,
  heightMeters,
  floor,
  facade,
  onModeChange,
  onHeightMetersChange,
  onFloorChange,
  onFacadeChange,
  onSubmit,
  disabled = false,
}: PointSetupProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="point-setup glass-panel" aria-label="직사광 추정 지점 설정" onSubmit={submit}>
      <fieldset disabled={disabled}>
        <legend>분석 지점</legend>
        <label>
          <input
            type="radio"
            name="point-mode"
            value="ground-point"
            checked={mode === "ground-point"}
            onChange={() => onModeChange("ground-point")}
          />
          지면 지점
        </label>
        <label>
          <input
            type="radio"
            name="point-mode"
            value="window-point"
            checked={mode === "window-point"}
            onChange={() => onModeChange("window-point")}
          />
          창문 지점
        </label>
      </fieldset>

      <label>
        <span>높이 직접 입력 (m)</span>
        <input
          type="number"
          min="0"
          step="0.1"
          inputMode="decimal"
          value={heightMeters}
          onChange={(event) => onHeightMetersChange(event.currentTarget.valueAsNumber)}
          aria-label="분석 지점 높이 직접 입력, 미터"
          disabled={disabled}
          required
        />
      </label>

      <label>
        <span>층수 빠른 입력</span>
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={floor}
          onChange={(event) => {
            const nextFloor = event.currentTarget.value === "" ? "" : event.currentTarget.valueAsNumber;
            onFloorChange(
              nextFloor,
              nextFloor === "" ? undefined : estimateWindowCenterHeight(nextFloor),
            );
          }}
          aria-describedby="floor-height-estimate"
          aria-label="층수 빠른 입력"
          disabled={disabled}
        />
      </label>
      <p id="floor-height-estimate">
        {floor === ""
          ? "층고 2.8m와 창 중심 1.2m를 적용한 추정값입니다."
          : `${floor}층 · ${estimateWindowCenterHeight(floor).toFixed(1)}m 추정 (층고 2.8m + 창 중심 1.2m)`}
      </p>

      {mode === "window-point" ? (
        <fieldset disabled={disabled}>
          <legend>창문 방향</legend>
          {FACADES.map(({ value, label }) => (
            <label key={value}>
              <input
                type="radio"
                name="facade"
                value={value}
                checked={facade === value}
                onChange={() => onFacadeChange(value)}
                required
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}

      <button type="submit" disabled={disabled || (mode === "window-point" && !facade)}>
        직사광 추정 리포트 만들기
      </button>
    </form>
  );
}
