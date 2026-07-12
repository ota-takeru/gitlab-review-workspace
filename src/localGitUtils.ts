import * as path from "node:path";
import {
  GitWorktreeInfo,
  LocalBranchTarget,
  LocalDirtyState,
  LocalRemoteMatch,
  LocalWorkspaceState
} from "./localGitTypes";

export interface GitStatusEntry {
  indexStatus: string;
  worktreeStatus: string;
  path: string;
  originalPath?: string;
}

export interface GitStatusSummary {
  entries: GitStatusEntry[];
  total: number;
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
}

export interface GitRemote {
  name: string;
  url: string;
  direction: "fetch" | "push";
}

export interface NormalizedGitLabRemote {
  hostname: string;
  projectPath: string;
  canonicalUrl: string;
}

export interface GitRemoteBranch {
  remote: string;
  branch: string;
  ref: string;
}

export interface ParsedBranchRefs {
  localBranches: string[];
  remoteBranches: GitRemoteBranch[];
}

export interface LocalGitInspection {
  repositoryRoot: string;
  remoteMatch: LocalRemoteMatch;
  remotes: GitRemote[];
  remoteUrl?: string;
  currentBranch?: string;
  detached: boolean;
  dirty: LocalDirtyState;
  worktrees: GitWorktreeInfo[];
  localBranches: string[];
  remoteBranches: GitRemoteBranch[];
}

export function parseGitStatusPorcelain(output: string): GitStatusSummary {
  const entries: GitStatusEntry[] = [];

  for (const line of normalizeLines(output)) {
    if (line.startsWith("##") || line.length < 3) {
      continue;
    }

    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    const rawPath = line.slice(3);
    const renameSeparator = rawPath.lastIndexOf(" -> ");
    const originalPath = renameSeparator >= 0 ? decodeGitPath(rawPath.slice(0, renameSeparator)) : undefined;
    const filePath = decodeGitPath(renameSeparator >= 0 ? rawPath.slice(renameSeparator + 4) : rawPath);

    entries.push({
      indexStatus,
      worktreeStatus,
      path: filePath,
      ...(originalPath ? { originalPath } : {})
    });
  }

  const trackedEntries = entries.filter((entry) => !(entry.indexStatus === "?" && entry.worktreeStatus === "?"));
  return {
    entries,
    total: entries.length,
    modified: trackedEntries.filter((entry) => entry.indexStatus === "M" || entry.worktreeStatus === "M").length,
    added: trackedEntries.filter((entry) => entry.indexStatus === "A" || entry.worktreeStatus === "A").length,
    deleted: trackedEntries.filter((entry) => entry.indexStatus === "D" || entry.worktreeStatus === "D").length,
    untracked: entries.filter((entry) => entry.indexStatus === "?" && entry.worktreeStatus === "?").length
  };
}

export function toLocalDirtyState(summary: GitStatusSummary): LocalDirtyState {
  return {
    total: summary.total,
    modified: summary.modified + summary.added + summary.deleted,
    untracked: summary.untracked
  };
}

export function parseGitRemotes(output: string): GitRemote[] {
  const remotes: GitRemote[] = [];

  for (const line of normalizeLines(output)) {
    const match = /^(\S+)\s+(.+)\s+\((fetch|push)\)$/.exec(line);
    if (!match) {
      continue;
    }

    remotes.push({
      name: match[1]!,
      url: match[2]!,
      direction: match[3] as "fetch" | "push"
    });
  }

  return remotes;
}

export function normalizeGitLabRemoteUrl(value: string): NormalizedGitLabRemote | undefined {
  const raw = value.trim();
  if (!raw) {
    return undefined;
  }

  let hostname: string | undefined;
  let projectPath: string | undefined;

  const scpLike = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw);
  if (scpLike && !raw.includes("://")) {
    hostname = scpLike[1];
    projectPath = scpLike[2];
  } else {
    try {
      const parsed = new URL(raw);
      hostname = parsed.hostname;
      projectPath = parsed.pathname;
    } catch {
      return undefined;
    }
  }

  const normalizedPath = normalizeProjectPath(projectPath);
  if (!hostname || !normalizedPath) {
    return undefined;
  }

  const normalizedHostname = hostname.toLowerCase();
  return {
    hostname: normalizedHostname,
    projectPath: normalizedPath,
    canonicalUrl: `https://${normalizedHostname}/${normalizedPath}`
  };
}

export function matchGitLabProject(projectId: string | undefined, remotes: GitRemote[]): LocalRemoteMatch {
  if (!projectId) {
    return "unknown";
  }

  const identity = normalizeGitLabProjectIdentifier(projectId);
  if (!identity) {
    return "unknown";
  }

  const normalizedRemotes = remotes
    .filter((remote) => remote.direction === "fetch")
    .map((remote) => normalizeGitLabRemoteUrl(remote.url))
    .filter((remote): remote is NormalizedGitLabRemote => Boolean(remote));

  if (normalizedRemotes.length === 0) {
    return "unknown";
  }

  return normalizedRemotes.some((remote) =>
    remote.projectPath === identity.projectPath && (!identity.hostname || remote.hostname === identity.hostname)
  )
    ? "matched"
    : "mismatched";
}

export function parseGitBranchRefs(output: string): ParsedBranchRefs {
  const localBranches: string[] = [];
  const remoteBranches: GitRemoteBranch[] = [];

  for (const line of normalizeLines(output)) {
    if (line.startsWith("refs/heads/")) {
      localBranches.push(line.slice("refs/heads/".length));
      continue;
    }

    if (!line.startsWith("refs/remotes/")) {
      continue;
    }

    const shortRef = line.slice("refs/remotes/".length);
    const separator = shortRef.indexOf("/");
    if (separator <= 0 || shortRef.endsWith("/HEAD")) {
      continue;
    }

    remoteBranches.push({
      remote: shortRef.slice(0, separator),
      branch: shortRef.slice(separator + 1),
      ref: line
    });
  }

  return { localBranches, remoteBranches };
}

export function parseGitWorktreeList(output: string, currentRepositoryRoot: string): GitWorktreeInfo[] {
  return output
    .split(/\r?\n\r?\n/)
    .map((block): GitWorktreeInfo | undefined => {
      let worktreePath: string | undefined;
      let branch: string | undefined;
      let locked = false;

      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("worktree ")) {
          worktreePath = line.slice("worktree ".length);
        } else if (line.startsWith("branch refs/heads/")) {
          branch = line.slice("branch refs/heads/".length);
        } else if (line === "locked" || line.startsWith("locked ")) {
          locked = true;
        }
      }

      if (!worktreePath) {
        return undefined;
      }

      return {
        path: worktreePath,
        ...(branch ? { branch } : {}),
        isCurrent: samePath(worktreePath, currentRepositoryRoot),
        ...(locked ? { locked: true } : {})
      };
    })
    .filter((worktree): worktree is GitWorktreeInfo => Boolean(worktree));
}

export function classifyTargetBranch(
  targetBranch: string | undefined,
  inspection: LocalGitInspection
): LocalBranchTarget {
  if (!targetBranch || !inspection.repositoryRoot) {
    return { kind: "unknown" };
  }

  if (inspection.remoteMatch === "mismatched") {
    return { kind: "different-repository" };
  }

  const currentWorktree = inspection.worktrees.find((worktree) => worktree.isCurrent);
  if (inspection.currentBranch === targetBranch || currentWorktree?.branch === targetBranch) {
    return { kind: "current-workspace", branch: targetBranch };
  }

  const existingWorktree = inspection.worktrees.find(
    (worktree) => !worktree.isCurrent && worktree.branch === targetBranch
  );
  if (existingWorktree) {
    return { kind: "existing-worktree", branch: targetBranch, path: existingWorktree.path };
  }

  if (inspection.localBranches.includes(targetBranch)) {
    return { kind: "local-branch", branch: targetBranch };
  }

  const remoteBranch = inspection.remoteBranches.find((branch) => branch.branch === targetBranch);
  if (remoteBranch) {
    return { kind: "remote-only", remoteRef: remoteBranch.ref };
  }

  return { kind: "missing" };
}

export function canEditReviewLocally(state: LocalWorkspaceState): boolean {
  return state.phase === "ready" && state.target.kind === "current-workspace";
}

export function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizeGitLabProjectIdentifier(value: string): { hostname?: string; projectPath: string } | undefined {
  const trimmed = value.trim();
  if (!trimmed || /^\d+$/.test(trimmed)) {
    return undefined;
  }

  const remote = normalizeGitLabRemoteUrl(trimmed);
  if (remote) {
    return { hostname: remote.hostname, projectPath: remote.projectPath };
  }

  const hostPath = /^([^/]+)\/(.+\/.+)$/.exec(trimmed);
  if (hostPath && (hostPath[1]!.includes(".") || hostPath[1] === "localhost")) {
    const projectPath = normalizeProjectPath(hostPath[2]);
    return projectPath ? { hostname: hostPath[1]!.toLowerCase(), projectPath } : undefined;
  }

  const projectPath = normalizeProjectPath(trimmed);
  return projectPath ? { projectPath } : undefined;
}

function normalizeProjectPath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original path if it is only partially encoded.
  }

  decoded = decoded.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return decoded || undefined;
}

function decodeGitPath(value: string): string {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1);
  return inner.replace(/\\([0-7]{1,3}|[abtnvfre\\"?])/g, (match, escaped: string) => {
    if (/^[0-7]/.test(escaped)) {
      return String.fromCharCode(parseInt(escaped, 8));
    }

    return {
      a: "\x07",
      b: "\b",
      t: "\t",
      n: "\n",
      v: "\v",
      f: "\f",
      r: "\r",
      e: "\x1b",
      "\\": "\\",
      '"': '"',
      "?": "?"
    }[escaped] ?? match;
  });
}

function normalizeLines(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.length > 0);
}
