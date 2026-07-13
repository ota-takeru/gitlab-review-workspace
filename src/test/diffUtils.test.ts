import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewLines,
  buildReviewLinesFromPatch,
  buildSideBySideRows,
  countLineDiff,
  countPatchDiff,
  splitLines
} from "../diffUtils";
import { ReviewThread } from "../reviewTypes";

const thread: ReviewThread = {
  id: "thread-1",
  filePath: "src/example.ts",
  line: 2,
  resolved: false,
  comments: [
    {
      id: "comment-1",
      author: "reviewer",
      body: "Please revise this line.",
      createdAt: "2026-07-10T12:00:00.000Z"
    }
  ]
};

test("splitLines normalizes CRLF and omits the trailing empty line", () => {
  assert.deepEqual(splitLines("first\r\nsecond\r\n"), ["first", "second"]);
  assert.deepEqual(splitLines(""), []);
});

test("patch-first review lines preserve counts, line numbers, and thread ids", () => {
  const patch = "@@ -1,2 +1,2 @@\n unchanged\n-before\n+after";
  const lines = buildReviewLinesFromPatch(patch, [{ ...thread, oldLine: 2, newLine: 2 }]);

  assert.deepEqual(countPatchDiff(patch), { additions: 1, deletions: 1 });
  assert.deepEqual(
    lines.map((line) => [line.kind, line.text, line.oldLine, line.mrLine]),
    [
      ["context", "@@ -1,2 +1,2 @@", undefined, undefined],
      ["context", "unchanged", 1, 1],
      ["mr-removed", "before", 2, undefined],
      ["mr-added", "after", undefined, 2]
    ]
  );
  assert.deepEqual(lines.at(-1)?.threadIds, ["thread-1"]);
});

test("countPatchDiff ignores file headers and no-newline markers", () => {
  const patch = [
    "--- a/src/file.ts",
    "+++ b/src/file.ts",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    "\\ No newline at end of file"
  ].join("\n");

  assert.deepEqual(countPatchDiff(patch), { additions: 1, deletions: 1 });
});

test("countLineDiff counts additions and removals independently", () => {
  assert.deepEqual(
    countLineDiff("one\ntwo\nthree\n", "one\nchanged\nthree\nfour\n"),
    { additions: 2, deletions: 1 }
  );
});

test("buildSideBySideRows pairs changed blocks and keeps context aligned", () => {
  const rows = buildSideBySideRows([
    { kind: "context", text: "same" },
    { kind: "deleted", text: "old-1" },
    { kind: "deleted", text: "old-2" },
    { kind: "added", text: "new-1" },
    { kind: "context", text: "after" }
  ], {
    leftKinds: new Set(["deleted"]),
    rightKinds: new Set(["added"]),
    contextKinds: new Set(["context"])
  });

  assert.deepEqual(rows.map((row) => [row.left?.text, row.right?.text]), [
    ["same", "same"],
    ["old-1", "new-1"],
    ["old-2", undefined],
    ["after", "after"]
  ]);
});

test("MR review rows retain old and MR positions and attach comment threads", () => {
  const rows = buildReviewLines(
    "alpha\nbeta\ngamma\n",
    "alpha\nbeta changed\ngamma\ndelta\n",
    undefined,
    [thread]
  );

  assert.deepEqual(
    rows.map((row) => [row.kind, row.text, row.oldLine, row.mrLine]),
    [
      ["context", "alpha", 1, 1],
      ["mr-removed", "beta", 2, undefined],
      ["mr-added", "beta changed", undefined, 2],
      ["context", "gamma", 3, 3],
      ["mr-added", "delta", undefined, 4]
    ]
  );
  assert.deepEqual(rows[2].threadIds, ["thread-1"]);
});

test("local edits are shown separately without losing MR markers or threads", () => {
  const rows = buildReviewLines(
    "A\nB\nC\nD\n",
    "A\nB changed\nC\nD\nE\n",
    "A\nB local\nC\nF\nE\n",
    [thread]
  );

  assert.deepEqual(
    rows.map((row) => [row.kind, row.text]),
    [
      ["context", "A"],
      ["mr-removed", "B"],
      ["local-removed", "B changed"],
      ["local-added", "B local"],
      ["context", "C"],
      ["local-removed", "D"],
      ["local-added", "F"],
      ["mr-added", "E"]
    ]
  );

  const removedMrLine = rows.find((row) => row.kind === "local-removed" && row.mrLine === 2);
  assert.equal(removedMrLine?.mrAdded, true);
  assert.deepEqual(removedMrLine?.threadIds, ["thread-1"]);
});

test("comments on deleted MR lines stay attached to their old line", () => {
  const [row] = buildReviewLines(
    "before\nremoved\nafter\n",
    "before\nafter\n",
    undefined,
    [
      {
        ...thread,
        id: "deleted-line-thread",
        line: 2,
        oldLine: 2,
        newLine: undefined
      }
    ]
  ).filter((line) => line.kind === "mr-removed");

  assert.equal(row.text, "removed");
  assert.deepEqual(row.threadIds, ["deleted-line-thread"]);
});
