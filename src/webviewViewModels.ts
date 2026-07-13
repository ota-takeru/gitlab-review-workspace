import type { ReviewOverview, ReviewThread } from "./reviewTypes";
import type {
  BranchTreeState,
  CommitDiffState,
  SidebarViewState,
  WebviewAuthState
} from "./webviewProtocol";
import type { LocalWorkspaceState } from "./localGitTypes";
import type { MyWorkState } from "./myWorkTypes";

export interface CommitFilterSelection {
  mrKey: string;
  commitId: string;
}

export interface ThreadCollapseSnapshot {
  collapsed?: boolean;
  previousResolved?: boolean;
}

export function createSidebarViewState(
  overview: ReviewOverview,
  auth: WebviewAuthState,
  branchTree: BranchTreeState,
  commitDiff: CommitDiffState,
  activeFilePath?: string,
  localWorkspace?: LocalWorkspaceState,
  activeTab: "review" | "my-work" = "review",
  myWork?: MyWorkState,
  threadDetails: ReviewThread[] = []
): SidebarViewState {
  return {
    overview,
    threadDetails,
    auth,
    branchTree,
    commitDiff,
    activeFilePath,
    activeTab,
    myWork: myWork ?? {
      phase: "idle",
      buckets: { attention: [], active: [], waiting: [] },
      attentionCount: 0,
      failedSources: []
    },
    localWorkspace: localWorkspace ?? {
      phase: "loading",
      remoteMatch: "unknown",
      detached: false,
      dirty: { total: 0, modified: 0, untracked: 0 },
      worktrees: [],
      target: { kind: "unknown" }
    }
  };
}

export function normalizeCommitFilter(
  mrKey: string,
  commitIds: readonly string[],
  selection: CommitFilterSelection | undefined
): CommitFilterSelection {
  return selection?.mrKey === mrKey
    && (selection.commitId === "all" || commitIds.includes(selection.commitId))
    ? selection
    : { mrKey, commitId: "all" };
}

/**
 * Builds a persistence key scoped to the MR or file that owns a discussion.
 * Length-prefixing prevents ambiguous combinations such as `a:bc` and `a:b:c`.
 */
export function threadCollapseKey(scope: string, threadId: string): string {
  return `${scope.length}:${scope}${threadId.length}:${threadId}`;
}

/**
 * Resolved-state transitions take precedence over a user's saved preference:
 * resolving folds a thread and reopening expands it. Otherwise the saved choice
 * is retained, with resolved threads folded on their first appearance.
 */
export function reconcileThreadCollapsed(
  resolved: boolean,
  snapshot: ThreadCollapseSnapshot
): boolean {
  if (snapshot.previousResolved !== undefined && snapshot.previousResolved !== resolved) {
    return resolved;
  }
  return snapshot.collapsed ?? resolved;
}

export function threadContentId(surface: "sidebar" | "review-file", scope: string, threadId: string): string {
  return `${surface}-thread-${encodeURIComponent(threadCollapseKey(scope, threadId))}`;
}

export function formatRelativeReplyTime(value: string | undefined, now = Date.now()): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

export function isCommitDiffForSelection(
  state: CommitDiffState,
  mrKey: string,
  commitId: string
): boolean {
  return state.phase !== "hidden" && state.mrKey === mrKey && state.commitId === commitId;
}
