import { execFile } from "node:child_process";
import * as pathModule from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
  emptyLocalWorkspaceState,
  GitWorktreeInfo,
  LocalBranchTarget,
  LocalWorkspaceState
} from "./localGitTypes";
import {
  classifyTargetBranch,
  isPathInside,
  LocalGitInspection,
  matchGitLabProject,
  parseGitBranchRefs,
  parseGitRemotes,
  parseGitStatusPorcelain,
  parseGitWorktreeList,
  samePath,
  toLocalDirtyState
} from "./localGitUtils";

const execFileAsync = promisify(execFile);

export interface GitCommandOptions {
  cwd: string;
  timeout: number;
}

export type GitCommandRunner = (
  args: readonly string[],
  options: GitCommandOptions
) => Promise<string>;

export interface LocalGitServiceOptions {
  commandRunner?: GitCommandRunner;
  workspaceRoot?: () => string | undefined;
  openFolder?: (worktreePath: string) => Promise<void>;
  timeout?: number;
}

export type LocalGitActionErrorCode =
  | "no-workspace"
  | "not-a-repository"
  | "dirty-workspace"
  | "branch-not-found"
  | "branch-in-use"
  | "invalid-path"
  | "operation-failed"
  | "verification-failed";

export class LocalGitActionError extends Error {
  constructor(
    readonly code: LocalGitActionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LocalGitActionError";
  }
}

export class LocalGitService implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly commandRunner: GitCommandRunner;
  private readonly workspaceRootProvider: () => string | undefined;
  private readonly openFolder: (worktreePath: string) => Promise<void>;
  private readonly timeout: number;
  private inspection?: LocalGitInspection;
  private state: LocalWorkspaceState = cloneState(emptyLocalWorkspaceState);
  private activeTargetBranch?: string;
  private activeProjectId?: string;
  private refreshGeneration = 0;

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    options: LocalGitServiceOptions = {}
  ) {
    void this.context;
    this.commandRunner = options.commandRunner ?? runGit;
    this.workspaceRootProvider = options.workspaceRoot ?? (() => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
    this.openFolder = options.openFolder ?? (async (worktreePath) => {
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(worktreePath), true);
    });
    this.timeout = options.timeout ?? 20_000;
  }

  getState(targetBranch?: string, projectId?: string): LocalWorkspaceState {
    const effectiveTargetBranch = targetBranch ?? this.activeTargetBranch;
    const effectiveProjectId = projectId ?? this.activeProjectId;
    if (!this.inspection || !effectiveTargetBranch) {
      return cloneState(this.state);
    }

    return buildWorkspaceState(this.inspection, effectiveTargetBranch, effectiveProjectId);
  }

  async refresh(targetBranch?: string, projectId?: string): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.activeTargetBranch = targetBranch;
    this.activeProjectId = projectId;
    this.state = {
      ...cloneState(this.state),
      phase: "loading",
      errorMessage: undefined,
      target: targetBranch ? { kind: "unknown" } : { kind: "unknown" }
    };
    this.onDidChangeEmitter.fire();

    const workspaceRoot = this.workspaceRootProvider();
    if (!workspaceRoot) {
      if (generation !== this.refreshGeneration) return;
      this.inspection = undefined;
      this.state = {
        ...cloneState(emptyLocalWorkspaceState),
        phase: "unavailable",
        errorMessage: "No single-root workspace is open.",
        updatedAt: new Date().toISOString()
      };
      this.onDidChangeEmitter.fire();
      return;
    }

    try {
      const inspection = await this.inspect(workspaceRoot);
      if (generation !== this.refreshGeneration) return;
      this.inspection = inspection;
      this.state = buildWorkspaceState(this.inspection, targetBranch, projectId);
    } catch {
      if (generation !== this.refreshGeneration) return;
      this.inspection = undefined;
      this.state = {
        ...cloneState(emptyLocalWorkspaceState),
        phase: "error",
        errorMessage: "Unable to inspect the local Git repository.",
        updatedAt: new Date().toISOString()
      };
    }

    this.onDidChangeEmitter.fire();
  }

  async switchCurrentWorkspace(branch: string): Promise<void> {
    const workspaceRoot = this.requireWorkspaceRoot();
    const inspection = await this.inspect(workspaceRoot);

    if (!inspection.localBranches.includes(branch)) {
      throw new LocalGitActionError("branch-not-found", `Local branch '${branch}' was not found.`);
    }
    if (inspection.dirty.total > 0) {
      throw new LocalGitActionError(
        "dirty-workspace",
        "The current workspace has uncommitted changes. Review or create a worktree before switching."
      );
    }
    if (inspection.worktrees.some((worktree) => !worktree.isCurrent && worktree.branch === branch)) {
      throw new LocalGitActionError("branch-in-use", `Branch '${branch}' is already checked out in another worktree.`);
    }
    if (inspection.currentBranch === branch) {
      await this.applyInspection(inspection, branch, this.activeProjectId);
      return;
    }

    try {
      await this.run(["switch", "--", branch], workspaceRoot);
    } catch {
      throw new LocalGitActionError("operation-failed", `Unable to switch to local branch '${branch}'.`);
    }

    const refreshed = await this.inspect(workspaceRoot);
    if (refreshed.currentBranch !== branch) {
      throw new LocalGitActionError("verification-failed", `Git did not switch to local branch '${branch}'.`);
    }
    await this.applyInspection(refreshed, branch, this.activeProjectId);
  }

  async createWorktree(branch: string, worktreePath: string): Promise<void> {
    const workspaceRoot = this.requireWorkspaceRoot();
    const resolvedPath = pathModule.resolve(worktreePath.trim());
    if (!worktreePath.trim() || samePath(resolvedPath, workspaceRoot) || isPathInside(workspaceRoot, resolvedPath)) {
      throw new LocalGitActionError(
        "invalid-path",
        "Choose a worktree folder outside the current repository."
      );
    }

    const inspection = await this.inspect(workspaceRoot);
    if (!inspection.localBranches.includes(branch)) {
      throw new LocalGitActionError("branch-not-found", `Local branch '${branch}' was not found.`);
    }
    if (inspection.worktrees.some((worktree) => worktree.branch === branch)) {
      throw new LocalGitActionError("branch-in-use", `Branch '${branch}' is already checked out in a worktree.`);
    }

    try {
      await this.run(["worktree", "add", "--", resolvedPath, branch], workspaceRoot);
    } catch {
      throw new LocalGitActionError("operation-failed", `Unable to create a worktree for local branch '${branch}'.`);
    }

    const refreshed = await this.inspect(workspaceRoot);
    const created = refreshed.worktrees.find(
      (worktree) => worktree.branch === branch && samePath(worktree.path, resolvedPath)
    );
    if (!created) {
      throw new LocalGitActionError("verification-failed", "Git did not report the created worktree.");
    }
    await this.applyInspection(refreshed, branch, this.activeProjectId);
  }

  async openWorktree(worktreePath: string): Promise<void> {
    const trimmedPath = worktreePath.trim();
    if (!trimmedPath) {
      throw new LocalGitActionError("invalid-path", "A worktree path is required.");
    }

    await this.openFolder(pathModule.resolve(trimmedPath));
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }

  private async inspect(workspaceRoot: string): Promise<LocalGitInspection> {
    const repositoryRootOutput = await this.run(["rev-parse", "--show-toplevel"], workspaceRoot);
    const repositoryRoot = firstLine(repositoryRootOutput);
    if (!repositoryRoot) {
      throw new LocalGitActionError("not-a-repository", "The workspace is not a Git repository.");
    }

    const [branchOutput, statusOutput, remoteOutput, refsOutput, worktreeOutput] = await Promise.all([
      this.run(["branch", "--show-current"], repositoryRoot),
      this.run(["status", "--porcelain=v1", "--untracked-files=all"], repositoryRoot),
      this.run(["remote", "-v"], repositoryRoot),
      this.run(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"], repositoryRoot),
      this.run(["worktree", "list", "--porcelain"], repositoryRoot)
    ]);
    const currentBranch = firstLine(branchOutput);
    const remotes = parseGitRemotes(remoteOutput);
    const branches = parseGitBranchRefs(refsOutput);
    const worktrees = parseGitWorktreeList(worktreeOutput, repositoryRoot);
    const status = parseGitStatusPorcelain(statusOutput);

    return {
      repositoryRoot,
      remoteMatch: "unknown",
      remotes,
      remoteUrl: remotes.find((remote) => remote.direction === "fetch" && remote.name === "origin")?.url
        ?? remotes.find((remote) => remote.direction === "fetch")?.url,
      currentBranch,
      detached: !currentBranch,
      dirty: toLocalDirtyState(status),
      worktrees,
      localBranches: branches.localBranches,
      remoteBranches: branches.remoteBranches
    };
  }

  private async applyInspection(
    inspection: LocalGitInspection,
    targetBranch?: string,
    projectId?: string
  ): Promise<void> {
    const nextInspection: LocalGitInspection = {
      ...inspection,
      remoteMatch: projectId ? matchGitLabProject(projectId, inspection.remotes) : inspection.remoteMatch
    };
    this.inspection = nextInspection;
    this.state = buildWorkspaceState(nextInspection, targetBranch, projectId);
    this.activeTargetBranch = targetBranch;
    this.activeProjectId = projectId;
    this.onDidChangeEmitter.fire();
  }

  private requireWorkspaceRoot(): string {
    const workspaceRoot = this.workspaceRootProvider();
    if (!workspaceRoot) {
      throw new LocalGitActionError("no-workspace", "No single-root workspace is open.");
    }
    return workspaceRoot;
  }

  private async run(args: readonly string[], cwd: string): Promise<string> {
    return this.commandRunner(args, { cwd, timeout: this.timeout });
  }
}

export { GitWorktreeInfo, LocalBranchTarget, LocalWorkspaceState } from "./localGitTypes";
export * from "./localGitUtils";

const runGit: GitCommandRunner = async (args, options) => {
  const result = await execFileAsync("git", [...args], {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
  return result.stdout;
};

function buildWorkspaceState(
  inspection: LocalGitInspection,
  targetBranch?: string,
  projectId?: string
): LocalWorkspaceState {
  const remoteMatch = projectId
    ? matchGitLabProject(projectId, inspection.remotes)
    : "unknown";
  const nextInspection = { ...inspection, remoteMatch };
  return {
    phase: "ready",
    repositoryRoot: inspection.repositoryRoot,
    remoteMatch,
    remoteUrl: inspection.remoteUrl,
    currentBranch: inspection.currentBranch,
    detached: inspection.detached,
    dirty: { ...inspection.dirty },
    worktrees: inspection.worktrees.map((worktree) => ({ ...worktree })),
    target: classifyTargetBranch(targetBranch, nextInspection),
    updatedAt: new Date().toISOString()
  };
}

function cloneState(state: LocalWorkspaceState): LocalWorkspaceState {
  return {
    ...state,
    dirty: { ...state.dirty },
    worktrees: state.worktrees.map((worktree) => ({ ...worktree })),
    target: cloneTarget(state.target)
  };
}

function cloneTarget(target: LocalBranchTarget): LocalBranchTarget {
  return { ...target } as LocalBranchTarget;
}

function firstLine(value: string): string | undefined {
  const line = value.trim().split(/\r?\n/, 1)[0];
  return line || undefined;
}
