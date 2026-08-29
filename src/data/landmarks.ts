export type Landmark = {
  id: string;
  name: string;
  subtitle: string;
  coordinates: [number, number];
  sunlightScore: number;
};

export const LANDMARKS: Landmark[] = [
  { id: "gangnam", name: "강남역", subtitle: "강남대로 · 2호선", coordinates: [127.02761, 37.49794], sunlightScore: 76 },
  { id: "coex", name: "COEX", subtitle: "영동대로 · 무역센터", coordinates: [127.05917, 37.51168], sunlightScore: 62 },
  { id: "seonjeongneung", name: "선정릉", subtitle: "조선왕릉 · 녹지", coordinates: [127.04892, 37.50867], sunlightScore: 88 },
  { id: "dosan", name: "도산공원", subtitle: "신사동 · 도시공원", coordinates: [127.03510, 37.52269], sunlightScore: 91 },
];

export const GANGNAM_CENTER: [number, number] = [127.0445, 37.5065];
