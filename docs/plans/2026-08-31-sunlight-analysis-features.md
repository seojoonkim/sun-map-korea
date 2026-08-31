# Sun Map Korea 일조 분석 3기능 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 현재 건물·태양 데이터를 바탕으로 ① 지점별 직사광 시간 리포트, ② 최대 4개 후보 비교·저장·공유, ③ 선택 시간대의 양지/그늘 누적 오버레이를 결과 완전성과 데이터 신뢰도를 숨기지 않는 방식으로 구현한다.

**Architecture:** 화면 렌더링용 건물 수집과 분석용 건물 수집을 분리한다. 서버의 통합 Building Query API가 서울 S-MAP과 전국 OpenFreeMap MVT를 정규화하고 완전성 메타데이터를 반환한다. 클라이언트 Web Worker는 로컬 미터 좌표에서 고도점 ray-prism 차폐 판정과 일별 샘플링을 수행하며, 누적 오버레이는 시간별 이진 그림자 마스크를 Canvas에 누적한다.

**Tech Stack:** Next.js 15, React 19, TypeScript, MapLibre GL 5, SunCalc, Node test runner, Web Worker, `@mapbox/vector-tile`, `pbf`, `flatbush`; 필요할 때만 `polygon-clipping`.

---

## 1. 제품 범위와 판정

### 기능 1. 지점별 직사광 시간 리포트

**판정: 조건부 가능**

현재 데이터로 가능한 결과:

- 선택 좌표와 날짜의 KST 기준 태양 방위각·고도각·일출·일몰
- 건물 footprint와 높이에 의한 직사광/차폐 추정
- 5분 단위 양지·그늘 구간, 총 직사광 추정 시간
- 사용자가 입력한 지면 기준 높이 또는 층수 추정 높이에서의 결과
- 데이터 출처와 높이 품질에 따른 신뢰도 및 경고

현재 데이터로 보장할 수 없는 결과:

- 수목, 차양, 베란다, 창 크기, 실내 구조, 날씨가 포함된 실제 채광량
- 산·언덕의 지형 차폐
- 창 방향을 입력하지 않은 세대의 실내 일조
- 법적 일조권 충족 여부

선결 조건:

1. 서울 S-MAP 2,000건 상한을 fail-closed로 해결한다.
2. `queryRenderedFeatures`가 아니라 분석 bbox의 건물을 서버에서 직접 수집한다.
3. 지면 그림자 포함 여부가 아니라 사용자의 고도점에서 태양 방향 ray가 건물 prism과 만나는지 계산한다.
4. 자기 건물 내부 지점을 별도 모드로 처리한다.
5. 저고도 태양의 장거리 차폐 범위와 제외 기준을 결과에 명시한다.

### 기능 2. 최대 4개 후보 비교·저장·공유

**판정: 기능 1 완성 후 가능**

추가 원천 데이터는 필요 없다. 동일한 분석 계약을 최대 네 지점에 적용하고 결과를 같은 날짜·같은 높이 조건으로 정렬하면 된다.

- 계정과 DB가 없어도 URL fragment 공유와 localStorage 저장이 가능하다.
- 공유 결과의 재현성을 위해 계산 버전, 데이터 출처, 날짜, 높이, 창 방향, 샘플 간격을 URL에 넣는다.
- 네 지점 중 하나라도 데이터 수집이 불완전하면 해당 후보에 숫자 대신 `분석 불완전`을 표시한다. 다른 후보와 조용히 순위를 매기지 않는다.

### 기능 3. 선택 시간대의 양지/그늘 누적 오버레이

**판정: 지면 기준으로 조건부 가능**

현재 데이터로 가능한 결과:

- 선택 날짜와 시간 범위에서 각 지도 픽셀이 그늘이었던 비율
- `계속 양지`, `부분 그늘`, `계속 그늘`을 연속 색상으로 표시
- 서울 정밀 건물과 전국 추정 건물을 데이터 신뢰도와 함께 표시

현재 데이터로 보장할 수 없는 결과:

- 특정 층 또는 창문 높이의 면 단위 누적 일조 지도
- 나무·지형·날씨를 포함한 실제 체감 일조
- 저배율 전국 동시 계산

선결 조건:

1. 화면 밖에서 들어오는 그림자를 포함하도록 분석 bbox를 확장한다.
2. 현재 convex hull 방식의 ㄷ자·ㅁ자 중정 과대 음영을 없앤다.
3. 같은 시간 안의 겹친 그림자를 한 번만 세는 이진 마스크 누적 방식을 사용한다.
4. z15 이상, 제한된 viewport에서만 활성화한다.

## 2. 현재 데이터 감사 결과

### 태양 데이터

- `src/lib/solar.ts`는 `SunCalc`를 사용한다.
- `dateAtKst()`가 `+09:00`을 명시하므로 브라우저 로컬 시간대와 독립적으로 KST 시각을 만든다.
- 현재 날짜·시각 한 점의 위치 계산은 재사용 가능하다.
- 일별 리포트용 시간 샘플 생성, 고도각 하한, 시간 구간 병합은 새로 필요하다.

### 서울 S-MAP

- API: `src/app/api/buildings/seoul/route.ts`
- 레이어: `seoul:footprint_w_minmax`
- 응답 geometry: Polygon/MultiPolygon
- 실응답 속성: `id`, `min`, `max`
- 현재 높이: `max - min`
- 실표본에서는 모든 feature가 유효한 min/max를 가졌다.
- 강남 canonical cell은 1,979건, 삼전 canonical cell은 정확히 2,000건이었다.
- `maxFeatures=2000`이므로 2,000건 응답은 완전한 결과가 아니라 잘림 의심 상태다.
- 현재 `normalizeSeoulBuildings()`는 절대 `min` 값을 버리고 `minHeight: 0`으로 바꾼다. 향후 `groundElevation`과 `topElevation`을 보존해야 한다.
- 실표본에는 `max-min`이 0.1m 미만인 feature도 있다. 출처만으로 무조건 A 등급을 주지 말고 높이 유효성 규칙을 적용해야 한다.

### 전국 OpenFreeMap/OSM

- TileJSON은 building layer를 z13~14에서 제공한다.
- 확인된 필드는 `render_height`, `render_min_height`, `hide_3d`, `colour`이다.
- `render_height`는 OSM 원천 태그와 층수로부터 근사될 수 있으므로 실측 높이와 동일하게 취급하지 않는다.
- 현재 `src/components/MapCanvas.tsx`는 화면에 렌더된 feature만 `queryRenderedFeatures()`로 읽는다.
- 화면 밖 건물, 아직 로드되지 않은 타일, 분석 bbox 밖의 장거리 차폐 건물은 현재 계산에 들어오지 않는다.
- 높이가 없으면 `src/lib/shadows.ts`에서 9m로 추정한다.
- 분석용으로는 TileJSON URL에서 z14 MVT를 직접 내려받아 bbox 단위로 디코드해야 한다.

### 현재 그림자 계산

- `createBuildingShadows()`는 `height / tan(elevation)`으로 길이를 구한다.
- 길이를 520m로 자르므로 겨울 아침·저녁 장거리 그림자를 놓친다.
- 외곽과 이동 외곽의 convex hull을 사용한다.
- concave footprint, ㄷ자, ㅁ자, 내부 hole을 과도하게 채운다.
- 사용자의 고도점이 아니라 지면 그림자만 계산한다.
- 서울 정밀 레이어가 활성화되면 그림자 수집 대상이 S-MAP 레이어 하나로 바뀐다. 화면에 함께 보이는 OpenFreeMap 보완 건물이 그림자 계산에서 빠질 수 있다.

### 검색·저장

- `src/lib/geocode.ts`는 Nominatim을 사용한다.
- 좌표와 주소 라벨은 얻지만 건물·세대·창 방향 정보는 없다.
- 계정·DB는 없다.
- 비교 저장은 localStorage, 공유는 versioned URL fragment로 먼저 구현할 수 있다.
- 제품 트래픽이 커지기 전에 Nominatim 사용 정책과 한국 주소 품질을 검토하고 VWorld 또는 계약 가능한 지오코더로 교체 여부를 결정한다.

## 3. 분석 정확도 계약

### 결과 명칭

사용자에게는 `직사광 추정`, `건물 기준 일조`, `지면 기준 누적 그늘`이라고 쓴다.

다음 표현은 쓰지 않는다.

- 일조권 충족
- 법적 기준 통과
- 실제 채광 보장
- 정확한 일조 시간

모든 리포트와 공유 화면에 다음 취지의 문구를 고정한다.

> 건물 형상과 공개 높이 데이터로 계산한 참고용 추정치입니다. 지형, 수목, 차양, 창 구조, 날씨는 반영하지 않으며 법적 감정 자료로 사용할 수 없습니다.

### 높이 신뢰도

- `surveyed`: S-MAP min/max가 유효하고 비정상치 규칙을 통과
- `tagged`: OSM `render_height`가 유효
- `floors-estimated`: 층수 × 기본 층고
- `default-estimated`: 높이 정보가 없어 9m 사용
- `invalid`: 높이가 비정상이며 대체 규칙도 적용할 수 없음

리포트 신뢰도는 가장 약한 단일 건물만으로 정하지 않는다. 실제 차폐에 기여한 건물의 높이 출처, 전체 후보 중 추정 높이 비율, 수집 완전성, 창 방향 입력 여부를 함께 산정한다.

### 수집 완전성

모든 분석 API 응답은 다음을 포함한다.

```ts
type BuildingQueryMeta = {
  complete: boolean;
  provider: "smap" | "openfreemap" | "hybrid";
  requestedBounds: [number, number, number, number];
  coveredBounds: [number, number, number, number];
  sourceVersion: string;
  featureCount: number;
  truncatedCells: string[];
  estimatedHeightRatio: number;
  warnings: string[];
};
```

`complete=false`이면 총 직사광 시간과 후보 순위를 만들지 않는다. 부분 지도 표시는 가능하지만 `분석 데이터 불완전` 상태를 유지한다.

### 저고도 태양

높이 600m의 보수적 장애물은 고도각 5°에서 약 6.86km 떨어져도 차폐할 수 있다. 모든 저고도 건물을 모바일에서 매번 수집하는 것은 비현실적이다.

첫 출시 계약:

- 태양 고도각 5° 미만은 `지평선 구간`으로 분리하고 총 직사광 확정값에서 제외한다.
- 5° 이상은 서버가 최대 6.9km까지 잠재 차폐를 검사할 수 있는지 feasibility spike로 검증한다.
- 6.9km 수집이 성능 기준을 넘으면 무조건 조용히 반경을 줄이지 않는다. `10° 이상 정밀 계산 + 5~10° 저신뢰 구간`으로 제품 계약을 낮춘다.
- 향후 DEM/DSM skyline 데이터를 도입하면 지형과 장거리 차폐를 별도 horizon profile로 계산한다.

## 4. 공통 데이터 모델

Create: `src/lib/buildings/types.ts`

```ts
export type AnalysisBuilding = {
  id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  height: number;
  minHeight: number;
  groundElevation?: number;
  topElevation?: number;
  heightQuality: "surveyed" | "tagged" | "floors-estimated" | "default-estimated";
  footprintSource: "smap-2025" | "openfreemap-osm";
};

export type BuildingQuery = {
  bounds: [number, number, number, number];
  purpose: "point-report" | "comparison" | "ground-overlay";
  target?: [number, number];
  minimumSunElevation: number;
};
```

Provider contract:

```ts
export interface BuildingProvider {
  getBuildings(query: BuildingQuery, signal?: AbortSignal): Promise<{
    buildings: AnalysisBuilding[];
    meta: BuildingQueryMeta;
  }>;
}
```

Rules:

- 지도 표시용 GeoJSON과 분석용 건물 배열을 분리한다.
- S-MAP과 OSM을 같은 ID namespace에 섞지 않는다.
- 서울 근거리에서는 S-MAP을 우선한다.
- S-MAP에서 빠진 footprint를 OSM으로 보완할 때 공간 중복 판정을 거친다.
- 데이터가 완전하지 않으면 fallback했다고 성공 처리하지 않는다.

## 5. 계산 엔진

### 좌표계

Create: `src/lib/analysis/local-coordinates.ts`

선택 지점을 원점으로 두고 WGS84 좌표를 동·북 방향 미터 좌표로 투영한다. 수 km 범위에서는 local tangent plane 근사가 충분하며, 테스트에서 geodesic 기준 오차를 제한한다.

### 고도점 ray-prism 판정

Create: `src/lib/analysis/direct-sun.ts`

입력:

- 대상점 `P = (x, y, z)`
- 태양 방위각 `az`
- 태양 고도각 `el`
- 후보 건물 prism 목록

절차:

1. 대상점에서 태양 방위각 방향의 2D 반직선을 만든다.
2. Flatbush 공간 인덱스로 반직선 corridor와 만날 수 있는 건물만 찾는다.
3. footprint의 outer ring과 holes를 고려해 진입·이탈 거리 구간을 구한다.
4. 거리 `d`에서 ray 높이는 `z + d * tan(el)`이다.
5. ray 높이 구간과 건물의 `base..top` 구간이 겹치면 차폐다.
6. 가장 가까운 실제 차폐 건물 ID, 거리, 높이를 diagnostic으로 반환한다.

```ts
type SunSample = {
  minute: number;
  azimuth: number;
  elevation: number;
  state: "sun" | "shade" | "below-horizon" | "uncertain";
  blockerId?: string;
};
```

### 자기 건물 내부 지점

사용 모드를 분리한다.

1. `ground-point`: 공원, 도로, 마당 등 지면점
2. `window-point`: 건물 내부 또는 외벽의 창

`window-point` 흐름:

- point-in-polygon으로 대상 건물을 찾는다.
- 가장 가까운 외벽 segment와 외향 법선을 계산한다.
- 사용자가 `남향/동향/서향/북향/지도에서 외벽 선택` 중 하나를 확인한다.
- 대상점을 외벽 바깥쪽으로 작은 epsilon만큼 이동한다.
- 대상 건물 자체는 외부 차폐 목록에서 제외한다.
- 창 법선의 뒤쪽 반구에 있는 태양은 `벽 뒤`로 판정한다.
- 층수 빠른 입력은 `층 × 2.8m + 창 중심 보정`의 추정치임을 표시하고, 직접 미터 입력을 함께 제공한다.

창 방향을 확인하지 않으면 실내 직사광 총 시간을 만들지 않고 `외부 점 기준` 결과만 보여준다.

### 일별 리포트

Create: `src/lib/analysis/daily-report.ts`

- KST 00:00부터 23:55까지 5분 간격으로 태양 위치를 만든다.
- 고도각 0° 이하는 night, 제품 하한 미만은 uncertain으로 분리한다.
- 나머지 sample에 ray-prism 판정을 적용한다.
- 연속 sample을 양지·그늘 구간으로 병합한다.
- 총 시간은 sample interval의 합으로 계산한다.
- 경계 오차를 숨기지 않도록 `± sample interval`을 함께 표시한다.
- 오늘, 춘분, 하지, 추분, 동지 프리셋을 유지한다.

### 누적 오버레이

Create: `src/workers/shadow-accumulation.worker.ts`

- 선택 범위를 10분 간격으로 샘플링한다. 정밀 모드에서만 5분을 허용한다.
- 각 시간마다 건물 footprint와 그림자 방향으로 만든 edge quad를 이진 offscreen canvas에 그린다.
- outer ring과 hole을 보존한다.
- 같은 시간의 겹친 그림자는 1로만 기록한다.
- 시간별 mask를 정수 누적 buffer에 더한다.
- 최종값을 `shadowedSamples / validSamples`로 정규화한다.
- MapLibre image source 또는 custom layer로 표시한다.
- 지도가 이동하면 이전 worker를 abort하고 캐시 가능한 tile mask만 재사용한다.

## 6. 저장·공유 스키마

Create: `src/lib/analysis/share-state.ts`

```ts
type SharedAnalysisV1 = {
  v: 1;
  algorithm: "sun-ray-v1";
  date: string;
  sampleMinutes: 5 | 10;
  mode: "report" | "compare" | "overlay";
  points: Array<{
    id: string;
    label: string;
    coordinates: [number, number];
    targetHeight: number;
    targetMode: "ground-point" | "window-point";
    facadeAzimuth?: number;
  }>;
  range?: [number, number];
};
```

- URL fragment에는 개인정보로 볼 수 있는 자유 텍스트 주소 대신 좌표와 사용자가 정한 짧은 라벨만 넣는다.
- localStorage는 이름 붙인 분석 목록만 저장한다.
- 계산 결과 자체보다 입력과 알고리즘 버전을 저장해 다시 계산한다.
- 과거 알고리즘 버전 링크를 열면 `이 링크는 이전 계산 방식으로 생성됨`을 표시한다.
- URL 길이가 실제 네 후보 상태에서 브라우저 한도를 넘는지 테스트한다.
- 서버 단축 링크와 계정 동기화는 사용 수요가 확인된 뒤 별도 결정한다.

## 7. UI 정보 구조

### 기본 지도

기존 태양 readout과 시간 slider를 유지한다. 새 `분석` 버튼을 누르면 지도 위 분석 drawer를 연다.

### 지점 리포트

1. 지도 중심 또는 지도 클릭으로 지점 선택
2. `지면` 또는 `창/세대` 선택
3. 높이 직접 입력, 또는 층수 빠른 입력
4. 창/세대라면 외벽 방향 확인
5. 날짜 선택
6. 분석 실행
7. 결과 카드
   - 직사광 추정 총 시간
   - 양지·그늘 timeline
   - 첫 직사광/마지막 직사광
   - 실제 차폐에 기여한 주요 건물 수
   - 데이터 신뢰도와 미반영 항목

### 후보 비교

- 최대 네 개의 색상 핀
- 모든 후보에 같은 날짜·샘플 간격을 적용
- 높이와 창 방향은 후보별 설정
- 기본 정렬은 사용자 추가 순서
- 사용자가 명시적으로 선택할 때만 직사광 시간순 정렬
- 숫자 한 개로 `최고`를 선언하지 않고 총 시간, 오전, 오후, 불확실 구간을 함께 보여준다.
- 저장, 링크 복사, 후보 삭제, 조건 복제 제공

### 누적 오버레이

- 날짜
- 시작·종료 시각 dual slider
- 품질: 빠르게 10분 / 정밀 5분
- z15 미만에서는 `더 확대하면 누적 일조를 볼 수 있어` 안내
- 범례: 0% 그늘, 부분 그늘, 100% 그늘
- `지면 기준`, 분석 해상도, 데이터 출처를 범례에 고정

### 반응형

- 390px: bottom sheet, 지도 높이 확보, 한 번에 주 행동 하나
- 1280px: 우측 고정 drawer, 지도와 결과 동시 표시
- 모든 지도 클릭 기능은 키보드용 좌표 입력과 검색 결과 선택 경로를 함께 제공
- 색상만으로 양지·그늘을 구분하지 않고 패턴 또는 텍스트 범례를 제공

## 8. 단계별 구현 계획

### Task 1: 데이터 feasibility spike

**Objective:** S-MAP 완전 수집 방법과 전국 z14 MVT의 실제 크기·성능을 결정한다.

**Files:**
- Create: `scripts/probe-smap-pagination.ts`
- Create: `scripts/probe-mvt-buildings.ts`
- Create: `docs/data-feasibility.md`

**Steps:**

1. S-MAP WFS가 `startIndex`, `count`, `resultType=hits`를 지원하는지 삼전 cap cell로 검증한다.
2. 지원하면 페이지 2가 다른 ID를 반환하고 합계가 2,000을 넘는지 검증한다.
3. 미지원이면 bbox 4분할 시 각 leaf가 2,000 미만이 될 때까지 재귀하고 union 결과가 부모 첫 2,000건을 포함하는지 검증한다.
4. CQL property filter와 spatial filter 지원 여부를 검증한다.
5. OpenFreeMap z14 타일을 삼전, 부산, 제주 표본에서 디코드하고 타일 bytes, building count, 높이 입력률을 기록한다.
6. 0.75km, 3.5km, 6.9km 수집의 cold/warm latency와 메모리를 390px급 모바일 예산 관점에서 측정한다.
7. 결과에 따라 5° 정밀 계약 또는 10° 정밀 + 5~10° 불확실 계약을 확정한다.
8. 스크립트와 보고서만 커밋한다.

**Acceptance:** 완전 수집 방식이 증명되고, 저고도 범위가 측정값으로 결정되기 전에는 기능 구현으로 넘어가지 않는다.

### Task 2: 공통 건물 타입과 품질 규칙

**Objective:** 두 원천을 같은 분석 계약으로 정규화한다.

**Files:**
- Create: `src/lib/buildings/types.ts`
- Create: `src/lib/buildings/quality.ts`
- Test: `tests/building-quality.test.ts`
- Modify: `src/lib/building-sources.ts`

**TDD cases:**

- S-MAP 절대 min/max 보존
- `max <= min`, 비현실적 미세 높이, NaN 거부 또는 명시적 대체
- OSM explicit height, min height, 층수 추정, 9m 기본값의 품질 등급
- MultiPolygon과 holes 보존
- source namespace가 다른 동일 ID 충돌 방지

**Verification:** `npm test -- tests/building-quality.test.ts`

### Task 3: S-MAP 완전 수집

**Objective:** 2,000 cap에서 조용히 잘리지 않는 서울 provider를 만든다.

**Files:**
- Create: `src/lib/buildings/smap-provider.ts`
- Modify: `src/app/api/buildings/seoul/route.ts`
- Test: `tests/smap-provider.test.ts`

**TDD cases:**

- 1,999건 leaf는 완료
- 2,000건 page/cell은 추가 페이지 또는 재귀 분할
- 재귀 leaf 하나가 계속 2,000이면 `complete=false`
- 중복 ID 제거 후 geometry 보존
- abort와 upstream timeout 전파
- 원 요청 bbox 밖 canonical cell feature 제거
- truncation 메타데이터 응답

**Verification:** 삼전 fixture가 2,000을 초과해도 complete이며, 강제 실패 fixture는 숫자 리포트를 막는다.

### Task 4: OpenFreeMap MVT provider

**Objective:** 현재 viewport 렌더링과 독립적으로 전국 분석 bbox의 건물을 수집한다.

**Files:**
- Create: `src/lib/buildings/mvt-provider.ts`
- Create: `src/lib/buildings/tile-math.ts`
- Test: `tests/mvt-provider.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Dependencies:** `@mapbox/vector-tile`, `pbf`

**TDD cases:**

- bbox가 교차하는 z14 tile 목록
- tile boundary 양쪽 fragment 모두 수집
- feature ID가 있으면 안정적 그룹화
- ID가 없으면 geometry hash로 exact duplicate만 제거
- `hide_3d=true` 제외
- `render_height`, `render_min_height` 보존
- 높이 없음 9m + `default-estimated`
- fetch 일부 실패 시 `complete=false`
- 요청 bbox와 분석 buffer 밖 geometry 제거

### Task 5: 통합 Building Query API와 캐시

**Objective:** 기능 세 개가 같은 완전성·출처 계약을 사용하게 한다.

**Files:**
- Create: `src/app/api/buildings/query/route.ts`
- Create: `src/lib/buildings/hybrid-provider.ts`
- Test: `tests/building-query-route.test.ts`

**Rules:**

- 서울 근거리 S-MAP 우선
- 필요한 장거리 band는 spike 결과에 따라 S-MAP filtered query 또는 MVT 사용
- 동일 footprint의 이중 차폐 방지
- 서버 `Cache-Control`과 셀/타일 key 캐시
- 응답 최대 bytes와 feature 수 제한
- 제한 초과는 축소 성공이 아니라 `complete=false`

### Task 6: 로컬 좌표와 ray-prism 엔진

**Objective:** 고도점 직사광을 결정하는 순수 계산 엔진을 만든다.

**Files:**
- Create: `src/lib/analysis/local-coordinates.ts`
- Create: `src/lib/analysis/polygon-ray.ts`
- Create: `src/lib/analysis/direct-sun.ts`
- Test: `tests/direct-sun.test.ts`
- Modify: `package.json`, `package-lock.json` for `flatbush`

**Golden tests:**

- 단일 직육면체 앞·뒤·옆·위 점
- 저층 건물 위로 ray가 통과
- `minHeight`가 있는 공중 구조물 아래/위 통과
- concave polygon과 hole
- MultiPolygon
- 같은 선상의 가까운 낮은 건물과 먼 높은 건물
- 대상 건물 제외
- 179°/180° 방위각 경계

### Task 7: 일별 리포트 엔진과 Worker

**Objective:** UI를 막지 않고 하루의 직사광 구간을 계산한다.

**Files:**
- Create: `src/lib/analysis/daily-report.ts`
- Create: `src/workers/direct-sun.worker.ts`
- Test: `tests/daily-report.test.ts`

**TDD cases:**

- KST 날짜가 사용자 브라우저 timezone과 무관
- 5분 sample 개수와 구간 병합
- night/uncertain/sun/shade 합계 보존
- incomplete building meta에서 report 거부
- abort 후 이전 결과가 UI에 반영되지 않음
- 결과에 algorithm/source version 포함

### Task 8: 지점/창 선택 UI

**Objective:** 사용자가 계산 가능한 지점과 높이·외벽 방향을 정확히 입력한다.

**Files:**
- Create: `src/components/analysis/AnalysisDrawer.tsx`
- Create: `src/components/analysis/PointSetup.tsx`
- Create: `src/components/analysis/ReportCard.tsx`
- Create: `src/components/analysis/SunTimeline.tsx`
- Modify: `src/components/SunMapExperience.tsx`
- Modify: `src/components/MapCanvas.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/analysis-ui-contract.test.ts`

**Acceptance:** ground/window 모드가 명확하고, window 모드는 facade 확인 없이 실내 총 시간을 만들지 않는다.

### Task 9: 최대 4개 비교

**Objective:** 같은 조건에서 후보 네 곳을 재현 가능하게 비교한다.

**Files:**
- Create: `src/components/analysis/ComparisonPanel.tsx`
- Create: `src/lib/analysis/comparison.ts`
- Test: `tests/comparison.test.ts`

**TDD cases:**

- 다섯 번째 후보 추가 차단
- 공통 날짜와 후보별 높이
- incomplete 후보 순위 제외
- 오전/오후/총 시간 계산
- 결과 순서 안정성

### Task 10: 저장과 공유

**Objective:** 백엔드 없이 분석 조건을 저장하고 공유한다.

**Files:**
- Create: `src/lib/analysis/share-state.ts`
- Create: `src/lib/analysis/saved-analyses.ts`
- Test: `tests/share-state.test.ts`
- Modify: `src/components/analysis/ComparisonPanel.tsx`

**TDD cases:**

- v1 round-trip
- malformed fragment fail-safe
- 좌표·높이 범위 검증
- unknown future version 안내
- 네 후보 URL 길이
- localStorage unavailable fallback

### Task 11: 정확한 순간 그림자 geometry

**Objective:** 현재 convex hull을 제거하고 concave footprint와 hole을 보존한다.

**Files:**
- Modify: `src/lib/shadows.ts`
- Test: `tests/shadows.test.ts`

**Implementation:** footprint 자체와 각 외곽 edge를 그림자 벡터로 민 quad를 생성한다. 벡터 union이 꼭 필요한 출력에서만 `polygon-clipping`을 도입한다. 단순 지도 표시와 raster mask는 겹친 polygon을 그대로 그려도 된다.

**Golden tests:** ㄷ자, ㅁ자 중정, hole, MultiPolygon, 0° 이하 고도각.

### Task 12: 누적 오버레이 Worker와 지도 레이어

**Objective:** 선택 시간대의 지면 그늘 비율을 지도에 표시한다.

**Files:**
- Create: `src/workers/shadow-accumulation.worker.ts`
- Create: `src/components/analysis/OverlayControls.tsx`
- Create: `src/lib/analysis/shadow-raster.ts`
- Test: `tests/shadow-accumulation.test.ts`
- Modify: `src/components/MapCanvas.tsx`
- Modify: `src/app/globals.css`

**TDD cases:**

- 같은 시간의 겹침은 1회
- 서로 다른 시간의 그늘은 누적
- invalid/uncertain sample은 분모 제외
- viewport 밖 건물 그림자가 안으로 들어옴
- 이동 중 stale result 폐기
- z15 미만 실행 차단

### Task 13: 데이터·법적·접근성 표시

**Objective:** 사용자가 수치의 의미와 한계를 결과와 함께 이해한다.

**Files:**
- Create: `src/components/analysis/ConfidenceDetails.tsx`
- Modify: `src/components/analysis/ReportCard.tsx`
- Modify: `src/components/analysis/ComparisonPanel.tsx`
- Modify: `src/components/analysis/OverlayControls.tsx`
- Modify: `src/app/layout.tsx` or attribution component
- Test: `tests/ui-contract.test.ts`

**Acceptance:** OSM/OpenMapTiles attribution, S-MAP 이용조건 링크, 참고용 추정 면책, 높이 추정 비율, 미반영 항목이 리포트와 공유 화면에 모두 존재한다.

### Task 14: 성능·통합·릴리스 검증

**Objective:** 세 기능을 모바일과 데스크톱에서 bounded release loop로 검증한다.

**Commands:**

```bash
npm test
npm run lint
npm run build
```

**Focused QA:**

- 390px와 1280px
- 강남역, 삼전역, 여의도, 부산, 제주 표본
- 오늘, 동지, 하지
- 지면점, 건물 내부 window point
- 네 후보 URL 재접속
- z15 누적 overlay
- 네트워크 실패, S-MAP cap, MVT tile 일부 실패
- 가로 overflow 0
- 콘솔 error 0
- stale worker result 0

**Release gates:**

1. deterministic QA 통과
2. whole-artifact 독립 감수 1회
3. blocker 수정 후 targeted closure review만 수행
4. commit/push
5. Vercel production deploy 1회
6. live 390/1280 smoke 1회
7. 라이브 API complete/incomplete read-back

## 9. 출시 순서

### Release A: 분석 기반만

- S-MAP cap 해결
- MVT direct provider
- 완전성 메타데이터
- ray engine
- 사용자 화면에는 아직 노출하지 않음

### Release B: 서울 지점 리포트

- 기능 1
- ground/window 모드
- 서울 S-MAP 중심
- 저고도 계약과 면책 고정

### Release C: 비교·저장·공유

- 기능 2
- 최대 네 후보
- localStorage와 versioned URL
- 전국은 높이 신뢰도를 명확히 낮춰 제공

### Release D: 누적 오버레이

- 기능 3
- z15 이상
- 지면 기준
- 10분 기본, 5분 정밀

### Evidence-gated 후속

다음은 자동으로 다음 버전에 넣지 않는다.

- DEM/DSM 지형 horizon
- 수목 데이터
- 날씨·구름
- 세대별 창문/베란다
- 계정·서버 저장·단축 링크
- 법적 일조 기준 판정

승격 조건은 실제 사용자 요청, 데이터 라이선스, 성능 측정, 검증 가능한 ground truth 확보다.

## 10. 최종 결정

1. **세 기능은 현재 원천 데이터로 구현 가능하다.** 다만 `건물 기준 추정`이라는 제품 범위를 지켜야 한다.
2. **현재 코드 그대로 통계 기능을 붙이는 것은 불가하다.** 서울 2,000 cap, viewport-only 수집, convex hull, 520m cap 때문에 숫자가 조용히 틀릴 수 있다.
3. **추가 데이터 없이 가장 신뢰도 높게 먼저 출시할 수 있는 것은 서울 지점 리포트다.**
4. **비교·공유는 계산 엔진 다음으로 비용이 낮다.** 계정이나 DB를 먼저 만들 필요가 없다.
5. **누적 오버레이는 마지막에 붙인다.** 시각적으로는 매력적이지만 정확한 건물 수집과 그림자 geometry가 먼저다.
6. **전국 결과는 높이 데이터 품질을 숨기지 않는 조건으로 출시한다.** 높이 미입력 9m 추정 지역은 서울 S-MAP과 같은 등급으로 표시하지 않는다.
7. **법적 판단 기능은 현재 범위에서 제외한다.** 신뢰도와 면책을 UI 구성 요소로 취급하고 부가 문구로 미루지 않는다.
