import type { ReviewLine, ReviewThread } from "./reviewTypes";

export type NativeReviewSide = "base" | "head";

export interface NativeThreadLocation {
  side: NativeReviewSide;
  line: number;
}

export function nativeThreadLocation(
  thread: Pick<ReviewThread, "line" | "oldLine" | "newLine">
): NativeThreadLocation | undefined {
  if (typeof thread.newLine === "number" && thread.newLine > 0) {
    return { side: "head", line: thread.newLine };
  }
  if (typeof thread.oldLine === "number" && thread.oldLine > 0) {
    return { side: "base", line: thread.oldLine };
  }
  if (typeof thread.line === "number" && thread.line > 0) {
    return { side: "head", line: thread.line };
  }
  return undefined;
}

export function oldLineForMrLine(lines: readonly ReviewLine[], mrLine: number): number | undefined {
  return lines.find((line) => line.mrLine === mrLine)?.oldLine;
}

export function appendCommentMarkdown(body: string, markdown: string): string {
  const trimmedBody = body.trim();
  const trimmedMarkdown = markdown.trim();
  if (!trimmedBody) return trimmedMarkdown;
  if (!trimmedMarkdown) return trimmedBody;
  return `${trimmedBody}\n\n${trimmedMarkdown}`;
}

export function normalizeTextForComparison(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function privateCommentImagePaths(body: string): string[] {
  return [...new Set(
    [...body.matchAll(/!\[(?:\\.|[^\]\\\n])*\]\(((?:\/uploads\/|https:\/\/[^\s/]+(?:\/[^\s]*)?\/uploads\/)[^\s)]+)\)/gi)]
      .map((match) => match[1])
  )];
}
