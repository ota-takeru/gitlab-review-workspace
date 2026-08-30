import assert from "node:assert/strict";
import test from "node:test";
import { optimisticallyToggleReaction } from "../reactionUtils";

test("optimisticallyToggleReaction adds and removes the current user's reaction without mutating input", () => {
  const initial = [{
    name: "thumbsup",
    count: 2,
    users: [
      { id: "7", name: "Me" },
      { id: "8", name: "Reviewer" }
    ],
    currentUserAwardId: "10"
  }];

  const removed = optimisticallyToggleReaction(initial, "thumbsup", "7", true);
  assert.equal(initial[0].count, 2);
  assert.deepEqual(removed, [{
    name: "thumbsup",
    count: 1,
    users: [{ id: "8", name: "Reviewer" }],
    currentUserAwardId: undefined,
    pending: true
  }]);

  const added = optimisticallyToggleReaction(removed, "rocket", "7", false);
  assert.deepEqual(added[1], { name: "rocket", count: 1, users: [], pending: true });
});
