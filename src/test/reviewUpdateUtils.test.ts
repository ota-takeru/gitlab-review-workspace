import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewCommit, ReviewState } from "../reviewTypes";
import { detectReviewUpdateRange, mergeReviewUpdateRanges } from "../reviewUpdateUtils";

function review(headSha: string, commitIds: string[], projectId = "101", iid = 42): ReviewState {
  const commits: ReviewCommit[] = commitIds.map((id) => ({
    id,
    shortId: id.slice(0, 8),
    title: id,
    authorName: "author",
    authoredAt: "2026-01-01T00:00:00.000Z",
    committedAt: "2026-01-01T00:00:00.000Z"
  }));
  return {
    id: `${projectId}!${iid}`,
    projectId,
    mergeRequestIid: iid,
    diffRefs: { baseSha: "base", startSha: "base", headSha },
    title: "MR",
    state: "opened",
    sourceBranch: "feature",
    targetBranch: "main",
    author: "author",
    reviewers: [],
    commits,
    files: [],
    threads: []
  };
}

test("detectReviewUpdateRange reports commits added after the previous head", () => {
  assert.deepEqual(
    detectReviewUpdateRange(
      review("commit-1", ["commit-1"]),
      review("commit-3", ["commit-1", "commit-2", "commit-3"])
    ),
    {
      projectId: "101",
      mergeRequestIid: 42,
      fromSha: "commit-1",
      toSha: "commit-3",
      commitCount: 2
    }
  );
});

test("detectReviewUpdateRange ignores unchanged heads and another merge request", () => {
  assert.equal(detectReviewUpdateRange(review("same", ["same"]), review("same", ["same"])), undefined);
  assert.equal(detectReviewUpdateRange(review("old", ["old"]), review("new", ["new"], "202")), undefined);
});

test("detectReviewUpdateRange handles a force-pushed previous head", () => {
  assert.equal(
    detectReviewUpdateRange(review("old", ["old"]), review("new", ["new"]))?.commitCount,
    1
  );
});

test("mergeReviewUpdateRanges keeps the full unreviewed push range", () => {
  assert.deepEqual(
    mergeReviewUpdateRanges(
      {
        projectId: "101",
        mergeRequestIid: 42,
        fromSha: "commit-1",
        toSha: "commit-2",
        commitCount: 1,
        changedPaths: ["src/a.ts"]
      },
      {
        projectId: "101",
        mergeRequestIid: 42,
        fromSha: "commit-2",
        toSha: "commit-4",
        commitCount: 2
      }
    ),
    {
      projectId: "101",
      mergeRequestIid: 42,
      fromSha: "commit-1",
      toSha: "commit-4",
      commitCount: 3,
      changedPaths: undefined
    }
  );
});
