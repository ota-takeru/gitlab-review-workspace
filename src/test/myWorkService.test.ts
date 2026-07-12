import assert from "node:assert/strict";
import test from "node:test";
import { bucketMyWorkItems, comparisonHasChanges, dedupeMyWorkItems, selectCandidateBranches } from "../myWorkService";
import type { MyWorkMergeRequestCandidate, MyWorkSourceItem } from "../myWorkTypes";

function item(overrides: Partial<MyWorkSourceItem> = {}): MyWorkSourceItem {
  return {
    projectId: "9",
    projectPath: "group/project",
    iid: 4,
    title: "My MR",
    state: "opened",
    sourceBranch: "feature",
    targetBranch: "main",
    author: "me",
    draft: false,
    roles: ["author"],
    attentionReasons: [],
    hasPendingTodo: false,
    ...overrides
  };
}

test("dedupeMyWorkItems unions roles and attention reasons with attention precedence", () => {
  const [result] = dedupeMyWorkItems([
    item({ roles: ["author"], attentionReasons: [] }),
    item({ roles: ["reviewer"], attentionReasons: ["review-requested"] }),
    item({ roles: [], attentionReasons: ["todo", "mentioned"], hasPendingTodo: true })
  ]);

  assert.equal(result.kind, "merge-request");
  assert.equal(result.bucket, "attention");
  assert.deepEqual(result.roles, ["author", "reviewer"]);
  assert.deepEqual(result.attentionReasons, ["review-requested", "todo", "mentioned"]);
});

test("dedupeMyWorkItems classifies assigned work as active and authored work as waiting", () => {
  const results = dedupeMyWorkItems([
    item({ iid: 1, roles: ["assignee"] }),
    item({ iid: 2, roles: ["author"] })
  ]);
  assert.deepEqual(results.map((result) => [result.iid, result.bucket]), [[1, "active"], [2, "waiting"]]);
});

test("review requests are active without a todo, and authored drafts are active", () => {
  const results = dedupeMyWorkItems([
    item({ iid: 1, roles: ["reviewer"] }),
    item({ iid: 2, roles: ["author"], draft: true })
  ]);
  assert.deepEqual(results.map((result) => [result.iid, result.bucket]), [[1, "active"], [2, "active"]]);
});

test("attention reasons without a pending todo remain active", () => {
  const [result] = dedupeMyWorkItems([
    item({ roles: ["reviewer"], attentionReasons: ["review-requested"], hasPendingTodo: false })
  ]);
  assert.equal(result.bucket, "active");
});

test("selectCandidateBranches excludes default, stale, and already-open branches before limiting", () => {
  const now = new Date("2026-07-11T00:00:00Z");
  const branches = [
    { name: "main", updatedAt: "2026-07-10T00:00:00Z" },
    { name: "stale", updatedAt: "2026-06-01T00:00:00Z" },
    { name: "open", updatedAt: "2026-07-10T00:00:00Z" },
    { name: "candidate", updatedAt: "2026-07-09T00:00:00Z" }
  ];
  const selected = selectCandidateBranches(
    branches,
    "main",
    [{ sourceProjectId: "12", sourceBranch: "open", targetProjectId: "99" }],
    "12",
    "99",
    now
  );
  assert.deepEqual(selected.map((branch) => branch.name), ["candidate"]);
});

test("comparisonHasChanges accepts either commits or diffs", () => {
  assert.equal(comparisonHasChanges({}), false);
  assert.equal(comparisonHasChanges({ commits: [{}] }), true);
  assert.equal(comparisonHasChanges({ diffs: [{}] }), true);
});

test("bucketMyWorkItems sorts merge requests and candidates together by update time", () => {
  const [mergeRequest] = dedupeMyWorkItems([item({ updatedAt: "2026-07-10T10:00:00Z", roles: ["assignee"] })]);
  const candidate: MyWorkMergeRequestCandidate = {
    kind: "mr-candidate",
    key: "candidate",
    sourceProjectId: "12",
    sourceProjectPath: "user/project",
    targetProjectId: "99",
    targetProjectPath: "upstream/project",
    sourceBranch: "feature/newer",
    targetBranch: "main",
    commitCount: 2,
    updatedAt: "2026-07-11T10:00:00Z",
    bucket: "active"
  };

  assert.deepEqual(bucketMyWorkItems([mergeRequest], [candidate]).active.map((entry) => entry.key), ["candidate", mergeRequest.key]);
});
