import type { BuildingProvider, BuildingQuery } from "./types";

const SEOUL_BOUNDS = [126.76, 37.41, 127.19, 37.72] as const;

type HybridProviderOptions = {
  smap: BuildingProvider;
  openfreemap: BuildingProvider;
};

function isInsideSeoul(query: BuildingQuery) {
  const [west, south, east, north] = query.bounds;
  const target = query.target;
  const boundsInside = west >= SEOUL_BOUNDS[0]
    && south >= SEOUL_BOUNDS[1]
    && east <= SEOUL_BOUNDS[2]
    && north <= SEOUL_BOUNDS[3];
  const targetInside = !target || (
    target[0] >= SEOUL_BOUNDS[0]
    && target[0] <= SEOUL_BOUNDS[2]
    && target[1] >= SEOUL_BOUNDS[1]
    && target[1] <= SEOUL_BOUNDS[3]
  );
  return boundsInside && targetInside;
}

export function createHybridBuildingProvider({
  smap,
  openfreemap,
}: HybridProviderOptions): BuildingProvider {
  return {
    getBuildings(query, signal) {
      const provider = isInsideSeoul(query) ? smap : openfreemap;
      return provider.getBuildings(query, signal);
    },
  };
}
