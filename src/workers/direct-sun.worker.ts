import {
  generateDailyReport,
  type DailySunReport,
  type GenerateDailyReportInput,
} from "@/lib/analysis/daily-report";
import {
  generateGroundShadowOverlay,
  type GenerateGroundShadowOverlayInput,
  type GroundShadowOverlay,
} from "@/lib/analysis/ground-shadow-overlay";

export type DirectSunWorkerRequest = {
  requestId: number;
  input: GenerateDailyReportInput;
  overlayInput?: GenerateGroundShadowOverlayInput;
};

export type DirectSunWorkerResponse = {
  requestId: number;
  report: DailySunReport;
  overlay?: GroundShadowOverlay;
};

export function runDirectSunWorkerTask(request: DirectSunWorkerRequest): DirectSunWorkerResponse {
  return {
    requestId: request.requestId,
    report: generateDailyReport(request.input),
    overlay: request.overlayInput ? generateGroundShadowOverlay(request.overlayInput) : undefined,
  };
}

const workerScope = globalThis as typeof globalThis & {
  document?: Document;
  onmessage?: (event: MessageEvent<DirectSunWorkerRequest>) => void;
  postMessage?: (message: DirectSunWorkerResponse) => void;
};

if (typeof workerScope.document === "undefined" && typeof workerScope.postMessage === "function") {
  workerScope.onmessage = (event) => {
    workerScope.postMessage?.(runDirectSunWorkerTask(event.data));
  };
}
