import type {
  CommitDiffFile,
  CommitDiffFileSummary,
  CommitFileContents,
  FileReviewViewModel,
  RepositoryTreeEntry,
  ReviewCommit,
  ReviewUpdateRange,
  ReviewOverview,
  ReviewSubmissionMode,
  ReviewThread
} from "./reviewTypes";
import type { LocalWorkspaceState } from "./localGitTypes";
import type { MyWorkState } from "./myWorkTypes";
import type { CommentImageHostMessage, CommentImageWebviewMessage } from "./commentImageTypes";
import type { ReviewContext, ReviewMutationResult } from "./reviewContext";

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
  /** Full rendered review revision used to reject an old diff response. */
  reviewContextKey?: string;
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
  /** The immutable review revision this panel rendered. */
  reviewContext?: ReviewContext;
  /** The latest live revision known to the Host, when it differs from the view. */
  liveReviewContext?: ReviewContext;
  /** True when the panel is showing a revision that can no longer receive writes. */
  stale?: boolean;
  canComment?: boolean;
  commentUnavailableReason?: string;
  mode: "review" | "edit";
  canEditLocally: boolean;
  projectId?: string;
  source?: "review" | "commit" | "new-changes";
  filePath: string;
  threadScope: string;
  viewModel?: FileReviewViewModel;
  targetLine?: number;
  targetThreadId?: string;
  submissionMode?: ReviewSubmissionMode;
  commit?: ReviewCommit;
  newChanges?: ReviewUpdateRange & {
    selected: "all" | "new";
    loading: boolean;
    fileChanged?: boolean;
    errorMessage?: string;
  };
}

export interface CommitDiffViewState {
  commit: ReviewCommit;
  file: CommitDiffFile;
  fullFile?: CommitFileContents;
  fullFileLoading?: boolean;
  fullFileError?: string;
}

export type HostMessage<T, TExtra = never> =
  | { type: "state"; state: T }
  | CommentImageHostMessage
  | TExtra;
export type ReviewMutationHostMessage = { type: "reviewMutationResult"; requestId: string } & ReviewMutationResult;
export type ReviewMutationRequest = { requestId: string; reviewContext: ReviewContext };
export type ReviewMutationMessage<T extends object> = T & ReviewMutationRequest;
export type SidebarHostMessage = { type: "revealThread"; threadId: string } | ReviewMutationHostMessage;
export type ReviewFileHostMessage =
  | ReviewMutationHostMessage
  | { type: "localEditSaveResult"; requestId: string; ok: true }
  | { type: "localEditSaveResult"; requestId: string; ok: false; errorMessage: string };
export type ReadyMessage = { type: "ready" };
export type CommitDiffMessage = ReadyMessage | { type: "loadFullFile" };

export type SidebarMessage =
  | ReadyMessage
  | ReviewMutationMessage<{ type: "openFile"; filePath: string; line?: number; threadId?: string }>
  | { type: "toggleBranchTree"; branch: string }
  | { type: "closeBranchTree" }
  | ReviewMutationMessage<{ type: "openBranchFile"; branch: string; filePath: string }>
  | ReviewMutationMessage<{ type: "openCommitFile"; commitId: string; filePath: string }>
  | ReviewMutationMessage<{ type: "openNewChangesFile"; filePath: string }>
  | ReviewMutationMessage<{ type: "addComment"; threadId: string; body: string }>
  | ReviewMutationMessage<{ type: "loadCommentReactions"; threadId: string; commentId: string }>
  | ReviewMutationMessage<{ type: "toggleCommentReaction"; threadId: string; commentId: string; name: string }>
  | ReviewMutationMessage<{ type: "addOverviewThread"; body: string; mode: ReviewSubmissionMode }>
  | { type: "setSubmissionMode"; mode: ReviewSubmissionMode }
  | ReviewMutationMessage<{ type: "publishReviewDraft"; draftId: string }>
  | ReviewMutationMessage<{ type: "submitReview" }>
  | ReviewMutationMessage<{ type: "markReviewComplete" }>
  | ReviewMutationMessage<{ type: "editComment"; threadId: string; commentId: string; body: string }>
  | ReviewMutationMessage<{ type: "toggleResolved"; threadId: string }>
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
  | { type: "setReviewRange"; range: "all" | "new" }
  | { type: "enterEdit" }
  | { type: "cancelEdit" }
  | ReviewMutationMessage<{ type: "saveLocalEdit"; text: string }>
  | ReviewMutationMessage<{ type: "clearLocalEdit" }>
  | ReviewMutationMessage<{ type: "addComment"; threadId: string; body: string }>
  | ReviewMutationMessage<{ type: "loadCommentReactions"; threadId: string; commentId: string }>
  | ReviewMutationMessage<{ type: "toggleCommentReaction"; threadId: string; commentId: string; name: string }>
  | ReviewMutationMessage<{ type: "editComment"; threadId: string; commentId: string; body: string }>
  | ReviewMutationMessage<{ type: "toggleResolved"; threadId: string }>
  | ReviewMutationMessage<{ type: "addThread"; body: string; mrLine: number; oldLine?: number; mode?: ReviewSubmissionMode }>
  | ReviewMutationMessage<{ type: "openCurrentReviewFile"; filePath: string; line?: number; threadId?: string }>
  | { type: "setSubmissionMode"; mode: ReviewSubmissionMode }
  | CommentImageWebviewMessage;
