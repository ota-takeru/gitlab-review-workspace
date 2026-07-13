import { diffArrays } from "diff";
import { parseCommitDiff } from "./commitDiffUtils";
import {
  DiffCount,
  ReviewLine,
  ReviewThread
} from "./reviewTypes";

export interface DiffSideBySideRow<T> {
  key: string;
  left?: T;
  right?: T;
  fullWidth?: boolean;
}

interface DiffSideBySideOptions {
  leftKinds: ReadonlySet<string>;
  rightKinds: ReadonlySet<string>;
  contextKinds: ReadonlySet<string>;
}

interface RemovedLine {
  oldLine: number;
  text: string;
}

interface MrMarkers {
  addedLines: Set<number>;
  oldLineByMrLine: Map<number, number>;
  removedBeforeMrLine: Map<number, RemovedLine[]>;
}

export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return [];
  }

  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

export function countLineDiff(oldText: string, newText: string): DiffCount {
  const parts = diffArrays(splitLines(oldText), splitLines(newText));
  return parts.reduce(
    (count, part) => ({
      additions: count.additions + (part.added ? part.value.length : 0),
      deletions: count.deletions + (part.removed ? part.value.length : 0)
    }),
    { additions: 0, deletions: 0 }
  );
}

export function countPatchDiff(patch: string | undefined): DiffCount {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of (patch ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

export function buildReviewLinesFromPatch(
  patch: string | undefined,
  threads: readonly ReviewThread[]
): ReviewLine[] {
  const byNewLine = groupThreadsByNewLine(threads);
  const byOldLine = groupThreadsByOldLine(threads);
  return parseCommitDiff(patch ?? "").map((line, index) => {
    const kind: ReviewLine["kind"] = line.kind === "added"
      ? "mr-added"
      : line.kind === "deleted"
        ? "mr-removed"
        : "context";
    const lineThreads = line.kind === "deleted"
      ? byOldLine.get(line.oldLine ?? -1) ?? []
      : byNewLine.get(line.newLine ?? -1) ?? [];
    const text = line.kind === "added" || line.kind === "deleted" || line.kind === "context"
      ? line.text.slice(1)
      : line.text;
    return {
      id: `patch-${index}-${line.oldLine ?? ""}-${line.newLine ?? ""}`,
      kind,
      text,
      oldLine: line.oldLine,
      mrLine: line.newLine,
      localLine: line.newLine,
      mrAdded: line.kind === "added",
      threadIds: lineThreads.map((thread) => thread.id)
    };
  });
}

export function buildSideBySideRows<T extends { kind: string }>(
  lines: readonly T[],
  options: DiffSideBySideOptions
): DiffSideBySideRow<T>[] {
  const rows: DiffSideBySideRow<T>[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;

    if (options.contextKinds.has(line.kind)) {
      rows.push({ key: `context-${index}`, left: line, right: line });
      index += 1;
      continue;
    }

    if (options.leftKinds.has(line.kind)) {
      const leftStart = index;
      while (index < lines.length && options.leftKinds.has(lines[index]?.kind ?? "")) index += 1;
      const leftBlock = lines.slice(leftStart, index);
      const rightStart = index;
      while (index < lines.length && options.rightKinds.has(lines[index]?.kind ?? "")) index += 1;
      const rightBlock = lines.slice(rightStart, index);
      const rowCount = Math.max(leftBlock.length, rightBlock.length);

      for (let offset = 0; offset < rowCount; offset += 1) {
        rows.push({
          key: `change-${leftStart}-${rightStart}-${offset}`,
          left: leftBlock[offset],
          right: rightBlock[offset]
        });
      }
      continue;
    }

    if (options.rightKinds.has(line.kind)) {
      const rightStart = index;
      while (index < lines.length && options.rightKinds.has(lines[index]?.kind ?? "")) index += 1;
      const rightBlock = lines.slice(rightStart, index);
      rightBlock.forEach((right, offset) => {
        rows.push({ key: `change-${rightStart}-${offset}`, right });
      });
      continue;
    }

    rows.push({ key: `full-${index}`, left: line, fullWidth: true });
    index += 1;
  }

  return rows;
}

export function buildReviewLines(
  oldText: string,
  mrText: string,
  localText: string | undefined,
  threads: ReviewThread[]
): ReviewLine[] {
  if (localText !== undefined && localText !== mrText) {
    return buildReviewLinesWithLocalEdits(oldText, mrText, localText, threads);
  }

  return buildMrReviewLines(oldText, mrText, threads);
}

function buildMrReviewLines(
  oldText: string,
  mrText: string,
  threads: ReviewThread[]
): ReviewLine[] {
  const oldLines = splitLines(oldText);
  const mrLines = splitLines(mrText);
  const threadMap = groupThreadsByNewLine(threads);
  const oldThreadMap = groupThreadsByOldLine(threads);
  const rows: ReviewLine[] = [];
  let oldLine = 1;
  let mrLine = 1;

  for (const part of diffArrays(oldLines, mrLines)) {
    if (part.added) {
      for (const text of part.value) {
        rows.push({
          id: `mr-added-${mrLine}`,
          kind: "mr-added",
          text,
          mrLine,
          localLine: mrLine,
          mrAdded: true,
          threadIds: (threadMap.get(mrLine) ?? []).map((thread) => thread.id)
        });
        mrLine += 1;
      }
      continue;
    }

    if (part.removed) {
      for (const text of part.value) {
        rows.push({
          id: `mr-removed-${oldLine}-${rows.length}`,
          kind: "mr-removed",
          text,
          oldLine,
          threadIds: (oldThreadMap.get(oldLine) ?? []).map((thread) => thread.id)
        });
        oldLine += 1;
      }
      continue;
    }

    for (const text of part.value) {
      rows.push({
        id: `context-${oldLine}-${mrLine}`,
        kind: "context",
        text,
        oldLine,
        mrLine,
        localLine: mrLine,
        threadIds: (threadMap.get(mrLine) ?? []).map((thread) => thread.id)
      });
      oldLine += 1;
      mrLine += 1;
    }
  }

  return rows;
}

function buildReviewLinesWithLocalEdits(
  oldText: string,
  mrText: string,
  localText: string,
  threads: ReviewThread[]
): ReviewLine[] {
  const mrLines = splitLines(mrText);
  const localLines = splitLines(localText);
  const mrMarkers = buildMrMarkers(oldText, mrText);
  const threadMap = groupThreadsByNewLine(threads);
  const oldThreadMap = groupThreadsByOldLine(threads);
  const rows: ReviewLine[] = [];
  const insertedRemovedBlocks = new Set<number>();
  let mrLine = 1;
  let localLine = 1;

  const pushMrRemovedBefore = (anchorLine: number) => {
    if (insertedRemovedBlocks.has(anchorLine)) {
      return;
    }

    insertedRemovedBlocks.add(anchorLine);
    const removedLines = mrMarkers.removedBeforeMrLine.get(anchorLine) ?? [];
    for (const removed of removedLines) {
      rows.push({
        id: `mr-removed-${removed.oldLine}-${rows.length}`,
        kind: "mr-removed",
        text: removed.text,
        oldLine: removed.oldLine,
        threadIds: (oldThreadMap.get(removed.oldLine) ?? []).map((thread) => thread.id)
      });
    }
  };

  for (const part of diffArrays(mrLines, localLines)) {
    if (part.added) {
      for (const text of part.value) {
        rows.push({
          id: `local-added-${localLine}-${rows.length}`,
          kind: "local-added",
          text,
          localLine,
          threadIds: []
        });
        localLine += 1;
      }
      continue;
    }

    if (part.removed) {
      for (const text of part.value) {
        pushMrRemovedBefore(mrLine);
        rows.push({
          id: `local-removed-${mrLine}-${rows.length}`,
          kind: "local-removed",
          text,
          oldLine: mrMarkers.oldLineByMrLine.get(mrLine),
          mrLine,
          mrAdded: mrMarkers.addedLines.has(mrLine),
          threadIds: (threadMap.get(mrLine) ?? []).map((thread) => thread.id)
        });
        mrLine += 1;
      }
      continue;
    }

    for (const text of part.value) {
      pushMrRemovedBefore(mrLine);
      const wasAddedInMr = mrMarkers.addedLines.has(mrLine);
      rows.push({
        id: `${wasAddedInMr ? "mr-added" : "context"}-${mrLine}-${localLine}`,
        kind: wasAddedInMr ? "mr-added" : "context",
        text,
        oldLine: mrMarkers.oldLineByMrLine.get(mrLine),
        mrLine,
        localLine,
        mrAdded: wasAddedInMr,
        threadIds: (threadMap.get(mrLine) ?? []).map((thread) => thread.id)
      });
      mrLine += 1;
      localLine += 1;
    }
  }

  pushMrRemovedBefore(mrLine);
  return rows;
}

function buildMrMarkers(oldText: string, mrText: string): MrMarkers {
  const oldLines = splitLines(oldText);
  const mrLines = splitLines(mrText);
  const addedLines = new Set<number>();
  const oldLineByMrLine = new Map<number, number>();
  const removedBeforeMrLine = new Map<number, RemovedLine[]>();
  let oldLine = 1;
  let mrLine = 1;

  const addRemovedLine = (anchorLine: number, removedLine: RemovedLine) => {
    const lines = removedBeforeMrLine.get(anchorLine) ?? [];
    lines.push(removedLine);
    removedBeforeMrLine.set(anchorLine, lines);
  };

  for (const part of diffArrays(oldLines, mrLines)) {
    if (part.added) {
      for (const _ of part.value) {
        addedLines.add(mrLine);
        mrLine += 1;
      }
      continue;
    }

    if (part.removed) {
      const anchorLine = mrLine;
      for (const text of part.value) {
        addRemovedLine(anchorLine, { oldLine, text });
        oldLine += 1;
      }
      continue;
    }

    for (const _ of part.value) {
      oldLineByMrLine.set(mrLine, oldLine);
      oldLine += 1;
      mrLine += 1;
    }
  }

  return { addedLines, oldLineByMrLine, removedBeforeMrLine };
}

function groupThreadsByNewLine(threads: readonly ReviewThread[]): Map<number, ReviewThread[]> {
  const map = new Map<number, ReviewThread[]>();
  for (const thread of threads) {
    const line = thread.newLine ?? thread.line;
    if (typeof line !== "number") {
      continue;
    }

    const existing = map.get(line) ?? [];
    existing.push(thread);
    map.set(line, existing);
  }
  return map;
}

function groupThreadsByOldLine(threads: readonly ReviewThread[]): Map<number, ReviewThread[]> {
  const map = new Map<number, ReviewThread[]>();
  for (const thread of threads) {
    if (typeof thread.oldLine !== "number") {
      continue;
    }

    const existing = map.get(thread.oldLine) ?? [];
    existing.push(thread);
    map.set(thread.oldLine, existing);
  }
  return map;
}
