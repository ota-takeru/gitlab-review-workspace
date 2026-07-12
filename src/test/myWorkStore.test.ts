import assert from "node:assert/strict";
import test from "node:test";
import { applyMyWorkSourceResults, type MyWorkSourceCache } from "../myWorkService";
import type { MyWorkSourceItem } from "../myWorkTypes";

const item: MyWorkSourceItem = {
  projectId: "1", projectPath: "group/project", iid: 1, title: "Cached", state: "opened",
  sourceBranch: "feature", targetBranch: "main", author: "me", draft: false,
  roles: [], attentionReasons: ["todo"], hasPendingTodo: true
};

test("applyMyWorkSourceResults preserves a failed source cache while updating successful sources", () => {
  const cache: MyWorkSourceCache = {
    todo: [item],
    assigned_to_me: [],
    reviews_for_me: [],
    created_by_me: []
  };
  const result = applyMyWorkSourceResults(cache, [
    { source: "todo", result: { ok: false } },
    { source: "assigned_to_me", result: { ok: true, value: [{ ...item, iid: 2, roles: ["assignee"], attentionReasons: [] }] } }
  ]);
  assert.deepEqual(cache.todo, [item]);
  assert.equal(cache.assigned_to_me[0]?.iid, 2);
  assert.deepEqual(result.failures, ["todo"]);
  assert.deepEqual(result.updatedSources, ["assigned_to_me"]);
});
