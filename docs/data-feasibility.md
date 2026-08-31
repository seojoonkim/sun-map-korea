# Sun Map Korea 데이터 Feasibility Gate

측정 시각: 2026-08-31 12:22 KST  
대상: 서울 S-MAP `seoul:footprint_w_minmax`, OpenFreeMap planet z14 MVT

## 결론

1. **S-MAP 2,000건 제한은 안정 정렬 pagination으로 완전 수집할 수 있다.** `resultType=hits`로 합계를 얻고 `sortBy=id`, `startIndex`, `count`로 페이지를 순회한다.
2. **분석 API는 2,000건을 정상 완료로 취급하면 안 된다.** hits 합계와 union 건수가 일치해야 `complete=true`다. 페이지 중복, 누락, timeout이 있으면 수치 리포트를 차단한다.
3. **첫 출시의 저고도 계약은 `10° 이상 정밀`, `5~10° 불확실`, `5° 미만 지평선 구간`으로 확정한다.** 6.9km z14 수집은 단일 삼전 표본에서도 64타일·12.8MB·3,231동이어서 모바일 요청마다 실행하기엔 무겁다.
4. **분석용 전국 건물은 브라우저의 현재 viewport 렌더 결과가 아니라 서버가 z14 MVT를 직접 수집·디코드해야 한다.** 부분 타일 실패는 `complete=false`로 반환한다.

## S-MAP 완전성 실측

삼전 표본 bbox: `127.084,37.494,127.096,37.506`

| 항목 | 결과 |
|---|---:|
| `resultType=hits` 합계 | 2,175 |
| hits 응답 | 126ms |
| 1페이지 | 2,000건, 483ms |
| 2페이지 | 175건, 222ms |
| 페이지 간 중복 | 0 |
| union | 2,175건 |
| 안정 정렬 | `sortBy=id` |

검증 결과:

- `startIndex`와 `count`가 동작한다.
- 페이지 2는 페이지 1과 다른 ID를 반환한다.
- union 2,175건이 hits 합계와 정확히 일치한다.
- property CQL filter(`id=376956`)는 1건을 반환했다.
- spatial CQL filter(`BBOX(geom,...)`)는 159건을 반환했다.
- URL의 `bbox` 파라미터와 `CQL_FILTER`를 동시에 주면 GeoServer가 상호 배타 오류를 반환한다. 장거리 band나 필터 수집은 CQL의 `BBOX`만 사용해야 한다.

### 구현 계약

- 먼저 `resultType=hits`를 호출한다.
- 각 페이지에 `sortBy=id`를 강제한다.
- `startIndex=0,2000,...`으로 합계까지 순회한다.
- ID dedupe 후 union 건수가 hits 합계와 같을 때만 완료 처리한다.
- 합계 불명, 반복 페이지, 일부 실패, abort, timeout은 `complete=false`다.
- pagination이 향후 깨질 경우에만 bbox 재귀 분할을 fallback으로 사용한다. leaf가 계속 cap이면 완료 처리하지 않는다.

## OpenFreeMap z14 표본

| 표본 | 타일 bytes | 건물 | 높이 입력 | `hide_3d` |
|---|---:|---:|---:|---:|
| 삼전 | 243,642 | 45 | 45 | 1 |
| 부산 | 125,474 | 81 | 81 | 0 |
| 제주 | 171,842 | 10 | 10 | 0 |

`render_height` 입력률은 세 표본에서 100%였지만, 이는 OpenMapTiles 파이프라인이 만든 렌더 속성이며 측량 높이라는 뜻은 아니다. 원본 태그와 층수 추정 여부를 구분해 품질 등급을 부여해야 한다.

## 반경별 삼전 벤치마크

동일 프로세스에서 raw MVT byte cache를 사용했다. warm 측정도 MVT 디코드와 GeoJSON geometry 보존은 다시 수행했다.

| 반경 | 타일 | raw bytes | 건물 | cold | warm | cold heap Δ | warm RSS Δ |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0.75km | 4 | 929,865 | 266 | 223ms | 24ms | 8.28MiB | 4.31MiB |
| 3.5km | 20 | 4,101,931 | 1,142 | 1,569ms | 117ms | 15.85MiB | 26.81MiB |
| 6.9km | 64 | 12,816,267 | 3,231 | 1,927ms | 717ms | 52.27MiB | 68.14MiB |

메모리는 Node 프로세스의 fetch + decode + retained GeoJSON 전후 값이라 브라우저 heap과 정확히 같지는 않다. 그래도 6.9km를 모바일 클라이언트가 매 분석마다 직접 수집하는 설계는 배제하기 충분하다.

## 저고도 제품 계약

보수적으로 높이 600m 장애물을 가정하면:

- 5°: 약 6.9km
- 10°: 약 3.4km

따라서 첫 출시는 다음처럼 표시한다.

- **10° 이상:** 최대 3.5km 수집이 완전한 경우 건물 기준 정밀 계산
- **5° 이상 10° 미만:** `저고도 불확실`로 분리하고 확정 직사광 합계와 순위에서 제외
- **5° 미만:** `지평선 구간`으로 분리

서버 캐시와 응답 축소로 6.9km 완전 수집이 운영 환경에서 충분히 빨라졌다는 별도 증거가 생기기 전에는 5° 정밀을 표방하지 않는다.

## 재현

```bash
npx tsx scripts/probe-smap-pagination.ts --self-test
npx tsx scripts/probe-smap-pagination.ts
npx tsx scripts/probe-mvt-buildings.ts --self-test
node --expose-gc --import tsx scripts/probe-mvt-buildings.ts
```

스크립트의 live endpoint 검증이 실패하면 과거 숫자를 성공으로 재사용하지 않는다.
