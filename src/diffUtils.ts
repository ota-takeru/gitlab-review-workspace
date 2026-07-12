import { diffArrays } from "diff";
import {
  DiffCount,
  ReviewLine,
  ReviewThread
} from "./reviewTypes";

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
          threads: threadMap.get(mrLine) ?? []
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
          threads: oldThreadMap.get(oldLine) ?? []
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
        threads: threadMap.get(mrLine) ?? []
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
        threads: oldThreadMap.get(removed.oldLine) ?? []
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
          threads: []
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
          threads: threadMap.get(mrLine) ?? []
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
        threads: threadMap.get(mrLine) ?? []
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

function groupThreadsByNewLine(threads: ReviewThread[]): Map<number, ReviewThread[]> {
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

function groupThreadsByOldLine(threads: ReviewThread[]): Map<number, ReviewThread[]> {
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
