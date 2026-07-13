import assert from "node:assert/strict";
import test from "node:test";
import * as glabCommand from "../glabCommand";
import { GitLabReviewClient, toMergeRequestOption } from "../gitlabApi";

test("toMergeRequestOption retains the merge request state", () => {
  const option = toMergeRequestOption({
    iid: 42,
    project_id: 7,
    title: "Expose merge request state",
    state: "merged",
    source_branch: "feature/state",
    target_branch: "main",
    author: { username: "author" },
    web_url: "https://gitlab.example.com/group/project/-/merge_requests/42",
    updated_at: "2026-07-11T09:00:00.000Z"
  });

  assert.deepEqual(option, {
    projectId: "7",
    iid: 42,
    title: "Expose merge request state",
    state: "merged",
    sourceBranch: "feature/state",
    targetBranch: "main",
    author: "author",
    webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
    updatedAt: "2026-07-11T09:00:00.000Z"
  });
});

test("listPendingTodos requests pending todos and maps merge request targets", async () => {
  const originalRunGlab = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  let receivedArgs: string[] | undefined;
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async (args: string[]) => {
      receivedArgs = args;
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            id: 123,
            project: { id: 9 },
            author: { name: "Reviewer" },
            action_name: "mentioned",
            target_type: "MergeRequest",
            target: { iid: 4, project_id: 9, title: "Review me", state: "opened" },
            target_url: "https://gitlab.example.com/group/project/-/merge_requests/4",
            created_at: "2026-07-11T10:00:00.000Z"
          },
          {
            id: 124,
            target_type: "Issue",
            target: { iid: 5, project_id: 9, title: "Ignore me", state: "opened" }
          }
        ])
      };
    }
  });

  try {
    const notifications = await new GitLabReviewClient("gitlab.example.com").listPendingTodos();

    assert.deepEqual(receivedArgs, [
      "api",
      "--hostname",
      "gitlab.example.com",
      "todos?state=pending&per_page=50",
      "--output",
      "json"
    ]);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.id, "123");
    assert.equal(notifications[0]?.author, "Reviewer");
  } finally {
    if (originalRunGlab) {
      Object.defineProperty(glabCommand, "runGlab", originalRunGlab);
    }
  }
});

test("My Work endpoints use scoped, bounded, and encoded GitLab API paths", async () => {
  const originalRunGlab = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  const received: string[][] = [];
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async (args: string[]) => {
      received.push(args);
      return { ok: true, stdout: args[3]?.includes("compare") ? "{}" : "[]" };
    }
  });
  try {
    const client = new GitLabReviewClient("gitlab.example.com");
    await client.listMyWorkTodos();
    await client.listMyWorkMergeRequests("reviews_for_me");
    await client.listProjectOpenMergeRequests("upstream/group");
    await client.listProjectBranches("source/group");
    await client.compareProjectBranches("upstream/group", "main branch", "feature/a", "12/3");
    assert.deepEqual(received.map((args) => args[3]), [
      "todos?state=pending&type=MergeRequest&per_page=100",
      "merge_requests?scope=reviews_for_me&state=opened&order_by=updated_at&sort=desc&per_page=100",
      "projects/upstream%2Fgroup/merge_requests?state=opened&per_page=100",
      "projects/source%2Fgroup/repository/branches?per_page=100",
      "projects/upstream%2Fgroup/repository/compare?from=main%20branch&to=feature%2Fa&from_project_id=12%2F3"
    ]);
    assert.deepEqual(received.slice(0, 4).map((args) => args.includes("--paginate")), [true, true, true, true]);
  } finally {
    if (originalRunGlab) Object.defineProperty(glabCommand, "runGlab", originalRunGlab);
  }
});

test("updateComment sends a PUT to the discussion note endpoint", async () => {
  const originalRunGlab = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  let receivedArgs: string[] | undefined;
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async (args: string[]) => {
      receivedArgs = args;
      return {
        ok: true,
        stdout: JSON.stringify({
          id: 55,
          body: "updated body",
          author: { id: 9, username: "me" },
          created_at: "2026-07-11T10:00:00.000Z",
          updated_at: "2026-07-11T10:02:00.000Z"
        })
      };
    }
  });

  try {
    const comment = await new GitLabReviewClient("gitlab.example.com").updateComment(
      {
        id: "77!4",
        projectId: "77",
        mergeRequestIid: 4,
        title: "MR",
        state: "opened",
        sourceBranch: "source",
        targetBranch: "main",
        author: "me",
        reviewers: [],
        commits: [],
        files: [],
        threads: []
      },
      "discussion/with space",
      "55",
      "updated body"
    );

    assert.deepEqual(receivedArgs, [
      "api",
      "--hostname",
      "gitlab.example.com",
      "--method",
      "PUT",
      "projects/77/merge_requests/4/discussions/discussion%2Fwith%20space/notes/55",
      "--raw-field",
      "body=updated body",
      "--output",
      "json"
    ]);
    assert.equal(comment.body, "updated body");
    assert.equal(comment.updatedAt, "2026-07-11T10:02:00.000Z");
    assert.equal(comment.canEdit, true);
  } finally {
    if (originalRunGlab) Object.defineProperty(glabCommand, "runGlab", originalRunGlab);
  }
});

test("listMergeRequestCommits requests the paginated MR commits endpoint", async () => {
  const originalRunGlab = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  let receivedArgs: string[] | undefined;
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async (args: string[]) => {
      receivedArgs = args;
      return {
        ok: true,
        stdout: JSON.stringify([{ id: "abcdef123", short_id: "abcdef12", title: "Commit", author_name: "Author", authored_date: "2026-01-01T00:00:00Z", committed_date: "2026-01-01T00:01:00Z" }])
      };
    }
  });

  try {
    const commits = await new GitLabReviewClient("gitlab.example.com").listMergeRequestCommits("group/project", 14);
    assert.deepEqual(receivedArgs, [
      "api",
      "--hostname",
      "gitlab.example.com",
      "projects/group%2Fproject/merge_requests/14/commits?per_page=100",
      "--paginate",
      "--output",
      "json"
    ]);
    assert.equal(commits[0].shortId, "abcdef12");
  } finally {
    if (originalRunGlab) Object.defineProperty(glabCommand, "runGlab", originalRunGlab);
  }
});

test("loadCommitDiff requests the encoded paginated commit diff endpoint", async () => {
  const originalRunGlab = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  let receivedArgs: string[] | undefined;
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async (args: string[]) => {
      receivedArgs = args;
      return { ok: true, stdout: JSON.stringify([{ old_path: "a.ts", new_path: "a.ts", diff: "+line" }]) };
    }
  });

  try {
    const files = await new GitLabReviewClient("gitlab.example.com").loadCommitDiff("group/project", "sha/with space");
    assert.deepEqual(receivedArgs, [
      "api",
      "--hostname",
      "gitlab.example.com",
      "projects/group%2Fproject/repository/commits/sha%2Fwith%20space/diff?per_page=100",
      "--paginate",
      "--output",
      "json"
    ]);
    assert.equal(files[0].path, "a.ts");
  } finally {
    if (originalRunGlab) Object.defineProperty(glabCommand, "runGlab", originalRunGlab);
  }
});

test("loadCommitFileContents reads the parent and commit versions of a file", async () => {
  const originalRunGlab = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  const receivedArgs: string[][] = [];
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async (args: string[]) => {
      receivedArgs.push(args);
      const endpoint = args[3];
      if (endpoint === "projects/group%2Fproject/repository/commits/sha%2Fwith%20space") {
        return { ok: true, stdout: JSON.stringify({ parent_ids: ["parent/sha"] }) };
      }
      if (endpoint === "projects/group%2Fproject/repository/files/old.ts/raw?ref=parent%2Fsha") {
        return { ok: true, stdout: "old\n" };
      }
      if (endpoint === "projects/group%2Fproject/repository/files/new.ts/raw?ref=sha%2Fwith%20space") {
        return { ok: true, stdout: "new\n" };
      }
      return { ok: false, stdout: "" };
    }
  });

  try {
    const contents = await new GitLabReviewClient("gitlab.example.com").loadCommitFileContents(
      "group/project",
      "sha/with space",
      { oldPath: "old.ts", newPath: "new.ts", newFile: false, deletedFile: false }
    );
    assert.deepEqual(contents, { oldText: "old\n", newText: "new\n" });
    assert.deepEqual(receivedArgs.map((args) => args[3]), [
      "projects/group%2Fproject/repository/commits/sha%2Fwith%20space",
      "projects/group%2Fproject/repository/files/old.ts/raw?ref=parent%2Fsha",
      "projects/group%2Fproject/repository/files/new.ts/raw?ref=sha%2Fwith%20space"
    ]);
  } finally {
    if (originalRunGlab) Object.defineProperty(glabCommand, "runGlab", originalRunGlab);
  }
});

test("loadMergeRequest tolerates optional lookup failures and preserves fallback commits", async () => {
  const originalRunGlab = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  const receivedDiscussionArgs: string[][] = [];
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async (args: string[]) => {
      const endpoint = args[3];
      if (endpoint === "user") return { ok: false, stdout: "" };
      if (endpoint === "projects/1/merge_requests/2") {
        return {
          ok: true,
          stdout: JSON.stringify({
            iid: 2,
            project_id: 1,
            title: "Ownership fallback",
            state: "opened",
            source_branch: "feature",
            target_branch: "main",
            reviewers: [
              { id: 8, username: "reviewer-one", name: "Reviewer One" },
              { id: 9, username: "reviewer-two", name: "Reviewer Two" }
            ],
            diff_refs: { base_sha: "base", start_sha: "start", head_sha: "head" }
          })
        };
      }
      if (endpoint?.endsWith("/diffs?per_page=100")) return { ok: true, stdout: "[]" };
      if (endpoint?.endsWith("/discussions?per_page=100")) {
        receivedDiscussionArgs.push(args);
        return {
          ok: true,
          stdout: JSON.stringify([{ id: "discussion", notes: [{ id: 8, body: "mine?", author: { id: 9 } }] }])
        };
      }
      return { ok: false, stdout: "" };
    }
  });

  try {
    const fallbackCommit = {
      id: "cached",
      shortId: "cached",
      title: "Cached commit",
      authorName: "Author",
      authoredAt: "2026-01-01T00:00:00Z",
      committedAt: "2026-01-01T00:00:00Z"
    };
    const state = await new GitLabReviewClient("gitlab.example.com").loadMergeRequest(
      { projectId: "1", iid: 2 },
      [fallbackCommit]
    );
    assert.equal(state.threads[0].comments[0].canEdit, false);
    assert.deepEqual(state.commits, [fallbackCommit]);
    assert.deepEqual(state.reviewers.map((reviewer) => reviewer.username), ["reviewer-one", "reviewer-two"]);
    assert.deepEqual(receivedDiscussionArgs[0], [
      "api",
      "--hostname",
      "gitlab.example.com",
      "projects/1/merge_requests/2/discussions?per_page=100",
      "--paginate",
      "--output",
      "json"
    ]);
  } finally {
    if (originalRunGlab) Object.defineProperty(glabCommand, "runGlab", originalRunGlab);
  }
});
