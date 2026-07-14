import type {
  CommitDiffFile,
  CommitDiffFileSummary,
  CommitFileContents,
  FileReviewViewModel,
  RepositoryTreeEntry,
  ReviewCommit,
  ReviewOverview,
  ReviewSubmissionMode,
  ReviewThread
} from "./reviewTypes";
import type { LocalWorkspaceState } from "./localGitTypes";
import type { MyWorkState } from "./myWorkTypes";
import type { CommentImageHostMessage, CommentImageWebviewMessage } from "./commentImageTypes";

export interface WebviewAuthState {
  phase: "checking" | "available" | "signedOut" | "unavailable";
  hostname: string;
  reason?: "invalidBaseUrl";
}

export interface BranchTreeState {
  phase: "hidden" | "loading" | "ready" | "error";
  branch?: string;
  entries: RepositoryTreeEntry[];
  errorMessage?: string;
}

export interface CommitDiffState {
  phase: "hidden" | "loading" | "ready" | "error";
  mrKey?: string;
  commitId?: string;
  files: CommitDiffFileSummary[];
  errorMessage?: string;
}

export interface SidebarViewState {
  activeTab: "review" | "my-work";
  myWork: MyWorkState;
  overview: ReviewOverview;
  threadDetails: ReviewThread[];
  auth: WebviewAuthState;
  branchTree: BranchTreeState;
  commitDiff: CommitDiffState;
  activeFilePath?: string;
  localWorkspace: LocalWorkspaceState;
}

export interface ReviewFileViewState {
  mode: "review" | "edit";
  canEditLocally: boolean;
  projectId?: string;
  source?: "review" | "commit";
  filePath: string;
  threadScope: string;
  viewModel?: FileReviewViewModel;
  targetLine?: number;
  targetThreadId?: string;
  commit?: ReviewCommit;
}

export interface CommitDiffViewState {
  commit: ReviewCommit;
  file: CommitDiffFile;
  fullFile?: CommitFileContents;
  fullFileLoading?: boolean;
  fullFileError?: string;
}

export type HostMessage<T> = { type: "state"; state: T } | CommentImageHostMessage;
export type ReadyMessage = { type: "ready" };
export type CommitDiffMessage = ReadyMessage | { type: "loadFullFile" };

export type SidebarMessage =
  | ReadyMessage
  | { type: "openFile"; filePath: string; line?: number; threadId?: string }
  | { type: "toggleBranchTree"; branch: string }
  | { type: "closeBranchTree" }
  | { type: "openBranchFile"; branch: string; filePath: string }
  | { type: "openCommitFile"; commitId: string; filePath: string }
  | { type: "addComment"; threadId: string; body: string }
  | { type: "addOverviewThread"; body: string; mode: ReviewSubmissionMode }
  | { type: "publishReviewDraft"; draftId: string }
  | { type: "submitReview" }
  | { type: "editComment"; threadId: string; commentId: string; body: string }
  | { type: "toggleResolved"; threadId: string }
  | { type: "setThreadExpanded"; threadId: string; expanded: boolean }
  | { type: "login" }
  | { type: "refreshAuth" }
  | { type: "refreshReview" }
  | { type: "setThreadSort"; order: "open-first" | "oldest" | "newest" }
  | { type: "setSidebarTab"; tab: "review" | "my-work" }
  | { type: "refreshMyWork" }
  | { type: "openMyWorkMergeRequest"; projectId: string; iid: number }
  | { type: "openCommit"; commitId: string }
  | { type: "toggleCommit"; commitId: string }
  | { type: "collapseCommit" }
  | { type: "refreshLocalWorkspace" }
  | { type: "switchCurrentWorkspace"; branch: string }
  | { type: "openExistingWorktree"; path: string }
  | { type: "createWorktree"; branch: string }
  | { type: "showRemoteBranchInstructions" }
  | CommentImageWebviewMessage;

export type ReviewFileMessage =
  | ReadyMessage
  | { type: "loadFullFile" }
  | { type: "loadLineWindow"; start: number }
  | { type: "enterEdit" }
  | { type: "cancelEdit" }
  | { type: "saveLocalEdit"; text: string }
  | { type: "clearLocalEdit" }
  | { type: "addComment"; threadId: string; body: string }
  | { type: "editComment"; threadId: string; commentId: string; body: string }
  | { type: "toggleResolved"; threadId: string }
  | { type: "addThread"; body: string; mrLine: number; oldLine?: number }
  | CommentImageWebviewMessage;
