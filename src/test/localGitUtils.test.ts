import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditReviewLocally,
  classifyTargetBranch,
  matchGitLabProject,
  normalizeGitLabRemoteUrl,
  parseGitBranchRefs,
  parseGitRemotes,
  parseGitStatusPorcelain,
  parseGitWorktreeList,
  toLocalDirtyState
} from "../localGitUtils";
import type { LocalWorkspaceState } from "../localGitTypes";
import { LocalGitInspection } from "../localGitUtils";

test("parseGitStatusPorcelain counts tracked and untracked changes", () => {
  const summary = parseGitStatusPorcelain([
    " M src/changed.ts",
    "A  src/added.ts",
    " D src/deleted.ts",
    "R  src/old.ts -> src/new.ts",
    "?? notes.txt"
  ].join("\n"));

  assert.equal(summary.total, 5);
  assert.equal(summary.modified, 1);
  assert.equal(summary.added, 1);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.untracked, 1);
  assert.equal(summary.entries[3]?.originalPath, "src/old.ts");
  assert.equal(summary.entries[3]?.path, "src/new.ts");
  assert.deepEqual(toLocalDirtyState(summary), { total: 5, modified: 3, untracked: 1 });
});

test("normalizeGitLabRemoteUrl handles SSH, scp-like, HTTPS, and encoded paths", () => {
  assert.deepEqual(normalizeGitLabRemoteUrl("git@gitlab.example.com:group/subgroup/project.git"), {
    hostname: "gitlab.example.com",
    projectPath: "group/subgroup/project",
    canonicalUrl: "https://gitlab.example.com/group/subgroup/project"
  });
  assert.deepEqual(normalizeGitLabRemoteUrl("ssh://git@gitlab.example.com/group/project.git/"), {
    hostname: "gitlab.example.com",
    projectPath: "group/project",
    canonicalUrl: "https://gitlab.example.com/group/project"
  });
  assert.deepEqual(normalizeGitLabRemoteUrl("https://gitlab.example.com/group%2Fproject.git"), {
    hostname: "gitlab.example.com",
    projectPath: "group/project",
    canonicalUrl: "https://gitlab.example.com/group/project"
  });
});

test("matchGitLabProject compares project paths and optional hosts", () => {
  const remotes = parseGitRemotes([
    "origin git@gitlab.example.com:group/project.git (fetch)",
    "origin git@gitlab.example.com:group/project.git (push)",
    "upstream https://gitlab.example.com/other/project.git (fetch)"
  ].join("\n"));

  assert.equal(matchGitLabProject("group/project", remotes), "matched");
  assert.equal(matchGitLabProject("gitlab.example.com/group/project", remotes), "matched");
  assert.equal(matchGitLabProject("group/missing", remotes), "mismatched");
  assert.equal(matchGitLabProject("12345", remotes), "unknown");
  assert.equal(matchGitLabProject(undefined, remotes), "unknown");
});

test("parseGitBranchRefs separates local and remote branches", () => {
  const parsed = parseGitBranchRefs([
    "refs/heads/main",
    "refs/heads/feature/review-ui",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
    "refs/remotes/origin/feature/review-ui"
  ].join("\n"));

  assert.deepEqual(parsed.localBranches, ["main", "feature/review-ui"]);
  assert.deepEqual(parsed.remoteBranches, [
    { remote: "origin", branch: "main", ref: "refs/remotes/origin/main" },
    { remote: "origin", branch: "feature/review-ui", ref: "refs/remotes/origin/feature/review-ui" }
  ]);
});

test("parseGitWorktreeList identifies the current and locked worktrees", () => {
  const worktrees = parseGitWorktreeList([
    "worktree C:/repo",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree C:/worktrees/review-ui",
    "HEAD def",
    "branch refs/heads/feature/review-ui",
    "locked by reviewer"
  ].join("\n"), "C:/repo");

  assert.deepEqual(worktrees, [
    { path: "C:/repo", branch: "main", isCurrent: true },
    { path: "C:/worktrees/review-ui", branch: "feature/review-ui", isCurrent: false, locked: true }
  ]);
});

test("classifyTargetBranch distinguishes workspace, worktree, local, remote, missing, and repository mismatch", () => {
  const base: LocalGitInspection = {
    repositoryRoot: "C:/repo",
    remoteMatch: "matched",
    remotes: [{ name: "origin", url: "git@gitlab.example.com:group/project.git", direction: "fetch" }],
    remoteUrl: "git@gitlab.example.com:group/project.git",
    currentBranch: "main",
    detached: false,
    dirty: { total: 0, modified: 0, untracked: 0 },
    worktrees: [
      { path: "C:/repo", branch: "main", isCurrent: true },
      { path: "C:/worktrees/other", branch: "feature/other", isCurrent: false }
    ],
    localBranches: ["main", "feature/local"],
    remoteBranches: [{ remote: "origin", branch: "feature/remote", ref: "refs/remotes/origin/feature/remote" }]
  };

  assert.deepEqual(classifyTargetBranch("main", base), { kind: "current-workspace", branch: "main" });
  assert.deepEqual(classifyTargetBranch("feature/other", base), {
    kind: "existing-worktree",
    branch: "feature/other",
    path: "C:/worktrees/other"
  });
  assert.deepEqual(classifyTargetBranch("feature/local", base), { kind: "local-branch", branch: "feature/local" });
  assert.deepEqual(classifyTargetBranch("feature/remote", base), {
    kind: "remote-only",
    remoteRef: "refs/remotes/origin/feature/remote"
  });
  assert.deepEqual(classifyTargetBranch("feature/missing", base), { kind: "missing" });
  assert.deepEqual(classifyTargetBranch("feature/local", { ...base, remoteMatch: "mismatched" }), {
    kind: "different-repository"
  });
  assert.deepEqual(classifyTargetBranch(undefined, base), { kind: "unknown" });
});

test("local review editing is allowed only for the MR branch in the current workspace", () => {
  const state: LocalWorkspaceState = {
    phase: "ready",
    remoteMatch: "matched",
    currentBranch: "feature/review",
    detached: false,
    dirty: { total: 0, modified: 0, untracked: 0 },
    worktrees: [],
    target: { kind: "current-workspace", branch: "feature/review" }
  };

  assert.equal(canEditReviewLocally(state), true);
  assert.equal(canEditReviewLocally({ ...state, target: { kind: "remote-only", remoteRef: "origin/feature/review" } }), false);
  assert.equal(canEditReviewLocally({ ...state, phase: "loading" }), false);
});
