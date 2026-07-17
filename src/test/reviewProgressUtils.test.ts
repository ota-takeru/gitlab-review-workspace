import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReviewProgress,
  isReviewFileNewSinceLastReview,
  isReviewFileViewed,
  normalizeReviewProgressRecords
} from "../reviewProgressUtils";
import type { FileSummary, ReviewThread } from "../reviewTypes";

const files: FileSummary[] = [
  {
    path: "src/a.ts",
    language: "typescript",
    additions: 2,
    deletions: 0,
    threadCount: 1,
    unresolvedThreadCount: 1,
    resolvedThreadCount: 0,
    hasLocalEdit: false
  },
  {
    path: "src/b.ts",
    language: "typescript",
    additions: 1,
    deletions: 1,
    threadCount: 0,
    unresolvedThreadCount: 0,
    resolvedThreadCount: 0,
    hasLocalEdit: false
  }
];

const threads: ReviewThread[] = [
  {
    id: "discussion-1",
    filePath: "src/a.ts",
    line: 12,
    resolved: false,
    resolvable: true,
    comments: []
  },
  {
    id: "discussion-2",
    filePath: "src/b.ts",
    line: 4,
    resolved: true,
    resolvable: true,
    comments: []
  }
];

test("calculateReviewProgress combines file and discussion progress", () => {
  const progress = calculateReviewProgress(
    files,
    threads,
    { viewedFiles: ["src/a.ts"], viewedFileHeads: { "src/a.ts": "head-2" } },
    "head-2",
    { projectId: "101", mergeRequestIid: 42, fromSha: "head-1", toSha: "head-2", commitCount: 2 },
    0
  );

  assert.equal(progress.viewedFiles, 1);
  assert.equal(progress.unviewedFiles, 1);
  assert.equal(progress.totalDiscussions, 2);
  assert.equal(progress.resolvedDiscussions, 1);
  assert.equal(progress.unresolvedDiscussions, 1);
  assert.equal(progress.completionPercent, 50);
  assert.equal(progress.completionState, "in-progress");
  assert.deepEqual(progress.nextUnresolvedThread, { id: "discussion-1", filePath: "src/a.ts", line: 12 });
  assert.equal(progress.newSinceLastReview, true);
  assert.equal(progress.newCommitCount, 2);
});

test("complete progress waits for all files and unresolved discussions", () => {
  const progress = calculateReviewProgress(
    files,
    threads,
    { viewedFiles: files.map((file) => file.path), lastReviewedSha: "head-2", lastReviewedAt: "2026-07-17T00:00:00.000Z" },
    "head-2",
    undefined,
    0
  );

  assert.equal(progress.completionPercent, 75);
  assert.equal(progress.completionState, "in-progress");
  assert.equal(progress.newSinceLastReview, false);
});

test("pending drafts make the progress ready to submit", () => {
  const progress = calculateReviewProgress(
    files,
    threads.map((thread) => ({ ...thread, resolved: true })),
    { viewedFiles: files.map((file) => file.path) },
    "head-2",
    undefined,
    1
  );

  assert.equal(progress.completionPercent, 100);
  assert.equal(progress.completionState, "ready-to-submit");
});

test("a new push only invalidates changed viewed files", () => {
  const record = { viewedFiles: ["src/a.ts", "src/b.ts"], lastReviewedSha: "head-1" };
  const newChanges = {
    projectId: "101",
    mergeRequestIid: 42,
    fromSha: "head-1",
    toSha: "head-2",
    commitCount: 1,
    changedPaths: ["src/a.ts"]
  };

  assert.equal(isReviewFileViewed("src/a.ts", record, "head-2", newChanges), false);
  assert.equal(isReviewFileViewed("src/b.ts", record, "head-2", newChanges), true);
  assert.equal(isReviewFileNewSinceLastReview("src/a.ts", record, "head-2", newChanges), true);
  assert.equal(isReviewFileNewSinceLastReview("src/b.ts", record, "head-2", newChanges), false);
});

test("viewing a changed file at the current head restores its viewed state", () => {
  const record = {
    viewedFiles: ["src/a.ts"],
    viewedFileHeads: { "src/a.ts": "head-2" },
    lastReviewedSha: "head-1"
  };
  const newChanges = {
    projectId: "101",
    mergeRequestIid: 42,
    fromSha: "head-1",
    toSha: "head-2",
    commitCount: 1,
    changedPaths: ["src/a.ts"]
  };

  assert.equal(isReviewFileViewed("src/a.ts", record, "head-2", newChanges), true);
});

test("missing comparison paths conservatively invalidates every viewed file", () => {
  const record = { viewedFiles: ["src/a.ts", "src/b.ts"], lastReviewedSha: "head-1" };
  const newChanges = {
    projectId: "101",
    mergeRequestIid: 42,
    fromSha: "head-1",
    toSha: "head-2",
    commitCount: 1
  };

  assert.equal(isReviewFileViewed("src/a.ts", record, "head-2", newChanges), false);
  assert.equal(isReviewFileViewed("src/b.ts", record, "head-2", newChanges), false);
});

test("normalizeReviewProgressRecords drops malformed persisted values", () => {
  assert.deepEqual(
    normalizeReviewProgressRecords({
      "101!42": {
        viewedFiles: ["src/a.ts", 42, "src/a.ts"],
        viewedFileHeads: { "src/a.ts": "head-2", "src/b.ts": 42 },
        lastReviewedSha: "head-2"
      },
      invalid: null,
      malformed: { viewedFiles: "src/a.ts" }
    }),
    {
      "101!42": {
        viewedFiles: ["src/a.ts"],
        viewedFileHeads: { "src/a.ts": "head-2" },
        lastReviewedSha: "head-2",
        lastReviewedAt: undefined
      },
      malformed: { viewedFiles: [], lastReviewedSha: undefined, lastReviewedAt: undefined }
    }
  );
});
