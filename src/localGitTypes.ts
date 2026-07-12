export type LocalRemoteMatch = "matched" | "mismatched" | "unknown";

export interface LocalDirtyState {
  total: number;
  modified: number;
  untracked: number;
}

export interface GitWorktreeInfo {
  path: string;
  branch?: string;
  isCurrent: boolean;
  locked?: boolean;
}

export type LocalBranchTarget =
  | { kind: "current-workspace"; branch: string }
  | { kind: "existing-worktree"; branch: string; path: string }
  | { kind: "local-branch"; branch: string }
  | { kind: "remote-only"; remoteRef: string }
  | { kind: "missing" }
  | { kind: "different-repository" }
  | { kind: "unknown" };

export interface LocalWorkspaceState {
  phase: "loading" | "ready" | "unavailable" | "error";
  repositoryRoot?: string;
  remoteMatch: LocalRemoteMatch;
  remoteUrl?: string;
  currentBranch?: string;
  detached: boolean;
  dirty: LocalDirtyState;
  worktrees: GitWorktreeInfo[];
  target: LocalBranchTarget;
  errorMessage?: string;
  updatedAt?: string;
}

export interface MergeRequestWorkspaceAssociation {
  projectId: string;
  mergeRequestIid: number;
  sourceBranch: string;
  repositoryRoot?: string;
  worktreePath?: string;
  lastOpenedAt?: string;
}

export const emptyLocalWorkspaceState: LocalWorkspaceState = {
  phase: "loading",
  remoteMatch: "unknown",
  detached: false,
  dirty: { total: 0, modified: 0, untracked: 0 },
  worktrees: [],
  target: { kind: "unknown" }
};
