import assert from "node:assert/strict";
import test from "node:test";
import { editedTimestamp, isCommentEdited } from "../commentUtils";

test("isCommentEdited uses safe chronological date comparison", () => {
  assert.equal(isCommentEdited({ createdAt: "2026-01-01T00:00:00Z" }), false);
  assert.equal(isCommentEdited({ createdAt: "invalid", updatedAt: "2026-01-01T00:00:01Z" }), false);
  assert.equal(isCommentEdited({ createdAt: "2026-01-01T00:00:01Z", updatedAt: "2026-01-01T00:00:00Z" }), false);
  assert.equal(isCommentEdited({ createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z" }), true);
});

test("editedTimestamp guarantees a timestamp after creation", () => {
  const createdAt = "2099-01-01T00:00:00.000Z";
  assert.ok(Date.parse(editedTimestamp(createdAt, createdAt)) > Date.parse(createdAt));
});
