import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRelativeReplyTime,
  isCommitDiffForSelection,
  normalizeCommitFilter,
  reconcileThreadCollapsed,
  threadCollapseKey,
  threadContentId
} from "../webviewViewModels";

test("formatRelativeReplyTime produces compact GitLab-style relative labels", () => {
  const now = Date.parse("2026-07-11T12:00:00Z");
  assert.equal(formatRelativeReplyTime("2026-07-11T11:59:45Z", now), "just now");
  assert.equal(formatRelativeReplyTime("2026-07-11T11:42:00Z", now), "18m ago");
  assert.equal(formatRelativeReplyTime("2026-07-11T08:00:00Z", now), "4h ago");
  assert.equal(formatRelativeReplyTime("2026-07-08T12:00:00Z", now), "3d ago");
});

test("normalizeCommitFilter preserves a valid selection for the same MR", () => {
  const selection = { mrKey: "1!2", commitId: "abc" };
  assert.equal(normalizeCommitFilter("1!2", ["abc", "def"], selection), selection);
});

test("normalizeCommitFilter falls back to All for another MR or missing commit", () => {
  assert.deepEqual(normalizeCommitFilter("1!2", ["abc"], { mrKey: "9!9", commitId: "abc" }), { mrKey: "1!2", commitId: "all" });
  assert.deepEqual(normalizeCommitFilter("1!2", ["abc"], { mrKey: "1!2", commitId: "gone" }), { mrKey: "1!2", commitId: "all" });
});

test("thread collapse keys are unambiguous and scoped", () => {
  assert.notEqual(threadCollapseKey("1!23", "4"), threadCollapseKey("1!2", "34"));
  assert.notEqual(threadCollapseKey("project!1", "discussion"), threadCollapseKey("project!2", "discussion"));
  assert.match(threadContentId("review-file", "src/a file.ts", "gid://thread/1"), /^review-file-thread-/);
});

test("resolved threads start collapsed while open threads start expanded", () => {
  assert.equal(reconcileThreadCollapsed(true, {}), true);
  assert.equal(reconcileThreadCollapsed(false, {}), false);
});

test("manual collapse choice persists until resolved state changes", () => {
  assert.equal(reconcileThreadCollapsed(false, { collapsed: true, previousResolved: false }), true);
  assert.equal(reconcileThreadCollapsed(true, { collapsed: false, previousResolved: true }), false);
  assert.equal(reconcileThreadCollapsed(true, { collapsed: false, previousResolved: false }), true);
  assert.equal(reconcileThreadCollapsed(false, { collapsed: true, previousResolved: true }), false);
});

test("isCommitDiffForSelection requires visible matching MR and commit state", () => {
  assert.equal(isCommitDiffForSelection({ phase: "loading", mrKey: "1!2", commitId: "abc", files: [] }, "1!2", "abc"), true);
  assert.equal(isCommitDiffForSelection({ phase: "hidden", files: [] }, "1!2", "abc"), false);
  assert.equal(isCommitDiffForSelection({ phase: "ready", mrKey: "1!3", commitId: "abc", files: [] }, "1!2", "abc"), false);
});
