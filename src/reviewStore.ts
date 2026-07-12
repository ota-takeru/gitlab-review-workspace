import * as vscode from "vscode";
import { GitLabReviewClient } from "./gitlabApi";
import { getGitLabHostname } from "./glabAuthUtils";
import { inferLanguage } from "./gitlabMappers";
import { parseCommitDiff } from "./commitDiffUtils";
import { buildReviewLines, countLineDiff } from "./diffUtils";
import { editedTimestamp } from "./commentUtils";
import { ReviewThreadSortOrder, sortReviewThreads } from "./reviewTreeUtils";
import {
  BranchFileContent,
  CommitDiffFile,
  CommitFileContents,
  CommitFileReviewContext,
  FileReviewViewModel,
  FileSummary,
  LocalEdit,
  MergeRequestOption,
  ReviewFile,
  ReviewLine,
  ReviewLineKind,
  ReviewLoadState,
  ReviewOverview,
  ReviewState,
  ReviewThread,
  RepositoryTreeEntry
} from "./reviewTypes";
import type { MergeRequestWorkspaceAssociation } from "./localGitTypes";

export const REVIEW_CACHE_KEYS = {
  localEdits: "gitlabReview.localEdits.v2",
  selectedMergeRequest: "gitlabReview.selectedMergeRequest",
  reviewState: "gitlabReview.cache.reviewState.v1",
  branchTrees: "gitlabReview.cache.branchTrees.v1",
  branchFiles: "gitlabReview.cache.branchFiles.v1",
  commitDiffs: "gitlabReview.cache.commitDiffs.v1",
  threadSortOrder: "gitlabReview.threadSortOrder.v1",
  workspaceAssociations: "gitlabReview.workspaceAssociations.v1"
} as const;

const cacheLimits = {
  reviewStates: 3,
  branchTrees: 8,
  branchTreeEntries: 2_000,
  branchFiles: 20,
  branchFileCharacters: 2_000_000,
  commitDiffs: 12,
  commitDiffCharacters: 2_000_000,
  reviewStateCharacters: 8_000_000
} as const;
const cachedReviewRevealDelayMs = 100;

type LocalEditsByMergeRequest = Record<string, Record<string, LocalEdit>>;
type MergeRequestReference = Pick<MergeRequestOption, "projectId" | "iid">;
type WorkspaceAssociations = Record<string, MergeRequestWorkspaceAssociation>;

interface CacheEntry<T> {
  key: string;
  value: T;
  updatedAt: number;
}

export class ReviewStore {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private state?: ReviewState;
  private loadState: ReviewLoadState;
  private isRefreshing = false;
  private errorMessage?: string;
  private threadSortOrder: ReviewThreadSortOrder;
  private selectedReference?: MergeRequestReference;
  private lastLoadedReference?: MergeRequestReference;
  private readonly reviewStateCache = new Map<string, ReviewState>();
  private refreshGeneration = 0;
  private localEdits: LocalEditsByMergeRequest;
  private workspaceAssociations: WorkspaceAssociations;
  private readonly branchTreeCache = new Map<string, RepositoryTreeEntry[]>();
  private readonly branchFileCache = new Map<string, BranchFileContent>();
  private readonly branchTreeCacheTimes = new Map<string, number>();
  private readonly branchFileCacheTimes = new Map<string, number>();
  private readonly commitDiffCache = new Map<string, CommitDiffFile[]>();
  private readonly commitDiffCacheTimes = new Map<string, number>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const cachedState = this.context.workspaceState.get<ReviewState>(REVIEW_CACHE_KEYS.reviewState);
    this.state = cachedState
      ? {
          ...cachedState,
          commits: cachedState.commits ?? [],
          threads: cachedState.threads.map((thread) => ({
            ...thread,
            comments: thread.comments.map((comment) => ({ ...comment, canEdit: false }))
          }))
        }
      : undefined;
    this.threadSortOrder = normalizeThreadSortOrder(
      this.context.workspaceState.get<string>(REVIEW_CACHE_KEYS.threadSortOrder)
    );
    this.selectedReference = this.context.workspaceState.get<MergeRequestReference>(
      REVIEW_CACHE_KEYS.selectedMergeRequest
    );
    this.lastLoadedReference = this.state
      ? this.selectedReference?.iid === this.state.mergeRequestIid
        ? this.selectedReference
        : { projectId: this.state.projectId, iid: this.state.mergeRequestIid }
      : undefined;
    if (this.state) {
      this.cacheReviewState(this.state);
    }
    this.localEdits =
      this.context.workspaceState.get<LocalEditsByMergeRequest>(REVIEW_CACHE_KEYS.localEdits) ?? {};
    this.workspaceAssociations =
      this.context.workspaceState.get<WorkspaceAssociations>(REVIEW_CACHE_KEYS.workspaceAssociations) ?? {};
    this.hydrateMap(
      this.branchTreeCache,
      this.branchTreeCacheTimes,
      this.context.workspaceState.get<CacheEntry<RepositoryTreeEntry[]>[]>(REVIEW_CACHE_KEYS.branchTrees) ?? [],
      cacheLimits.branchTrees
    );
    this.hydrateMap(
      this.branchFileCache,
      this.branchFileCacheTimes,
      this.context.workspaceState.get<CacheEntry<BranchFileContent>[]>(REVIEW_CACHE_KEYS.branchFiles) ?? [],
      cacheLimits.branchFiles
    );
    this.hydrateMap(
      this.commitDiffCache,
      this.commitDiffCacheTimes,
      this.context.workspaceState.get<CacheEntry<CommitDiffFile[]>[]>(REVIEW_CACHE_KEYS.commitDiffs) ?? [],
      cacheLimits.commitDiffs
    );
    this.trimCommitDiffCharacters();
    this.loadState = this.state ? "ready" : "loading";
  }

  getOverview(): ReviewOverview {
    const files = this.state?.files.map((file) => this.getFileSummary(file)) ?? [];
    const additions = files.reduce((total, file) => total + file.additions, 0);
    const deletions = files.reduce((total, file) => total + file.deletions, 0);
    const threads = sortReviewThreads(this.state?.threads ?? [], this.threadSortOrder);
    const resolvableThreads = threads.filter((thread) => thread.resolvable !== false);
    const resolvedThreads = resolvableThreads.filter((thread) => thread.resolved).length;
    const unresolvedThreads = resolvableThreads.length - resolvedThreads;

    return {
      loadState: this.loadState,
      isRefreshing: this.isRefreshing,
      errorMessage: this.errorMessage,
      selectedMergeRequest: this.state ? toMergeRequestOption(this.state) : undefined,
      threadSortOrder: this.threadSortOrder,
      title: this.state?.title ?? "",
      sourceBranch: this.state?.sourceBranch ?? "",
      targetBranch: this.state?.targetBranch ?? "",
      author: this.state?.author ?? "",
      commits: this.state?.commits ?? [],
      files,
      threads,
      totalComments: threads.reduce((total, thread) => total + thread.comments.length, 0),
      unresolvedThreads,
      resolvedThreads,
      additions,
      deletions
    };
  }

  getWorkspaceAssociation(projectId: string, mergeRequestIid: number): MergeRequestWorkspaceAssociation | undefined {
    return this.workspaceAssociations[workspaceAssociationKey(projectId, mergeRequestIid)];
  }

  async rememberWorkspaceAssociation(association: MergeRequestWorkspaceAssociation): Promise<void> {
    const key = workspaceAssociationKey(association.projectId, association.mergeRequestIid);
    this.workspaceAssociations[key] = { ...association };
    await this.context.workspaceState.update(REVIEW_CACHE_KEYS.workspaceAssociations, this.workspaceAssociations);
  }

  getFileViewModel(filePath: string): FileReviewViewModel | undefined {
    const file = this.findFile(filePath);
    if (!file || !this.state) {
      return undefined;
    }

    const localEdit = this.getLocalEdit(this.state.id, filePath);
    const threads = this.getThreadsForFile(filePath);
    return {
      file,
      summary: this.getFileSummary(file),
      threads,
      lines: buildReviewLines(file.oldText, file.mrText, localEdit?.editedText, threads),
      editableText: localEdit?.editedText ?? file.mrText,
      hasLocalEdit: Boolean(localEdit && localEdit.editedText !== file.mrText),
      localEditUpdatedAt: localEdit?.updatedAt
    };
  }

  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.isRefreshing = true;
    if (!this.state) {
      this.loadState = "loading";
    }
    this.errorMessage = undefined;
    this.onDidChangeEmitter.fire();

    const reference = this.getSelectedReference();
    const previousState = reference
      ? this.getCachedReviewState(reference) ?? (this.state && stateMatchesReference(this.state, reference, this.lastLoadedReference) ? this.state : undefined)
      : this.state;
    try {
      const client = this.getClient();

      if (!reference) {
        if (generation !== this.refreshGeneration) return;
        this.loadState = previousState ? "ready" : "empty";
      } else {
        try {
          const fallbackCommits = previousState
            && previousState.mergeRequestIid === reference.iid
            && (previousState.projectId === reference.projectId || sameReference(this.lastLoadedReference, reference))
            ? previousState.commits ?? []
            : [];
          const loadedState = await client.loadMergeRequest(reference, fallbackCommits);
          if (generation !== this.refreshGeneration) return;
          this.state = loadedState;
          this.lastLoadedReference = reference;
          this.cacheReviewState(this.state);
          this.loadState = "ready";
          this.errorMessage = undefined;
          this.persistReviewState();
        } catch {
          if (generation !== this.refreshGeneration) return;
          this.state = previousState;
          this.lastLoadedReference = previousState ? reference : undefined;
          this.loadState = previousState ? "ready" : "error";
          this.errorMessage = "GitLab の MR を読み込めませんでした。キャッシュを表示しています。";
        }
      }

    } catch {
      if (generation !== this.refreshGeneration) return;
      this.state = previousState;
      this.lastLoadedReference = previousState && reference ? reference : undefined;
      this.loadState = previousState ? "ready" : "error";
      this.errorMessage = "GitLab の MR を読み込めませんでした。キャッシュを表示しています。";
    } finally {
      if (generation === this.refreshGeneration) {
        this.isRefreshing = false;
        this.onDidChangeEmitter.fire();
      }
    }
  }

  async selectMergeRequest(projectId: string, iid: number): Promise<void> {
    if (!projectId || !Number.isInteger(iid) || iid < 1) {
      return;
    }

    const nextReference = { projectId, iid };
    const cachedState = this.state && stateMatchesReference(this.state, nextReference, this.lastLoadedReference)
      ? this.state
      : this.getCachedReviewState(nextReference);
    if (this.state) this.cacheReviewState(this.state);
    this.state = undefined;
    this.lastLoadedReference = undefined;
    this.loadState = "loading";
    this.errorMessage = undefined;
    this.onDidChangeEmitter.fire();
    this.selectedReference = nextReference;
    this.persistBestEffort(REVIEW_CACHE_KEYS.selectedMergeRequest, this.selectedReference);
    const refresh = this.refresh();
    const revealCachedState = cachedState
      ? setTimeout(() => {
          if (!sameReference(this.selectedReference, nextReference) || this.loadState !== "loading") return;
          this.state = cachedState;
          this.lastLoadedReference = nextReference;
          this.loadState = "ready";
          this.errorMessage = undefined;
          this.onDidChangeEmitter.fire();
        }, cachedReviewRevealDelayMs)
      : undefined;
    try {
      await refresh;
    } finally {
      if (revealCachedState) clearTimeout(revealCachedState);
    }
  }

  async setThreadSortOrder(order: ReviewThreadSortOrder): Promise<void> {
    this.threadSortOrder = normalizeThreadSortOrder(order);
    await this.context.workspaceState.update(REVIEW_CACHE_KEYS.threadSortOrder, this.threadSortOrder);
    this.onDidChangeEmitter.fire();
  }

  getIsRefreshing(): boolean {
    return this.isRefreshing;
  }

  async loadBranchTree(branch: string): Promise<RepositoryTreeEntry[]> {
    const review = this.state;
    if (!review) {
      throw new Error("No merge request is loaded.");
    }

    const cacheKey = this.branchCacheKey(review, branch);
    const cached = this.branchTreeCache.get(cacheKey);
    if (cached) {
      this.branchTreeCacheTimes.set(cacheKey, Date.now());
      this.persistMapCacheBestEffort(REVIEW_CACHE_KEYS.branchTrees, this.branchTreeCache, this.branchTreeCacheTimes);
      return cached;
    }

    const entries = (await this.getClient().listRepositoryTree(review.projectId, branch))
      .slice(0, cacheLimits.branchTreeEntries);
    this.setLimitedCache(this.branchTreeCache, this.branchTreeCacheTimes, cacheKey, entries, cacheLimits.branchTrees);
    this.persistMapCacheBestEffort(REVIEW_CACHE_KEYS.branchTrees, this.branchTreeCache, this.branchTreeCacheTimes);
    return entries;
  }

  async loadCommitDiff(commitId: string): Promise<CommitDiffFile[]> {
    const review = this.state;
    if (!review || !review.commits.some((commit) => commit.id === commitId)) {
      throw new Error("The commit is not part of the current merge request.");
    }

    const cacheKey = `${review.projectId}:${commitId}`;
    const cached = this.commitDiffCache.get(cacheKey);
    if (cached) {
      this.commitDiffCacheTimes.set(cacheKey, Date.now());
      this.persistCommitDiffCache();
      return cached;
    }

    const files = await this.getClient().loadCommitDiff(review.projectId, commitId);
    this.setLimitedCache(
      this.commitDiffCache,
      this.commitDiffCacheTimes,
      cacheKey,
      files,
      cacheLimits.commitDiffs
    );
    this.trimCommitDiffCharacters();
    this.persistCommitDiffCache();
    return files;
  }

  async loadCommitFileContents(commitId: string, file: CommitDiffFile): Promise<CommitFileContents> {
    const review = this.state;
    if (!review || !review.commits.some((commit) => commit.id === commitId)) {
      throw new Error("The commit is not part of the current merge request.");
    }
    return this.getClient().loadCommitFileContents(review.projectId, commitId, file);
  }

  async loadCommitFileReviewContext(commitId: string, filePath: string): Promise<CommitFileReviewContext> {
    const overview = this.getOverview();
    const commit = overview.commits.find((candidate) => candidate.id === commitId);
    if (!commit) throw new Error("The commit is not part of the current merge request.");
    const files = await this.loadCommitDiff(commitId);
    const file = files.find((candidate) => candidate.path === filePath);
    if (!file) throw new Error("The file is not part of the selected commit.");
    return { commit, file };
  }

  buildCommitFileViewModel(context: CommitFileReviewContext): FileReviewViewModel {
    const reviewFile = this.findFile(context.file.path);
    const threads = this.getThreadsForFile(context.file.path);
    const lines = context.contents
      ? buildReviewLines(context.contents.oldText, context.contents.newText, undefined, threads)
      : buildCommitPatchLines(context.file.diff, threads);
    const file: ReviewFile = reviewFile
      ? {
        ...reviewFile,
        oldText: context.contents?.oldText ?? "",
        mrText: context.contents?.newText ?? ""
      }
      : {
        path: context.file.path,
        language: inferLanguage(context.file.path),
        oldText: context.contents?.oldText ?? "",
        mrText: context.contents?.newText ?? "",
        oldPath: context.file.oldPath,
        newPath: context.file.newPath
      };
    const counts = context.contents
      ? countLineDiff(file.oldText, file.mrText)
      : {
        additions: lines.filter((line) => line.kind === "mr-added").length,
        deletions: lines.filter((line) => line.kind === "mr-removed").length
      };
    return {
      file,
      summary: {
        path: file.path,
        language: file.language,
        ...counts,
        threadCount: threads.length,
        unresolvedThreadCount: threads.filter((thread) => !thread.resolved).length,
        resolvedThreadCount: threads.filter((thread) => thread.resolved).length,
        hasLocalEdit: false
      },
      threads,
      lines,
      editableText: context.contents?.newText ?? "",
      hasLocalEdit: false
    };
  }

  async loadBranchFile(branch: string, filePath: string): Promise<BranchFileContent> {
    const review = this.state;
    if (!review) {
      throw new Error("No merge request is loaded.");
    }

    const cacheKey = `${this.branchCacheKey(review, branch)}:${filePath}`;
    const cached = this.branchFileCache.get(cacheKey);
    if (cached) {
      this.branchFileCacheTimes.set(cacheKey, Date.now());
      this.persistMapCacheBestEffort(REVIEW_CACHE_KEYS.branchFiles, this.branchFileCache, this.branchFileCacheTimes);
      return cached;
    }

    const file = await this.getClient().readRepositoryFile(review.projectId, branch, filePath);
    if (file.content.length > cacheLimits.branchFileCharacters) {
      return file;
    }
    this.setLimitedCache(this.branchFileCache, this.branchFileCacheTimes, cacheKey, file, cacheLimits.branchFiles);
    this.trimBranchFileCharacters();
    this.persistMapCacheBestEffort(REVIEW_CACHE_KEYS.branchFiles, this.branchFileCache, this.branchFileCacheTimes);
    return file;
  }

  async addComment(threadId: string, body: string): Promise<void> {
    const review = this.state;
    const thread = review?.threads.find((item) => item.id === threadId);
    const trimmed = body.trim();
    if (!review || !thread || thread.pending || trimmed.length === 0) {
      return;
    }

    const pendingComment = {
      id: pendingId("comment"),
      author: "you",
      body: trimmed,
      createdAt: new Date().toISOString(),
      canEdit: true,
      pending: true
    };
    thread.comments.push(pendingComment);
    thread.pending = true;
    this.onDidChangeEmitter.fire();

    try {
      const confirmedComment = await this.getClient().addReply(review, threadId, trimmed);
      const index = thread.comments.findIndex((comment) => comment.id === pendingComment.id);
      if (index >= 0) {
        thread.comments[index] = confirmedComment;
      }
      thread.pending = false;
      this.persistReviewState();
      this.onDidChangeEmitter.fire();
    } catch {
      const index = thread.comments.findIndex((comment) => comment.id === pendingComment.id);
      if (index >= 0) {
        thread.comments.splice(index, 1);
      }
      thread.pending = false;
      this.onDidChangeEmitter.fire();
      void vscode.window.showErrorMessage("GitLab への返信を追加できませんでした。");
    }
  }

  async editComment(threadId: string, commentId: string, body: string): Promise<void> {
    const review = this.state;
    const thread = review?.threads.find((item) => item.id === threadId);
    const commentIndex = thread?.comments.findIndex((comment) => comment.id === commentId) ?? -1;
    const comment = commentIndex >= 0 ? thread?.comments[commentIndex] : undefined;
    const trimmed = body.trim();
    if (!review || !thread || !comment || !comment.canEdit || comment.pending || !trimmed) {
      return;
    }

    const previous = { ...comment };
    comment.body = trimmed;
    comment.updatedAt = editedTimestamp(comment.createdAt);
    comment.pending = true;
    this.onDidChangeEmitter.fire();

    try {
      const confirmed = await this.getClient().updateComment(review, threadId, commentId, trimmed);
      thread.comments[commentIndex] = {
        ...previous,
        ...confirmed,
        body: confirmed.body || trimmed,
        createdAt: confirmed.createdAt === new Date(0).toISOString() ? previous.createdAt : confirmed.createdAt,
        updatedAt: editedTimestamp(previous.createdAt, confirmed.updatedAt),
        canEdit: true,
        pending: false
      };
      this.persistReviewState();
      this.onDidChangeEmitter.fire();
    } catch {
      thread.comments[commentIndex] = previous;
      this.onDidChangeEmitter.fire();
      void vscode.window.showErrorMessage("GitLab のコメントを編集できませんでした。");
    }
  }

  async toggleResolved(threadId: string): Promise<void> {
    const review = this.state;
    const thread = review?.threads.find((item) => item.id === threadId);
    if (!review || !thread || thread.pending || thread.resolvable === false) {
      return;
    }

    const previousResolved = thread.resolved;
    thread.resolved = !previousResolved;
    thread.pending = true;
    this.onDidChangeEmitter.fire();

    try {
      const confirmedThread = await this.getClient().setResolved(review, threadId, thread.resolved);
      confirmedThread.comments = confirmedThread.comments.map((comment) => {
        const previousComment = thread.comments.find((candidate) => candidate.id === comment.id);
        return previousComment
          ? {
              ...comment,
              authorId: previousComment.authorId,
              updatedAt: comment.updatedAt ?? previousComment.updatedAt,
              canEdit: previousComment.canEdit
            }
          : comment;
      });
      this.replaceThread(threadId, confirmedThread);
      this.persistReviewState();
      this.onDidChangeEmitter.fire();
    } catch {
      thread.resolved = previousResolved;
      thread.pending = false;
      this.onDidChangeEmitter.fire();
      void vscode.window.showErrorMessage("GitLab のスレッド状態を更新できませんでした。");
    }
  }

  async addThread(
    filePath: string,
    mrLine: number,
    oldLine: number | undefined,
    body: string
  ): Promise<void> {
    const review = this.state;
    const file = this.findFile(filePath);
    const trimmed = body.trim();
    if (!review || !file || !trimmed || mrLine < 1) {
      return;
    }

    const pendingThread: ReviewThread = {
      id: pendingId("thread"),
      filePath,
      line: mrLine,
      oldLine,
      newLine: mrLine,
      resolved: false,
      resolvable: true,
      pending: true,
      comments: [{
        id: pendingId("comment"),
        author: "you",
        body: trimmed,
        createdAt: new Date().toISOString(),
        canEdit: true,
        pending: true
      }]
    };
    review.threads.push(pendingThread);
    this.onDidChangeEmitter.fire();

    try {
      const confirmedThread = await this.getClient().createThread(review, file, mrLine, oldLine, trimmed);
      this.replaceThread(pendingThread.id, confirmedThread);
      this.persistReviewState();
      this.onDidChangeEmitter.fire();
    } catch {
      const index = review.threads.findIndex((thread) => thread.id === pendingThread.id);
      if (index >= 0) {
        review.threads.splice(index, 1);
      }
      this.onDidChangeEmitter.fire();
      void vscode.window.showErrorMessage("GitLab のレビューコメントを追加できませんでした。");
    }
  }

  async saveLocalEdit(filePath: string, editedText: string): Promise<void> {
    const file = this.findFile(filePath);
    const review = this.state;
    if (!file || !review) {
      return;
    }

    const edits = this.localEdits[review.id] ?? {};
    if (editedText === file.mrText) {
      delete edits[filePath];
    } else {
      edits[filePath] = { filePath, editedText, updatedAt: new Date().toISOString() };
    }

    this.localEdits[review.id] = edits;
    await this.persistLocalEdits();
    this.onDidChangeEmitter.fire();
  }

  async clearLocalEdit(filePath: string): Promise<void> {
    if (!this.state || !this.getLocalEdit(this.state.id, filePath)) {
      return;
    }

    delete this.localEdits[this.state.id][filePath];
    await this.persistLocalEdits();
    this.onDidChangeEmitter.fire();
  }

  private getFileSummary(file: ReviewFile): FileSummary {
    const diff = countLineDiff(file.oldText, file.mrText);
    const threads = this.getThreadsForFile(file.path);
    const resolvedThreadCount = threads.filter((thread) => thread.resolvable !== false && thread.resolved).length;
    const localEdit = this.state ? this.getLocalEdit(this.state.id, file.path) : undefined;

    return {
      path: file.path,
      language: file.language,
      additions: diff.additions,
      deletions: diff.deletions,
      threadCount: threads.length,
      resolvedThreadCount,
      unresolvedThreadCount: threads.filter((thread) => thread.resolvable !== false).length - resolvedThreadCount,
      hasLocalEdit: Boolean(localEdit && localEdit.editedText !== file.mrText),
      localEditUpdatedAt: localEdit?.updatedAt
    };
  }

  private getThreadsForFile(filePath: string): ReviewThread[] {
    return (this.state?.threads ?? [])
      .filter((thread) => thread.filePath === filePath)
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }

  private getSelectedReference(): MergeRequestReference | undefined {
    const saved = this.selectedReference;
    if (saved?.projectId && Number.isInteger(saved.iid) && saved.iid > 0) {
      return saved;
    }

    const configuration = vscode.workspace.getConfiguration("gitlabReview");
    const projectId = configuration.get<string>("projectId", "").trim();
    const iid = Number(configuration.get<string>("mergeRequestIid", ""));
    if (projectId && Number.isInteger(iid) && iid > 0) {
      return { projectId, iid };
    }

    return undefined;
  }

  private getClient(): GitLabReviewClient {
    const baseUrl = vscode.workspace
      .getConfiguration("gitlabReview")
      .get<string>("gitlabBaseUrl", "https://gitlab.com");
    const hostname = getGitLabHostname(baseUrl);
    if (!hostname) {
      throw new Error("Invalid GitLab host.");
    }
    return new GitLabReviewClient(hostname);
  }

  private findFile(filePath: string): ReviewFile | undefined {
    return this.state?.files.find((file) => file.path === filePath);
  }

  private replaceThread(threadId: string, replacement: ReviewThread): void {
    const index = this.state?.threads.findIndex((thread) => thread.id === threadId) ?? -1;
    if (index >= 0 && this.state) {
      this.state.threads[index] = replacement;
    }
  }

  private branchCacheKey(review: ReviewState, branch: string): string {
    return `${review.id}:${branch}`;
  }

  private getLocalEdit(reviewId: string, filePath: string): LocalEdit | undefined {
    return this.localEdits[reviewId]?.[filePath];
  }

  private persistLocalEdits(): Thenable<void> {
    return this.context.workspaceState.update(REVIEW_CACHE_KEYS.localEdits, this.localEdits);
  }

  private persistReviewState(): void {
    if (!this.state) {
      return;
    }
    try {
      if (JSON.stringify(this.state).length <= cacheLimits.reviewStateCharacters) {
        this.persistBestEffort(REVIEW_CACHE_KEYS.reviewState, this.state);
      } else {
        this.persistBestEffort(REVIEW_CACHE_KEYS.reviewState, undefined);
      }
    } catch {
      // Keep the in-memory state if it cannot be serialized.
    }
  }

  private cacheReviewState(state: ReviewState): void {
    const key = reviewStateCacheKey(state.projectId, state.mergeRequestIid);
    this.reviewStateCache.delete(key);
    this.reviewStateCache.set(key, state);
    while (this.reviewStateCache.size > cacheLimits.reviewStates) {
      const oldest = this.reviewStateCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.reviewStateCache.delete(oldest);
    }
  }

  private getCachedReviewState(reference: MergeRequestReference): ReviewState | undefined {
    const key = reviewStateCacheKey(reference.projectId, reference.iid);
    const cached = this.reviewStateCache.get(key);
    if (cached) {
      this.reviewStateCache.delete(key);
      this.reviewStateCache.set(key, cached);
    }
    return cached;
  }

  private hydrateMap<T>(
    target: Map<string, T>,
    timestamps: Map<string, number>,
    entries: CacheEntry<T>[],
    limit: number
  ): void {
    entries
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit)
      .forEach((entry) => {
        target.set(entry.key, entry.value);
        timestamps.set(entry.key, entry.updatedAt);
      });
  }

  private setLimitedCache<T>(
    target: Map<string, T>,
    timestamps: Map<string, number>,
    key: string,
    value: T,
    limit: number
  ): void {
    target.set(key, value);
    timestamps.set(key, Date.now());
    while (target.size > limit) {
      const oldest = [...target.keys()].sort(
        (left, right) => (timestamps.get(left) ?? 0) - (timestamps.get(right) ?? 0)
      )[0];
      target.delete(oldest);
      timestamps.delete(oldest);
    }
  }

  private trimBranchFileCharacters(): void {
    let total = [...this.branchFileCache.values()].reduce((sum, file) => sum + file.content.length, 0);
    while (total > cacheLimits.branchFileCharacters && this.branchFileCache.size > 1) {
      const oldest = [...this.branchFileCache.keys()].sort(
        (left, right) => (this.branchFileCacheTimes.get(left) ?? 0) - (this.branchFileCacheTimes.get(right) ?? 0)
      )[0];
      total -= this.branchFileCache.get(oldest)?.content.length ?? 0;
      this.branchFileCache.delete(oldest);
      this.branchFileCacheTimes.delete(oldest);
    }
  }

  private trimCommitDiffCharacters(): void {
    let total = [...this.commitDiffCache.values()].reduce((sum, files) => sum + commitDiffSize(files), 0);
    while (total > cacheLimits.commitDiffCharacters && this.commitDiffCache.size > 1) {
      const oldest = [...this.commitDiffCache.keys()].sort(
        (left, right) => (this.commitDiffCacheTimes.get(left) ?? 0) - (this.commitDiffCacheTimes.get(right) ?? 0)
      )[0];
      total -= commitDiffSize(this.commitDiffCache.get(oldest) ?? []);
      this.commitDiffCache.delete(oldest);
      this.commitDiffCacheTimes.delete(oldest);
    }
  }

  private persistCommitDiffCache(): void {
    let total = 0;
    const entries: CacheEntry<CommitDiffFile[]>[] = [...this.commitDiffCache]
      .map(([key, value]) => ({ key, value, updatedAt: this.commitDiffCacheTimes.get(key) ?? Date.now() }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .filter((entry) => {
        const size = commitDiffSize(entry.value);
        if (size > cacheLimits.commitDiffCharacters || total + size > cacheLimits.commitDiffCharacters) {
          return false;
        }
        total += size;
        return true;
      });
    this.persistBestEffort(REVIEW_CACHE_KEYS.commitDiffs, entries);
  }

  private persistMapCacheBestEffort<T>(
    key: string,
    values: Map<string, T>,
    timestamps: Map<string, number>
  ): void {
    const entries: CacheEntry<T>[] = [...values].map(([cacheKey, value]) => ({
      key: cacheKey,
      value,
      updatedAt: timestamps.get(cacheKey) ?? Date.now()
    }));
    this.persistBestEffort(key, entries);
  }

  private persistBestEffort(key: string, value: unknown): void {
    void Promise.resolve(this.context.workspaceState.update(key, value)).catch(() => {
      // A storage failure must not turn a successful GitLab request into a UI failure.
    });
  }
}

function toMergeRequestOption(state: ReviewState): MergeRequestOption {
  return {
    projectId: state.projectId,
    iid: state.mergeRequestIid,
    state: state.state ?? "opened",
    title: state.title,
    sourceBranch: state.sourceBranch,
    targetBranch: state.targetBranch,
    author: state.author,
    webUrl: state.webUrl
  };
}

function buildCommitPatchLines(diff: string, threads: readonly ReviewThread[]): ReviewLine[] {
  const byNewLine = new Map<number, ReviewThread[]>();
  const byOldLine = new Map<number, ReviewThread[]>();
  for (const thread of threads) {
    const newLine = thread.newLine ?? thread.line;
    if (typeof newLine === "number") {
      byNewLine.set(newLine, [...(byNewLine.get(newLine) ?? []), thread]);
    }
    if (typeof thread.oldLine === "number") {
      byOldLine.set(thread.oldLine, [...(byOldLine.get(thread.oldLine) ?? []), thread]);
    }
  }

  return parseCommitDiff(diff).map((line, index) => {
    const kind: ReviewLineKind = line.kind === "added"
      ? "mr-added"
      : line.kind === "deleted"
        ? "mr-removed"
        : "context";
    const lineThreads = line.kind === "deleted"
      ? byOldLine.get(line.oldLine ?? -1) ?? []
      : byNewLine.get(line.newLine ?? -1) ?? [];
    const text = line.kind === "added" || line.kind === "deleted" || line.kind === "context"
      ? line.text.slice(1)
      : line.text;
    return {
      id: `commit-${index}`,
      kind,
      text,
      oldLine: line.oldLine,
      mrLine: line.newLine,
      localLine: line.newLine,
      threads: lineThreads
    };
  });
}

function sameReference(
  left: MergeRequestReference | undefined,
  right: MergeRequestReference | undefined
): boolean {
  return Boolean(left && right && left.projectId === right.projectId && left.iid === right.iid);
}

function stateMatchesReference(
  state: ReviewState,
  reference: MergeRequestReference,
  loadedReference: MergeRequestReference | undefined
): boolean {
  return state.mergeRequestIid === reference.iid
    && (state.projectId === reference.projectId || sameReference(loadedReference, reference));
}

function reviewStateCacheKey(projectId: string, mergeRequestIid: number): string {
  return `${projectId}:${mergeRequestIid}`;
}

function workspaceAssociationKey(projectId: string, mergeRequestIid: number): string {
  return `${projectId}!${mergeRequestIid}`;
}

function normalizeThreadSortOrder(order: string | undefined): ReviewThreadSortOrder {
  return order === "oldest" || order === "newest" || order === "open-first" ? order : "open-first";
}

function commitDiffSize(files: readonly CommitDiffFile[]): number {
  return files.reduce(
    (total, file) => total + file.diff.length + file.oldPath.length + file.newPath.length,
    0
  );
}

function pendingId(kind: string): string {
  return `${kind}-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
