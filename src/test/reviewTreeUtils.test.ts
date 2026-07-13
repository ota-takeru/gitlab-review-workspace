import assert from "node:assert/strict";
import test from "node:test";
import { FileSummary, ReviewThread } from "../reviewTypes";
import { buildChangedFileTree, reviewThreadAuthors, sortReviewThreads } from "../reviewTreeUtils";

function thread(id: string, resolved: boolean, createdAt: string): ReviewThread {
  return {
    id,
    resolved,
    comments: [{ id: `${id}-comment`, author: "user", body: id, createdAt }]
  };
}

test("sortReviewThreads supports open-first, oldest, and newest", () => {
  const threads = [
    thread("resolved-old", true, "2024-01-01T00:00:00Z"),
    thread("open-new", false, "2024-03-01T00:00:00Z"),
    thread("open-old", false, "2024-02-01T00:00:00Z")
  ];

  assert.deepEqual(sortReviewThreads(threads, "open-first").map(({ id }) => id), [
    "open-old",
    "open-new",
    "resolved-old"
  ]);
  assert.deepEqual(sortReviewThreads(threads, "oldest").map(({ id }) => id), [
    "resolved-old",
    "open-old",
    "open-new"
  ]);
  assert.deepEqual(sortReviewThreads(threads, "newest").map(({ id }) => id), [
    "open-new",
    "open-old",
    "resolved-old"
  ]);
});

test("reviewThreadAuthors keeps each reply author and fills a missing avatar", () => {
  const comments = [
    { id: "1", author: "Reviewer One", authorId: "10", avatarUrl: undefined, body: "", createdAt: "" },
    { id: "2", author: "Reviewer Two", authorId: "11", avatarUrl: "two.png", body: "", createdAt: "" },
    { id: "3", author: "Reviewer One", authorId: "10", avatarUrl: "one.png", body: "", createdAt: "" }
  ];
  assert.deepEqual(reviewThreadAuthors({ comments }), [
    { id: "10", name: "Reviewer One", avatarUrl: "one.png" },
    { id: "11", name: "Reviewer Two", avatarUrl: "two.png" }
  ]);
});

test("buildChangedFileTree creates sorted directories and preserves file summaries", () => {
  const files: FileSummary[] = [
    summary("src/z.ts", 2),
    summary("README.md", 0),
    summary("src/components/a.ts", 4),
    summary("src/a.ts", 1)
  ];

  const tree = buildChangedFileTree(files);
  assert.equal(tree[0].path, "src");
  assert.equal(tree[1].path, "README.md");
  assert.equal(tree[0].children[0].path, "src/components");
  assert.equal(tree[0].children[1].path, "src/a.ts");
  assert.equal(tree[0].children[2].path, "src/z.ts");
  assert.equal(tree[0].children[0].children[0].file?.threadCount, 4);
});

function summary(path: string, threadCount: number): FileSummary {
  return {
    path,
    language: "typescript",
    additions: 1,
    deletions: 1,
    threadCount,
    unresolvedThreadCount: threadCount,
    resolvedThreadCount: 0,
    hasLocalEdit: false
  };
}
