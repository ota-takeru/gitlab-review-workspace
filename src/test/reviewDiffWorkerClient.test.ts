import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewLinesAsync } from "../reviewDiffWorkerClient";

test("large full-file diffs are calculated by the worker path", { timeout: 15_000 }, async () => {
  const oldText = Array.from({ length: 15_000 }, (_, index) => `line ${index} original value`).join("\n");
  const mrText = Array.from({ length: 15_000 }, (_, index) =>
    index % 500 === 0 ? `line ${index} changed value` : `line ${index} original value`
  ).join("\n");

  const lines = await buildReviewLinesAsync(oldText, mrText, undefined, []);

  assert.equal(lines.filter((line) => line.kind === "mr-added").length, 30);
  assert.equal(lines.filter((line) => line.kind === "mr-removed").length, 30);
  assert.ok(lines.length >= 15_000);
});
