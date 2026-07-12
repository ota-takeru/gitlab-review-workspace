import { diffArrays } from "diff";

export type CommitPatchLineKind = "context" | "added" | "deleted" | "hunk" | "meta";

export interface CommitPatchLine {
  kind: CommitPatchLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface CommitFileDiffLine {
  kind: "context" | "added" | "deleted";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export function parseCommitDiff(diff: string): CommitPatchLine[] {
  let oldLine: number | undefined;
  let newLine: number | undefined;

  return diff.split(/\r?\n/).map((text) => {
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { kind: "hunk", text };
    }
    if (text.startsWith("\\ No newline") || text.startsWith("+++ ") || text.startsWith("--- ")) {
      return { kind: "meta", text };
    }
    if (text.startsWith("+") && newLine !== undefined) {
      const line = { kind: "added" as const, text, newLine };
      newLine += 1;
      return line;
    }
    if (text.startsWith("-") && oldLine !== undefined) {
      const line = { kind: "deleted" as const, text, oldLine };
      oldLine += 1;
      return line;
    }
    if (text.startsWith(" ") && oldLine !== undefined && newLine !== undefined) {
      const line = { kind: "context" as const, text, oldLine, newLine };
      oldLine += 1;
      newLine += 1;
      return line;
    }
    return { kind: "meta", text };
  });
}

export function buildCommitFileDiff(oldText: string, newText: string): CommitFileDiffLine[] {
  const oldLines = splitTextLines(oldText);
  const newLines = splitTextLines(newText);
  const lines: CommitFileDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const part of diffArrays(oldLines, newLines)) {
    if (part.removed) {
      for (const text of part.value) {
        lines.push({ kind: "deleted", text: `-${text}`, oldLine });
        oldLine += 1;
      }
      continue;
    }
    if (part.added) {
      for (const text of part.value) {
        lines.push({ kind: "added", text: `+${text}`, newLine });
        newLine += 1;
      }
      continue;
    }
    for (const text of part.value) {
      lines.push({ kind: "context", text: ` ${text}`, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return lines;
}

function splitTextLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.length === 0) return [];
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
