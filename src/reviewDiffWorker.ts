import { parentPort } from "node:worker_threads";
import { buildReviewLines } from "./diffUtils";
import type { ReviewThread } from "./reviewTypes";

interface WorkerRequest {
  oldText: string;
  mrText: string;
  localText?: string;
  threads: Array<Pick<ReviewThread, "id" | "line" | "oldLine" | "newLine">>;
}

parentPort?.once("message", (request: WorkerRequest) => {
  try {
    const threads: ReviewThread[] = request.threads.map((thread) => ({
      ...thread,
      resolved: false,
      comments: []
    }));
    parentPort?.postMessage({
      ok: true,
      lines: buildReviewLines(request.oldText, request.mrText, request.localText, threads)
    });
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : "Diff calculation failed."
    });
  }
});
