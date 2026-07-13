import assert from "node:assert/strict";
import test from "node:test";
import {
  inferLanguage,
  mapGitLabCommitDiffs,
  mapGitLabCommits,
  mapGitLabDiscussions,
  mapGitLabMyWorkMergeRequests,
  mapGitLabMyWorkTodos,
  mapGitLabReviewDiffs,
  mapGitLabTodos
} from "../gitlabMappers";

test("mapGitLabReviewDiffs keeps lightweight patch metadata and counts", () => {
  const [file] = mapGitLabReviewDiffs([{
    old_path: "src/old.ts",
    new_path: "src/new.ts",
    diff: "@@ -1 +1,2 @@\n-old\n+new\n+extra",
    renamed_file: true,
    collapsed: true,
    generated_file: true
  }]);

  assert.equal(file.path, "src/new.ts");
  assert.equal(file.additions, 2);
  assert.equal(file.deletions, 1);
  assert.equal(file.renamedFile, true);
  assert.equal(file.collapsed, true);
  assert.equal(file.generatedFile, true);
  assert.equal("oldText" in file, false);
  assert.equal("mrText" in file, false);
});

test("mapGitLabDiscussions retains file positions and resolved status", () => {
  const threads = mapGitLabDiscussions([
    {
      id: "discussion-1",
      resolvable: true,
      resolved: false,
      notes: [
        {
          id: 10,
          body: "Please adjust this summary.",
          author: { id: 7, username: "reviewer", avatar_url: "https://gitlab.example.com/uploads/reviewer.png" },
          created_at: "2026-07-10T12:00:00.000Z",
          updated_at: "2026-07-10T12:05:00.000Z",
          position: { new_path: "src/sidebar.ts", old_path: "src/sidebar.ts", new_line: 37 }
        }
      ]
    }
  ], 7);

  assert.deepEqual(threads, [
    {
      id: "discussion-1",
      filePath: "src/sidebar.ts",
      line: 37,
      oldLine: undefined,
      newLine: 37,
      resolved: false,
      resolvable: true,
      comments: [
        {
          id: "10",
          author: "reviewer",
          authorId: "7",
          avatarUrl: "https://gitlab.example.com/uploads/reviewer.png",
          body: "Please adjust this summary.",
          createdAt: "2026-07-10T12:00:00.000Z",
          updatedAt: "2026-07-10T12:05:00.000Z",
          canEdit: true
        }
      ]
    }
  ]);
});

test("mapGitLabDiscussions marks only the current user's notes editable", () => {
  const [thread] = mapGitLabDiscussions([
    {
      id: "ownership",
      notes: [
        { id: 1, body: "mine", author: { id: 12, username: "me" } },
        { id: 2, body: "theirs", author: { id: 13, username: "them" } }
      ]
    }
  ], "12");

  assert.equal(thread.comments[0].canEdit, true);
  assert.equal(thread.comments[0].authorId, "12");
  assert.equal(thread.comments[1].canEdit, false);
  assert.equal(thread.comments[1].authorId, "13");
  assert.equal(mapGitLabDiscussions([{ id: "no-user", notes: [{ id: 3, body: "unknown", author: { id: 12 } }] }])[0].comments[0].canEdit, false);
});

test("mapGitLabDiscussions keeps overview notes without a false file anchor", () => {
  const [thread] = mapGitLabDiscussions([
    {
      id: "overview-note",
      resolvable: false,
      notes: [{ id: 20, body: "General note", author: { name: "Maintainer" } }]
    }
  ]);

  assert.equal(thread.filePath, undefined);
  assert.equal(thread.line, undefined);
  assert.equal(thread.resolvable, false);
});

test("mapGitLabDiscussions retains file-level discussions without inventing a line", () => {
  const [thread] = mapGitLabDiscussions([
    {
      id: "file-discussion",
      resolvable: true,
      notes: [
        {
          id: 30,
          body: "This whole file needs a follow-up.",
          position: { new_path: "src/reviewStore.ts", old_path: "src/reviewStore.ts" }
        }
      ]
    }
  ]);

  assert.equal(thread.filePath, "src/reviewStore.ts");
  assert.equal(thread.line, undefined);
  assert.equal(thread.resolvable, true);
});

test("mapGitLabTodos maps merge request notifications", () => {
  const notifications = mapGitLabTodos([
    {
      id: 98,
      project: { id: 2 },
      author: { username: "reviewer", name: "Reviewer" },
      action_name: "assigned",
      target_type: "MergeRequest",
      target: {
        iid: 7,
        project_id: 2,
        title: "Improve the review workspace",
        state: "opened"
      },
      target_url: "https://gitlab.example.com/group/project/-/merge_requests/7",
      created_at: "2026-07-11T08:00:00.000Z"
    }
  ]);

  assert.deepEqual(notifications, [
    {
      id: "98",
      projectId: "2",
      mergeRequestIid: 7,
      title: "Improve the review workspace",
      state: "opened",
      actionName: "assigned",
      author: "reviewer",
      createdAt: "2026-07-11T08:00:00.000Z",
      webUrl: "https://gitlab.example.com/group/project/-/merge_requests/7"
    }
  ]);
});

test("mapGitLabTodos ignores non-merge-request and incomplete targets", () => {
  const notifications = mapGitLabTodos([
    {
      id: 1,
      project: { id: 2 },
      target_type: "Issue",
      target: { iid: 8, project_id: 2, title: "Issue", state: "opened" }
    },
    {
      id: 2,
      target_type: "MergeRequest",
      target: { title: "Missing route details", state: "opened" }
    }
  ]);

  assert.deepEqual(notifications, []);
});

test("mapGitLabMyWorkMergeRequests creates the UI-facing source item", () => {
  const [item] = mapGitLabMyWorkMergeRequests([{
    project_id: 4,
    iid: 12,
    title: "Review this",
    state: "opened",
    source_branch: "feature/work",
    target_branch: "main",
    author: { username: "author" },
    reviewers: [
      { id: 8, username: "reviewer-one", name: "Reviewer One", avatar_url: "https://gitlab.example.com/avatars/one.png" },
      { id: 9, username: "reviewer-two", name: "Reviewer Two" }
    ],
    web_url: "https://gitlab.example.com/group/project/-/merge_requests/12",
    updated_at: "2026-07-11T00:00:00Z",
    draft: true
  }], "reviews_for_me");
  assert.deepEqual(item, {
    projectId: "4",
    projectPath: "group/project",
    iid: 12,
    title: "Review this",
    state: "opened",
    sourceBranch: "feature/work",
    targetBranch: "main",
    author: "author",
    reviewers: [
      { id: "8", username: "reviewer-one", name: "Reviewer One", avatarUrl: "https://gitlab.example.com/avatars/one.png" },
      { id: "9", username: "reviewer-two", name: "Reviewer Two" }
    ],
    webUrl: "https://gitlab.example.com/group/project/-/merge_requests/12",
    updatedAt: "2026-07-11T00:00:00Z",
    draft: true,
    roles: ["reviewer"],
    attentionReasons: [],
    hasPendingTodo: false
  });
});

test("mapGitLabMyWorkTodos maps attention reasons, roles, and target metadata", () => {
  const [item] = mapGitLabMyWorkTodos([{
    id: 10,
    project: { id: 4, path_with_namespace: "group/project" },
    action_name: "directly_addressed",
    target_type: "MergeRequest",
    target: {
      iid: 12,
      project_id: 4,
      title: "Please review",
      state: "opened",
      source_branch: "feature/work",
      target_branch: "main",
      updated_at: "2026-07-11T00:00:00Z",
      author: { username: "author" }
    }
  }]);
  assert.equal(item.projectPath, "group/project");
  assert.equal(item.sourceBranch, "feature/work");
  assert.equal(item.targetBranch, "main");
  assert.equal(item.author, "author");
  assert.deepEqual(item.roles, []);
  assert.deepEqual(item.attentionReasons, ["mentioned"]);
  assert.equal(item.hasPendingTodo, true);

  const [assigned] = mapGitLabMyWorkTodos([{
    id: 11,
    action_name: "assigned",
    target_type: "MergeRequest",
    target: { iid: 13, project_id: 4, title: "Assigned", state: "opened" }
  }]);
  assert.deepEqual(assigned.roles, ["assignee"]);
  assert.deepEqual(assigned.attentionReasons, ["assigned"]);

  const [conflict] = mapGitLabMyWorkTodos([{
    id: 12,
    action_name: "unmergeable",
    target_type: "MergeRequest",
    target: { iid: 14, project_id: 4, title: "Conflict", state: "opened" }
  }]);
  assert.deepEqual(conflict.attentionReasons, ["conflict"]);
});

test("inferLanguage maps common review file types", () => {
  assert.equal(inferLanguage("src/component.tsx"), "typescriptreact");
  assert.equal(inferLanguage("docs/review.md"), "markdown");
  assert.equal(inferLanguage("NOTICE"), "plaintext");
});

test("mapGitLabCommits sorts valid dates oldest-first and keeps invalid dates stable", () => {
  const commits = mapGitLabCommits([
    { id: "new", short_id: "new", title: "New", author_name: "B", committed_date: "2026-02-01T00:00:00Z" },
    { id: "invalid-a", short_id: "ia", title: "Invalid A", committed_date: "not-a-date" },
    { id: "old", short_id: "old", title: "Old", author_name: "A", authored_date: "2026-01-01T00:00:00Z" },
    { id: "invalid-b", short_id: "ib", title: "Invalid B", committed_date: "also-invalid" }
  ]);

  assert.deepEqual(commits.map(({ id }) => id), ["old", "new", "invalid-a", "invalid-b"]);
  assert.equal(commits[0].committedAt, "2026-01-01T00:00:00Z");
});

test("mapGitLabCommits supplies stable fallbacks for missing fields", () => {
  const [commit] = mapGitLabCommits([{ message: "Fallback title\n\nDetails" }]);
  assert.equal(commit.id, "commit-1");
  assert.equal(commit.shortId, "commit-1");
  assert.equal(commit.title, "Fallback title");
  assert.equal(commit.authorName, "GitLab user");
  assert.equal(commit.authoredAt, new Date(0).toISOString());
  assert.equal(commit.committedAt, new Date(0).toISOString());
});

test("mapGitLabCommitDiffs maps canonical paths, statuses, and optional flags", () => {
  const files = mapGitLabCommitDiffs([
    { old_path: "old.ts", new_path: "new.ts", diff: "+new", renamed_file: true, collapsed: true },
    { old_path: "deleted.ts", new_path: "deleted.ts", deleted_file: true, too_large: true },
    { old_path: "created.ts", new_path: "created.ts", new_file: true },
    {}
  ]);

  assert.deepEqual(files.map(({ path, status }) => ({ path, status })), [
    { path: "new.ts", status: "renamed" },
    { path: "deleted.ts", status: "deleted" },
    { path: "created.ts", status: "new" },
    { path: "(unknown path)", status: "modified" }
  ]);
  assert.equal(files[0].collapsed, true);
  assert.equal(files[1].tooLarge, true);
  assert.equal(files[2].collapsed, false);
  assert.equal(files[3].diff, "");
});
