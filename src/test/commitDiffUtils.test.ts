import assert from "node:assert/strict";
import test from "node:test";
import { buildCommitFileDiff, parseCommitDiff } from "../commitDiffUtils";

test("buildCommitFileDiff creates a full-file diff with stable line numbers", () => {
  const lines = buildCommitFileDiff("one\ntwo\nthree", "one\nchanged\nthree\nfour");

  assert.deepEqual(lines, [
    { kind: "context", text: " one", oldLine: 1, newLine: 1 },
    { kind: "deleted", text: "-two", oldLine: 2 },
    { kind: "added", text: "+changed", newLine: 2 },
    { kind: "context", text: " three", oldLine: 3, newLine: 3 },
    { kind: "added", text: "+four", newLine: 4 }
  ]);
});

test("parseCommitDiff tracks old and new lines across multiple hunks", () => {
  const lines = parseCommitDiff([
    "@@ -2,3 +2,3 @@",
    " same",
    "-old",
    "+new",
    "@@ -10 +11,2 @@",
    "-gone",
    "+first",
    "+second",
    "\\ No newline at end of file"
  ].join("\n"));

  assert.deepEqual(lines.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine })), [
    { kind: "hunk", oldLine: undefined, newLine: undefined },
    { kind: "context", oldLine: 2, newLine: 2 },
    { kind: "deleted", oldLine: 3, newLine: undefined },
    { kind: "added", oldLine: undefined, newLine: 3 },
    { kind: "hunk", oldLine: undefined, newLine: undefined },
    { kind: "deleted", oldLine: 10, newLine: undefined },
    { kind: "added", oldLine: undefined, newLine: 11 },
    { kind: "added", oldLine: undefined, newLine: 12 },
    { kind: "meta", oldLine: undefined, newLine: undefined }
  ]);
});

test("parseCommitDiff treats file headers as metadata", () => {
  const lines = parseCommitDiff("--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new");
  assert.deepEqual(lines.map(({ kind }) => kind), ["meta", "meta", "hunk", "deleted", "added"]);
});
