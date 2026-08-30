export type PlaceResult = {
  id: string;
  label: string;
  detail: string;
  coordinates: [number, number];
};

type RawSearchResult = {
  place_id?: string | number;
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
};

type AddressParts = Record<string, string | undefined>;

const NOMINATIM = "https://nominatim.openstreetmap.org";

export function parseSearchResults(input: RawSearchResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const results: PlaceResult[] = [];

  for (const item of input) {
    const latitude = Number(item.lat);
    const longitude = Number(item.lon);
    const displayName = item.display_name?.trim();
    if (!displayName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const parts = displayName.split(",").map((part) => part.trim()).filter(Boolean);
    const label = parts[0];
    const detail = parts.slice(1).join(" · ") || "대한민국";
    const key = `${label}:${longitude.toFixed(4)}:${latitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: String(item.place_id ?? key),
      label,
      detail,
      coordinates: [longitude, latitude],
    });
  }

  return results.slice(0, 5);
}

export function formatLocality(address: AddressParts): string {
  const province = address.province ?? address.state ?? address.region;
  const city = address.city ?? address.county ?? address.municipality ?? address.district;
  const neighborhood = address.suburb ?? address.borough ?? address.town ?? address.village;
  return [...new Set([province, city, neighborhood].filter(Boolean))].join(" · ") || "대한민국";
}

export function localityCacheKey(coordinates: [number, number]) {
  return `${coordinates[0].toFixed(2)}:${coordinates[1].toFixed(2)}`;
}

export async function searchKorea(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    countrycodes: "kr",
    limit: "5",
    "accept-language": "ko",
  });
  const response = await fetch(`${NOMINATIM}/search?${params}`, { signal });
  if (!response.ok) throw new Error("지역 검색에 실패했습니다.");
  return parseSearchResults(await response.json() as RawSearchResult[]);
}

export async function reverseKoreaLocation(coordinates: [number, number], signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({
    lon: coordinates[0].toFixed(5),
    lat: coordinates[1].toFixed(5),
    format: "jsonv2",
    zoom: "14",
    "accept-language": "ko",
  });
  const response = await fetch(`${NOMINATIM}/reverse?${params}`, { signal });
  if (!response.ok) return "대한민국";
  const data = await response.json() as { address?: AddressParts };
  return formatLocality(data.address ?? {});
}
