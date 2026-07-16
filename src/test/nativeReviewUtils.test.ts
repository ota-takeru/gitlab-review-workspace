import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCommentMarkdown,
  nativeThreadLocation,
  normalizeTextForComparison,
  oldLineForMrLine,
  privateCommentImagePaths
} from "../nativeReviewUtils";

test("nativeThreadLocation prefers the MR head and falls back to the base", () => {
  assert.deepEqual(nativeThreadLocation({ line: 8, oldLine: 7, newLine: 8 }), { side: "head", line: 8 });
  assert.deepEqual(nativeThreadLocation({ oldLine: 7 }), { side: "base", line: 7 });
  assert.deepEqual(nativeThreadLocation({ line: 3 }), { side: "head", line: 3 });
  assert.equal(nativeThreadLocation({}), undefined);
});

test("oldLineForMrLine finds the GitLab old line mapping", () => {
  assert.equal(oldLineForMrLine([
    { id: "a", kind: "context", text: "a", oldLine: 4, mrLine: 5, threadIds: [] },
    { id: "b", kind: "mr-added", text: "b", mrLine: 6, threadIds: [] }
  ], 5), 4);
  assert.equal(oldLineForMrLine([], 5), undefined);
});

test("appendCommentMarkdown separates existing text from an uploaded image", () => {
  assert.equal(appendCommentMarkdown("Looks good", "![image](/uploads/a.png)"), "Looks good\n\n![image](/uploads/a.png)");
  assert.equal(appendCommentMarkdown("", "![image](/uploads/a.png)"), "![image](/uploads/a.png)");
});

test("normalizeTextForComparison ignores local line ending differences", () => {
  assert.equal(normalizeTextForComparison("a\r\nb\r"), "a\nb\n");
});

test("privateCommentImagePaths finds and deduplicates GitLab upload images", () => {
  assert.deepEqual(privateCommentImagePaths([
    "![one](/uploads/abc/one.png)",
    "![duplicate](/uploads/abc/one.png)",
    "![absolute](https://gitlab.example.com/group/project/uploads/def/two.jpg)",
    "![public](https://example.com/public.png)"
  ].join("\n")), [
    "/uploads/abc/one.png",
    "https://gitlab.example.com/group/project/uploads/def/two.jpg"
  ]);
});
