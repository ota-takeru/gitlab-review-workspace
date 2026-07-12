export interface ReviewComment {
  id: string;
  author: string;
  authorId?: string;
  avatarUrl?: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
  canEdit?: boolean;
  pending?: boolean;
}

export interface ReviewThread {
  id: string;
  filePath?: string;
  line?: number;
  oldLine?: number;
  newLine?: number;
  resolved: boolean;
  resolvable?: boolean;
  pending?: boolean;
  comments: ReviewComment[];
}

export interface ReviewFile {
  path: string;
  language: string;
  oldText: string;
  mrText: string;
  oldPath?: string;
  newPath?: string;
}

export interface LocalEdit {
  filePath: string;
  editedText: string;
  updatedAt: string;
}

export interface ReviewState {
  id: string;
  projectId: string;
  mergeRequestIid: number;
  webUrl?: string;
  diffRefs?: ReviewDiffRefs;
  title: string;
  state: MergeRequestState;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  commits: ReviewCommit[];
  files: ReviewFile[];
  threads: ReviewThread[];
}

export interface ReviewDiffRefs {
  baseSha: string;
  startSha: string;
  headSha: string;
}

export interface DiffCount {
  additions: number;
  deletions: number;
}

export interface FileSummary extends DiffCount {
  path: string;
  language: string;
  threadCount: number;
  unresolvedThreadCount: number;
  resolvedThreadCount: number;
  hasLocalEdit: boolean;
  localEditUpdatedAt?: string;
}

export interface ReviewOverview {
  loadState: ReviewLoadState;
  isRefreshing: boolean;
  errorMessage?: string;
  selectedMergeRequest?: MergeRequestOption;
  threadSortOrder: ReviewThreadSortOrder;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  commits: ReviewCommit[];
  files: FileSummary[];
  threads: ReviewThread[];
  totalComments: number;
  unresolvedThreads: number;
  resolvedThreads: number;
  additions: number;
  deletions: number;
}

export interface ReviewCommit {
  id: string;
  shortId: string;
  title: string;
  authorName: string;
  authoredAt: string;
  committedAt: string;
  webUrl?: string;
}

export type CommitDiffStatus = "new" | "deleted" | "renamed" | "modified";

export interface CommitDiffFile {
  path: string;
  oldPath: string;
  newPath: string;
  diff: string;
  status: CommitDiffStatus;
  newFile: boolean;
  deletedFile: boolean;
  renamedFile: boolean;
  collapsed: boolean;
  tooLarge: boolean;
}

export interface CommitFileContents {
  oldText: string;
  newText: string;
}

export interface CommitFileReviewContext {
  commit: ReviewCommit;
  file: CommitDiffFile;
  contents?: CommitFileContents;
}

export type ReviewLoadState = "loading" | "ready" | "empty" | "error";

export type ReviewThreadSortOrder = "open-first" | "oldest" | "newest";

export interface MergeRequestOption {
  projectId: string;
  iid: number;
  title: string;
  state: MergeRequestState;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  webUrl?: string;
  updatedAt?: string;
}

export type MergeRequestState = "opened" | "merged" | "closed" | "locked";

export interface ReviewNotification {
  id: string;
  projectId: string;
  mergeRequestIid: number;
  title: string;
  state: MergeRequestState;
  actionName: string;
  author: string;
  createdAt: string;
  webUrl?: string;
}

export interface RepositoryTreeEntry {
  name: string;
  path: string;
  type: "tree" | "blob";
}

export interface BranchFileContent {
  projectId: string;
  branch: string;
  path: string;
  language: string;
  content: string;
}

export type ReviewLineKind =
  | "context"
  | "mr-added"
  | "mr-removed"
  | "local-added"
  | "local-removed";

export interface ReviewLine {
  id: string;
  kind: ReviewLineKind;
  text: string;
  oldLine?: number;
  mrLine?: number;
  localLine?: number;
  mrAdded?: boolean;
  threads: ReviewThread[];
}

export interface FileReviewViewModel {
  file: ReviewFile;
  summary: FileSummary;
  threads: ReviewThread[];
  lines: ReviewLine[];
  editableText: string;
  hasLocalEdit: boolean;
  localEditUpdatedAt?: string;
}
