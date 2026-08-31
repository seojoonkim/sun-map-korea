import React from "react";

type ConfidenceDetailsProps = {
  sourceVersion: string;
  estimatedHeightRatio: number;
};

export default function ConfidenceDetails({
  sourceVersion,
  estimatedHeightRatio,
}: ConfidenceDetailsProps) {
  const estimatedPercent = Math.round(estimatedHeightRatio * 100);

  return (
    <details className="confidence-details">
      <summary>추정 범위와 데이터 신뢰도</summary>
      <dl>
        <div><dt>건물 데이터 버전</dt><dd>{sourceVersion}</dd></div>
        <div><dt>추정 높이 비율</dt><dd>{estimatedPercent}%</dd></div>
      </dl>
      <p>
        건물 기준 일조·직사광 추정에는 지형, 수목, 차양, 창호 구조, 날씨가 제외되어 있습니다.
      </p>
      <p>
        이 결과는 참고용 시뮬레이션이며 법적 일조권 감정이나 판정 자료가 아닙니다.
      </p>
    </details>
  );
}
