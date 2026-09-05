import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInstanceUrl, sameReviewContext, type ReviewContext } from "../reviewContext";

test("instance identity normalizes equivalent URLs and retains port and subpath", () => {
  assert.equal(normalizeInstanceUrl(" HTTPS://GITLAB.EXAMPLE.COM:443/gitlab/ "), "https://gitlab.example.com/gitlab");
  assert.equal(normalizeInstanceUrl("gitlab.example.com:8443/gitlab"), "https://gitlab.example.com:8443/gitlab");
  for (const input of ["", "file:///tmp", "https://user:pass@example.com", "https://example.com/?x=1", "https://example.com/#a"]) {
    assert.throws(() => normalizeInstanceUrl(input));
  }
});

test("rendered context requires matching instance, MR, revision and author identity", () => {
  const context: ReviewContext = { instanceUrl: "https://a.example", projectId: "1", mergeRequestIid: 2,
    baseSha: "base", startSha: "start", headSha: "head", currentUserId: "user" };
  assert.equal(sameReviewContext(context, { ...context }), true);
  assert.equal(sameReviewContext(undefined, undefined), false);
  for (const change of [{ instanceUrl: "https://b.example" }, { projectId: "2" }, { mergeRequestIid: 3 },
    { baseSha: "other" }, { startSha: "other" }, { headSha: "other" }, { currentUserId: "other" }]) {
    assert.equal(sameReviewContext(context, { ...context, ...change }), false);
  }
});
