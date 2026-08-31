import { createHybridBuildingProvider } from "@/lib/buildings/hybrid-provider";
import { handleBuildingsRequest } from "@/lib/buildings/http-route";
import { createOpenFreeMapMvtProvider } from "@/lib/buildings/mvt-provider";
import { createSmapProvider } from "@/lib/buildings/smap-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const provider = createHybridBuildingProvider({
  smap: createSmapProvider({ fetch }),
  openfreemap: createOpenFreeMapMvtProvider({ fetch }),
});

export function GET(request: Request): Promise<Response> {
  return handleBuildingsRequest(request, provider);
}
