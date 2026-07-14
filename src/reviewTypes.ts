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

export interface ReviewUser {
  id?: string;
  username?: string;
  name: string;
  avatarUrl?: string;
  webUrl?: string;
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

export interface ReviewThreadSummary {
  id: string;
  filePath?: string;
  line?: number;
  oldLine?: number;
  newLine?: number;
  resolved: boolean;
  resolvable?: boolean;
  pending?: boolean;
  commentCount: number;
  authors: Array<{ id?: string; name: string; avatarUrl?: string }>;
  lastComment?: { author: string; createdAt: string };
  searchText: string;
}

export type ReviewSubmissionMode = "comment" | "review";

export interface ReviewDraftNote {
  id: string;
  body: string;
  filePath?: string;
  line?: number;
  pending?: boolean;
}

export interface ReviewFile {
  path: string;
  language: string;
  oldPath: string;
  newPath: string;
  patch?: string;
  status: CommitDiffStatus;
  newFile: boolean;
  deletedFile: boolean;
  renamedFile: boolean;
  collapsed: boolean;
  tooLarge: boolean;
  generatedFile: boolean;
  additions: number;
  deletions: number;
}

export interface ReviewFileView {
  path: string;
  language: string;
  oldPath: string;
  newPath: string;
  status: CommitDiffStatus;
  newFile: boolean;
  deletedFile: boolean;
  renamedFile: boolean;
  collapsed: boolean;
  tooLarge: boolean;
  generatedFile: boolean;
}

export interface ReviewFileContents {
  oldText: string;
  mrText: string;
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
  reviewers: ReviewUser[];
  commits: ReviewCommit[];
  files: ReviewFile[];
  threads: ReviewThread[];
  draftNotes?: ReviewDraftNote[];
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
  reviewers: ReviewUser[];
  commits: ReviewCommit[];
  files: FileSummary[];
  threads: ReviewThreadSummary[];
  draftNotes: ReviewDraftNote[];
  totalComments: number;
  unresolvedThreads: number;
  resolvedThreads: number;
  additions: number;
  deletions: number;
  newChanges?: ReviewUpdateRange;
}

export interface ReviewUpdateRange {
  projectId: string;
  mergeRequestIid: number;
  fromSha: string;
  toSha: string;
  commitCount: number;
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

export type CommitDiffFileSummary = Omit<CommitDiffFile, "diff">;

export interface CommitFileContents {
  oldText: string;
  newText: string;
}

export interface CommitFileReviewContext {
  commit: ReviewCommit;
  file: CommitDiffFile;
  contents?: CommitFileContents;
}

export interface NewChangesFileReviewContext {
  range: ReviewUpdateRange;
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
  threadIds: string[];
}

export interface FileReviewViewModel {
  file: ReviewFileView;
  summary: FileSummary;
  threads: ReviewThread[];
  lines: ReviewLine[];
  editableText?: string;
  hasLocalEdit: boolean;
  localEditUpdatedAt?: string;
  contentMode: "patch" | "full";
  fullFileState: "not-loaded" | "loading" | "loaded" | "too-large" | "binary" | "error";
  fullFileMessage?: string;
  lineWindow: {
    start: number;
    end: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
}
