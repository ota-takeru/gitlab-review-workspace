import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { buildReviewLines } from "./diffUtils";
import type { ReviewLine, ReviewThread } from "./reviewTypes";

const workerThresholdCharacters = 300_000;
const workerTimeoutMs = 60_000;

export function shouldBuildReviewLinesInWorker(
  oldText: string,
  mrText: string,
  localText?: string
): boolean {
  return oldText.length + mrText.length + (localText?.length ?? 0) >= workerThresholdCharacters;
}

export async function buildReviewLinesAsync(
  oldText: string,
  mrText: string,
  localText: string | undefined,
  threads: readonly ReviewThread[]
): Promise<ReviewLine[]> {
  if (!shouldBuildReviewLinesInWorker(oldText, mrText, localText)) {
    return buildReviewLines(oldText, mrText, localText, [...threads]);
  }

  return new Promise<ReviewLine[]>((resolve, reject) => {
    const worker = new Worker(join(__dirname, "reviewDiffWorker.js"));
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      operation();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("The full-file diff exceeded the 60 second calculation limit.")));
    }, workerTimeoutMs);
    worker.once("message", (message: { ok: boolean; lines?: ReviewLine[]; message?: string }) => {
      if (message.ok && message.lines) finish(() => resolve(message.lines!));
      else finish(() => reject(new Error(message.message ?? "Diff calculation failed.")));
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.postMessage({
      oldText,
      mrText,
      localText,
      threads: threads.map(({ id, line, oldLine, newLine }) => ({ id, line, oldLine, newLine }))
    });
  });
}
