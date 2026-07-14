import * as vscode from "vscode";
import { GitLabFileContentError, GitLabReviewClient } from "./gitlabApi";
import { getGitLabHostname } from "./glabAuthUtils";
import { inferLanguage } from "./gitlabMappers";
import { buildReviewLines, buildReviewLinesFromPatch, countLineDiff, countPatchDiff } from "./diffUtils";
import { editedTimestamp } from "./commentUtils";
import { buildReviewLinesAsync, shouldBuildReviewLinesInWorker } from "./reviewDiffWorkerClient";
import { ReviewThreadSortOrder, sortReviewThreads } from "./reviewTreeUtils";
import { detectReviewUpdateRange } from "./reviewUpdateUtils";
import {
  BranchFileContent,
  CommitDiffFile,
  CommitFileContents,
  CommitFileReviewContext,
  NewChangesFileReviewContext,
  FileReviewViewModel,
  FileSummary,
  LocalEdit,
  MergeRequestOption,
  ReviewDraftNote,
  ReviewFile,
  ReviewFileContents,
  ReviewFileView,
  ReviewLine,
  ReviewLoadState,
  ReviewOverview,
  ReviewState,
  ReviewSubmissionMode,
  ReviewThread,
  ReviewThreadSummary,
  ReviewUpdateRange,
  RepositoryTreeEntry
} from "./reviewTypes";
import type { MergeRequestWorkspaceAssociation } from "./localGitTypes";

export const REVIEW_CACHE_KEYS = {
  localEdits: "gitlabReview.localEdits.v2",
  selectedMergeRequest: "gitlabReview.selectedMergeRequest",
  reviewState: "gitlabReview.cache.reviewState.v1",
  lightweightReviewState: "gitlabReview.cache.reviewState.v2",
  branchTrees: "gitlabReview.cache.branchTrees.v1",
  branchFiles: "gitlabReview.cache.branchFiles.v1",
  commitDiffs: "gitlabReview.cache.commitDiffs.v1",
  threadSortOrder: "gitlabReview.threadSortOrder.v1",
  workspaceAssociations: "gitlabReview.workspaceAssociations.v1",
  newChanges: "gitlabReview.newChanges.v1"
} as const;

const cacheLimits = {
  reviewStates: 3,
  branchTrees: 8,
  branchTreeEntries: 2_000,
  branchFiles: 20,
  branchFileCharacters: 2_000_000,
  commitDiffs: 12,
  commitDiffCharacters: 2_000_000,
  reviewStateCharacters: 8_000_000,
  reviewFileContentCharacters: 16_000_000,
  reviewFileContents: 12,
  reviewLineCharacters: 16_000_000,
  reviewLineEntries: 12,
  lineWindow: 1_200
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

interface ReviewFileViewOptions {
  windowStart?: number;
  targetLine?: number;
  includeEditableText?: boolean;
  fullFileStateOverride?: FileReviewViewModel["fullFileState"];
  fullFileMessage?: string;
}

interface CachedReviewFileContents {
  contents: ReviewFileContents;
  characters: number;
  updatedAt: number;
}

interface CachedReviewLines {
  lines: ReviewLine[];
  characters: number;
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
  private newChanges?: ReviewUpdateRange;
  private readonly reviewFileContentCache = new Map<string, CachedReviewFileContents>();
  private readonly reviewFileContentLoads = new Map<string, Promise<ReviewFileContents>>();
  private readonly reviewFileContentErrors = new Map<string, { state: FileReviewViewModel["fullFileState"]; message: string }>();
  private readonly reviewLineCache = new Map<string, CachedReviewLines>();
  private readonly reviewLineLoads = new Map<string, Promise<void>>();
  private readonly reviewLineFailures = new Set<string>();
  private reviewFileContentCharacters = 0;
  private reviewLineCharacters = 0;
  private overviewRevision = 0;
  private overviewCache?: { revision: number; value: ReviewOverview };
  private threadIndex?: Map<string, ReviewThread[]>;
  private fileIndex?: Map<string, ReviewFile>;

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly baseUrlProvider: () => string = () =>
      vscode.workspace.getConfiguration("gitlabReview").get<string>("gitlabBaseUrl", "https://gitlab.com")
  ) {
    const cachedState = normalizeCachedReviewState(
      this.context.workspaceState.get<unknown>(REVIEW_CACHE_KEYS.lightweightReviewState)
      ?? this.context.workspaceState.get<unknown>(REVIEW_CACHE_KEYS.reviewState)
    );
    this.state = cachedState
      ? {
          ...cachedState,
          commits: cachedState.commits ?? [],
          reviewers: cachedState.reviewers ?? [],
          draftNotes: cachedState.draftNotes ?? [],
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
    const cachedNewChanges = this.context.workspaceState.get<ReviewUpdateRange>(REVIEW_CACHE_KEYS.newChanges);
    this.newChanges = cachedNewChanges && this.state?.diffRefs?.headSha === cachedNewChanges.toSha
      && this.state.projectId === cachedNewChanges.projectId
      && this.state.mergeRequestIid === cachedNewChanges.mergeRequestIid
      ? cachedNewChanges
      : undefined;
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
    if (this.overviewCache?.revision === this.overviewRevision) {
      return this.overviewCache.value;
    }
    const files = this.state?.files.map((file) => this.getFileSummary(file)) ?? [];
    const additions = files.reduce((total, file) => total + file.additions, 0);
    const deletions = files.reduce((total, file) => total + file.deletions, 0);
    const sortedThreads = sortReviewThreads(this.state?.threads ?? [], this.threadSortOrder);
    const resolvableThreads = sortedThreads.filter((thread) => thread.resolvable !== false);
    const resolvedThreads = resolvableThreads.filter((thread) => thread.resolved).length;
    const unresolvedThreads = resolvableThreads.length - resolvedThreads;
    const threads = sortedThreads.map(toReviewThreadSummary);

    const value: ReviewOverview = {
      loadState: this.loadState,
      isRefreshing: this.isRefreshing,
      errorMessage: this.errorMessage,
      selectedMergeRequest: this.state ? toMergeRequestOption(this.state) : undefined,
      threadSortOrder: this.threadSortOrder,
      title: this.state?.title ?? "",
      sourceBranch: this.state?.sourceBranch ?? "",
      targetBranch: this.state?.targetBranch ?? "",
      author: this.state?.author ?? "",
      reviewers: this.state?.reviewers ?? [],
      commits: this.state?.commits ?? [],
      files,
      threads,
      draftNotes: this.state?.draftNotes ?? [],
      totalComments: threads.reduce((total, thread) => total + thread.commentCount, 0),
      unresolvedThreads,
      resolvedThreads,
      additions,
      deletions,
      newChanges: this.newChanges
    };
    this.overviewCache = { revision: this.overviewRevision, value };
    return value;
  }

  getThreadDetails(threadIds: readonly string[]): ReviewThread[] {
    if (!this.state || threadIds.length === 0) return [];
    const requested = new Set(threadIds);
    return this.state.threads.filter((thread) => requested.has(thread.id));
  }

  getNewChanges(): ReviewUpdateRange | undefined {
    return this.newChanges;
  }

  getWorkspaceAssociation(projectId: string, mergeRequestIid: number): MergeRequestWorkspaceAssociation | undefined {
    return this.workspaceAssociations[workspaceAssociationKey(projectId, mergeRequestIid)];
  }

  async rememberWorkspaceAssociation(association: MergeRequestWorkspaceAssociation): Promise<void> {
    const key = workspaceAssociationKey(association.projectId, association.mergeRequestIid);
    this.workspaceAssociations[key] = { ...association };
    await this.context.workspaceState.update(REVIEW_CACHE_KEYS.workspaceAssociations, this.workspaceAssociations);
  }

  getFileViewModel(filePath: string, options: ReviewFileViewOptions = {}): FileReviewViewModel | undefined {
    const file = this.findFile(filePath);
    if (!file || !this.state) {
      return undefined;
    }

    const localEdit = this.getLocalEdit(this.state.id, filePath);
    const threads = this.getThreadsForFile(filePath);
    const contentKey = reviewFileContentKey(this.state, file);
    const cachedContents = this.reviewFileContentCache.get(contentKey);
    if (cachedContents) cachedContents.updatedAt = Date.now();
    const contents = cachedContents?.contents;
    const lineKey = this.reviewLineCacheKey(this.state, file, Boolean(contents), localEdit, threads);
    let allLines = this.reviewLineCache.get(lineKey)?.lines;
    let contentMode: FileReviewViewModel["contentMode"] = contents ? "full" : "patch";
    if (!allLines) {
      if (contents && shouldBuildReviewLinesInWorker(contents.oldText, contents.mrText, localEdit?.editedText)) {
        this.prepareReviewLines(lineKey, contents.oldText, contents.mrText, localEdit?.editedText, threads);
        allLines = buildReviewLinesFromPatch(file.patch, threads);
        contentMode = "patch";
      } else {
        allLines = contents
          ? buildReviewLines(contents.oldText, contents.mrText, localEdit?.editedText, threads)
          : buildReviewLinesFromPatch(file.patch, threads);
        this.cacheReviewLines(lineKey, allLines);
      }
    } else {
      const cached = this.reviewLineCache.get(lineKey);
      if (cached) cached.updatedAt = Date.now();
    }

    let start = Math.max(0, Math.floor(options.windowStart ?? 0));
    if (typeof options.targetLine === "number") {
      const targetIndex = allLines.findIndex((line) => line.mrLine === options.targetLine || line.oldLine === options.targetLine);
      if (targetIndex >= 0) start = Math.max(0, targetIndex - Math.floor(cacheLimits.lineWindow / 3));
    }
    start = Math.min(start, Math.max(0, allLines.length - 1));
    const end = Math.min(allLines.length, start + cacheLimits.lineWindow);
    const windowLines = allLines.slice(start, end);
    const visibleThreadIds = new Set(windowLines.flatMap((line) => line.threadIds));
    const contentError = this.reviewFileContentErrors.get(contentKey);
    const fullFileState = options.fullFileStateOverride
      ?? (contents ? "loaded" : file.tooLarge ? "too-large" : contentError?.state ?? "not-loaded");
    return {
      file: toReviewFileView(file),
      summary: this.getFileSummary(file),
      threads: options.includeEditableText
        ? threads
        : threads.filter((thread) => visibleThreadIds.has(thread.id)),
      lines: windowLines,
      editableText: options.includeEditableText && contents
        ? localEdit?.editedText ?? contents.mrText
        : undefined,
      hasLocalEdit: Boolean(localEdit),
      localEditUpdatedAt: localEdit?.updatedAt,
      contentMode,
      fullFileState,
      fullFileMessage: options.fullFileMessage
        ?? contentError?.message
        ?? (file.tooLarge ? "GitLab marked this file as too large to display." : undefined),
      lineWindow: {
        start,
        end,
        total: allLines.length,
        hasPrevious: start > 0,
        hasNext: end < allLines.length
      }
    };
  }

  async loadReviewFileContents(filePath: string): Promise<ReviewFileContents> {
    const review = this.state;
    const file = this.findFile(filePath);
    if (!review || !file) throw new Error("The review file is unavailable.");
    const cacheKey = reviewFileContentKey(review, file);
    const cached = this.reviewFileContentCache.get(cacheKey);
    if (cached) {
      cached.updatedAt = Date.now();
      return cached.contents;
    }
    const existing = this.reviewFileContentLoads.get(cacheKey);
    if (existing) return existing;

    const reviewId = review.id;
    this.reviewFileContentErrors.delete(cacheKey);
    const load = this.getClient().loadMergeRequestFileContents(review, file)
      .then((contents) => {
        if (this.state?.id !== reviewId) throw new Error("The selected merge request changed while loading the file.");
        const threads = this.getThreadsForFile(filePath);
        const localEdit = this.getLocalEdit(review.id, filePath);
        return buildReviewLinesAsync(contents.oldText, contents.mrText, localEdit?.editedText, threads)
          .then((lines) => {
            if (this.state?.id !== reviewId) throw new Error("The selected merge request changed while calculating the diff.");
            this.cacheReviewFileContents(cacheKey, contents);
            this.cacheReviewLines(this.reviewLineCacheKey(review, file, true, localEdit, threads), lines);
            this.reviewFileContentErrors.delete(cacheKey);
            return contents;
          });
      })
      .catch((error: unknown) => {
        if (this.state?.id === reviewId) {
          const state = error instanceof GitLabFileContentError ? error.code : "error";
          this.reviewFileContentErrors.set(cacheKey, {
            state: state === "unavailable" ? "error" : state,
            message: error instanceof Error ? error.message : "Could not load the full file."
          });
        }
        throw error;
      })
      .finally(() => this.reviewFileContentLoads.delete(cacheKey));
    this.reviewFileContentLoads.set(cacheKey, load);
    return load;
  }

  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.isRefreshing = true;
    if (!this.state) {
      this.loadState = "loading";
    }
    this.errorMessage = undefined;
    this.emitChange();

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
          const loadedState = await client.loadMergeRequest(reference, fallbackCommits, previousState?.draftNotes ?? []);
          if (generation !== this.refreshGeneration) return;
          this.updateNewChanges(previousState, loadedState);
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
        this.emitChange();
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
    if (this.newChanges && (this.newChanges.projectId !== projectId || this.newChanges.mergeRequestIid !== iid)) {
      this.setNewChanges(undefined);
    }
    this.lastLoadedReference = undefined;
    this.loadState = "loading";
    this.errorMessage = undefined;
    this.emitChange();
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
          this.emitChange();
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
    this.emitChange();
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
    const contents = await this.getClient().loadCommitFileContents(review.projectId, commitId, file);
    const threads = this.getThreadsForFile(file.path);
    const threadLayout = threads
      .map((thread) => `${thread.id}:${thread.oldLine ?? ""}:${thread.newLine ?? thread.line ?? ""}`)
      .join("|");
    const lines = await buildReviewLinesAsync(contents.oldText, contents.newText, undefined, threads);
    this.cacheReviewLines(`commit:${commitId}:${file.path}:full:${threadLayout}`, lines);
    return contents;
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

  async loadNewChangesFileReviewContext(filePath: string): Promise<NewChangesFileReviewContext | undefined> {
    const review = this.state;
    const range = this.newChanges;
    if (!review || !range || review.projectId !== range.projectId || review.diffRefs?.headSha !== range.toSha) {
      return undefined;
    }
    const cacheKey = `compare:${review.projectId}:${range.fromSha}:${range.toSha}`;
    let files = this.commitDiffCache.get(cacheKey);
    if (!files) {
      files = await this.getClient().compareCommits(review.projectId, range.fromSha, range.toSha);
      this.setLimitedCache(
        this.commitDiffCache,
        this.commitDiffCacheTimes,
        cacheKey,
        files,
        cacheLimits.commitDiffs
      );
      this.trimCommitDiffCharacters();
      this.persistCommitDiffCache();
    }
    const file = files.find((candidate) => candidate.path === filePath || candidate.oldPath === filePath || candidate.newPath === filePath);
    return file ? { range, file } : undefined;
  }

  async loadNewChangesFileContents(context: NewChangesFileReviewContext): Promise<CommitFileContents> {
    const review = this.state;
    if (!review || this.newChanges?.fromSha !== context.range.fromSha || this.newChanges.toSha !== context.range.toSha) {
      throw new Error("The new changes comparison is no longer current.");
    }
    const contents = await this.getClient().loadComparisonFileContents(
      review.projectId,
      context.range.fromSha,
      context.range.toSha,
      context.file
    );
    const threads = this.getThreadsForFile(context.file.path);
    const threadLayout = threads
      .map((thread) => `${thread.id}:${thread.oldLine ?? ""}:${thread.newLine ?? thread.line ?? ""}`)
      .join("|");
    const lines = await buildReviewLinesAsync(contents.oldText, contents.newText, undefined, threads);
    this.cacheReviewLines(`commit:compare:${context.range.fromSha}:${context.range.toSha}:${context.file.path}:full:${threadLayout}`, lines);
    context.contents = contents;
    return contents;
  }

  buildNewChangesFileViewModel(
    context: NewChangesFileReviewContext,
    options: ReviewFileViewOptions = {}
  ): FileReviewViewModel {
    return this.buildCommitFileViewModel({
      commit: {
        id: `compare:${context.range.fromSha}:${context.range.toSha}`,
        shortId: context.range.toSha.slice(0, 8),
        title: "New changes",
        authorName: "",
        authoredAt: "",
        committedAt: ""
      },
      file: context.file,
      contents: context.contents
    }, options);
  }

  buildCommitFileViewModel(
    context: CommitFileReviewContext,
    options: ReviewFileViewOptions = {}
  ): FileReviewViewModel {
    const reviewFile = this.findFile(context.file.path);
    const threads = this.getThreadsForFile(context.file.path);
    const counts = countPatchDiff(context.file.diff);
    const file: ReviewFile = reviewFile ?? {
      path: context.file.path,
      language: inferLanguage(context.file.path),
      oldPath: context.file.oldPath,
      newPath: context.file.newPath,
      patch: context.file.diff,
      status: context.file.status,
      newFile: context.file.newFile,
      deletedFile: context.file.deletedFile,
      renamedFile: context.file.renamedFile,
      collapsed: context.file.collapsed,
      tooLarge: context.file.tooLarge,
      generatedFile: false,
      ...counts
    };
    const threadLayout = threads
      .map((thread) => `${thread.id}:${thread.oldLine ?? ""}:${thread.newLine ?? thread.line ?? ""}`)
      .join("|");
    const lineKey = `commit:${context.commit.id}:${context.file.path}:${context.contents ? "full" : "patch"}:${threadLayout}`;
    let allLines = this.reviewLineCache.get(lineKey)?.lines;
    let contentMode: FileReviewViewModel["contentMode"] = context.contents ? "full" : "patch";
    if (!allLines) {
      if (context.contents && shouldBuildReviewLinesInWorker(context.contents.oldText, context.contents.newText)) {
        this.prepareReviewLines(lineKey, context.contents.oldText, context.contents.newText, undefined, threads);
        allLines = buildReviewLinesFromPatch(context.file.diff, threads);
        contentMode = "patch";
      } else {
        allLines = context.contents
          ? buildReviewLines(context.contents.oldText, context.contents.newText, undefined, threads)
          : buildReviewLinesFromPatch(context.file.diff, threads);
        this.cacheReviewLines(lineKey, allLines);
      }
    }
    let start = Math.max(0, Math.floor(options.windowStart ?? 0));
    if (typeof options.targetLine === "number") {
      const targetIndex = allLines.findIndex((line) => line.mrLine === options.targetLine || line.oldLine === options.targetLine);
      if (targetIndex >= 0) start = Math.max(0, targetIndex - Math.floor(cacheLimits.lineWindow / 3));
    }
    start = Math.min(start, Math.max(0, allLines.length - 1));
    const end = Math.min(allLines.length, start + cacheLimits.lineWindow);
    const windowLines = allLines.slice(start, end);
    const visibleThreadIds = new Set(windowLines.flatMap((line) => line.threadIds));
    const visibleCounts = counts;
    return {
      file: toReviewFileView(file),
      summary: {
        path: file.path,
        language: file.language,
        ...visibleCounts,
        threadCount: threads.length,
        unresolvedThreadCount: threads.filter((thread) => !thread.resolved).length,
        resolvedThreadCount: threads.filter((thread) => thread.resolved).length,
        hasLocalEdit: false
      },
      threads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
      lines: windowLines,
      editableText: options.includeEditableText ? context.contents?.newText : undefined,
      hasLocalEdit: false,
      contentMode,
      fullFileState: options.fullFileStateOverride
        ?? (context.contents ? "loaded" : context.file.tooLarge ? "too-large" : "not-loaded"),
      fullFileMessage: options.fullFileMessage
        ?? (context.file.tooLarge ? "GitLab marked this file as too large to display." : undefined),
      lineWindow: {
        start,
        end,
        total: allLines.length,
        hasPrevious: start > 0,
        hasNext: end < allLines.length
      }
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
    this.emitChange();

    try {
      const confirmedComment = await this.getClient().addReply(review, threadId, trimmed);
      const index = thread.comments.findIndex((comment) => comment.id === pendingComment.id);
      if (index >= 0) {
        thread.comments[index] = confirmedComment;
      }
      thread.pending = false;
      this.persistReviewState();
      this.emitChange();
    } catch {
      const index = thread.comments.findIndex((comment) => comment.id === pendingComment.id);
      if (index >= 0) {
        thread.comments.splice(index, 1);
      }
      thread.pending = false;
      this.emitChange();
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
    this.emitChange();

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
      this.emitChange();
    } catch {
      thread.comments[commentIndex] = previous;
      this.emitChange();
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
    this.emitChange();

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
      this.emitChange();
    } catch {
      thread.resolved = previousResolved;
      thread.pending = false;
      this.emitChange();
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
    this.emitChange();

    try {
      const confirmedThread = await this.getClient().createThread(review, file, mrLine, oldLine, trimmed);
      this.replaceThread(pendingThread.id, confirmedThread);
      this.persistReviewState();
      this.emitChange();
    } catch {
      const index = review.threads.findIndex((thread) => thread.id === pendingThread.id);
      if (index >= 0) {
        review.threads.splice(index, 1);
      }
      this.emitChange();
      void vscode.window.showErrorMessage("GitLab のレビューコメントを追加できませんでした。");
    }
  }

  async addOverviewThread(body: string, mode: ReviewSubmissionMode = "comment"): Promise<void> {
    const review = this.state;
    const trimmed = body.trim();
    if (!review || !trimmed) {
      return;
    }

    if (mode === "review") {
      await this.addOverviewDraftNote(review, trimmed);
      return;
    }

    const pendingThread: ReviewThread = {
      id: pendingId("thread"),
      resolved: false,
      resolvable: false,
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
    this.emitChange();

    try {
      const confirmedThread = await this.getClient().createOverviewThread(review, trimmed);
      this.replaceThread(pendingThread.id, confirmedThread);
      this.persistReviewState();
      this.emitChange();
    } catch {
      const index = review.threads.findIndex((thread) => thread.id === pendingThread.id);
      if (index >= 0) {
        review.threads.splice(index, 1);
      }
      this.emitChange();
      void vscode.window.showErrorMessage("GitLab のレビュースレッドを追加できませんでした。");
    }
  }

  async publishReviewDraft(draftId: string): Promise<void> {
    const review = this.state;
    const draft = review?.draftNotes?.find((candidate) => candidate.id === draftId);
    if (!review || !draft || draft.pending) return;

    draft.pending = true;
    this.emitChange();
    try {
      await this.getClient().publishDraftNote(review, draftId);
      review.draftNotes = review.draftNotes?.filter((candidate) => candidate.id !== draftId) ?? [];
      this.persistReviewState();
      this.emitChange();
      await this.refresh();
    } catch {
      draft.pending = false;
      this.emitChange();
      void vscode.window.showErrorMessage("レビューコメントを今すぐ公開できませんでした。");
    }
  }

  async submitReview(): Promise<void> {
    const review = this.state;
    const drafts = review?.draftNotes ?? [];
    if (!review || !drafts.length || drafts.some((draft) => draft.pending)) return;

    drafts.forEach((draft) => { draft.pending = true; });
    this.emitChange();
    try {
      await this.getClient().publishAllDraftNotes(review);
      review.draftNotes = [];
      this.persistReviewState();
      this.emitChange();
      await this.refresh();
    } catch {
      drafts.forEach((draft) => { draft.pending = false; });
      this.emitChange();
      void vscode.window.showErrorMessage("GitLab のレビューを送信できませんでした。");
    }
  }

  private async addOverviewDraftNote(review: ReviewState, body: string): Promise<void> {
    const pendingDraft: ReviewDraftNote = {
      id: pendingId("draft-note"),
      body,
      pending: true
    };
    const drafts = review.draftNotes ?? (review.draftNotes = []);
    drafts.push(pendingDraft);
    this.emitChange();

    try {
      const confirmedDraft = await this.getClient().createOverviewDraftNote(review, body);
      const index = drafts.findIndex((draft) => draft.id === pendingDraft.id);
      if (index >= 0) drafts[index] = confirmedDraft;
      this.persistReviewState();
      this.emitChange();
    } catch {
      const index = drafts.findIndex((draft) => draft.id === pendingDraft.id);
      if (index >= 0) drafts.splice(index, 1);
      this.emitChange();
      void vscode.window.showErrorMessage("コメントを GitLab のレビューに追加できませんでした。");
    }
  }

  async saveLocalEdit(filePath: string, editedText: string): Promise<void> {
    const file = this.findFile(filePath);
    const review = this.state;
    if (!file || !review) {
      return;
    }

    const contents = this.reviewFileContentCache.get(reviewFileContentKey(review, file))?.contents
      ?? await this.loadReviewFileContents(filePath);
    const edits = this.localEdits[review.id] ?? {};
    if (editedText === contents.mrText) {
      delete edits[filePath];
    } else {
      const localEdit = { filePath, editedText, updatedAt: new Date().toISOString() };
      const threads = this.getThreadsForFile(filePath);
      const lines = await buildReviewLinesAsync(contents.oldText, contents.mrText, editedText, threads);
      this.cacheReviewLines(this.reviewLineCacheKey(review, file, true, localEdit, threads), lines);
      edits[filePath] = localEdit;
    }

    this.localEdits[review.id] = edits;
    await this.persistLocalEdits();
    this.emitChange();
  }

  async clearLocalEdit(filePath: string): Promise<void> {
    if (!this.state || !this.getLocalEdit(this.state.id, filePath)) {
      return;
    }

    delete this.localEdits[this.state.id][filePath];
    await this.persistLocalEdits();
    this.emitChange();
  }

  private getFileSummary(file: ReviewFile): FileSummary {
    const threads = this.getThreadsForFile(file.path);
    const resolvedThreadCount = threads.filter((thread) => thread.resolvable !== false && thread.resolved).length;
    const localEdit = this.state ? this.getLocalEdit(this.state.id, file.path) : undefined;

    return {
      path: file.path,
      language: file.language,
      additions: file.additions,
      deletions: file.deletions,
      threadCount: threads.length,
      resolvedThreadCount,
      unresolvedThreadCount: threads.filter((thread) => thread.resolvable !== false).length - resolvedThreadCount,
      hasLocalEdit: Boolean(localEdit),
      localEditUpdatedAt: localEdit?.updatedAt
    };
  }

  private getThreadsForFile(filePath: string): ReviewThread[] {
    if (!this.threadIndex) {
      this.threadIndex = new Map<string, ReviewThread[]>();
      for (const thread of this.state?.threads ?? []) {
        if (!thread.filePath) continue;
        const items = this.threadIndex.get(thread.filePath) ?? [];
        items.push(thread);
        this.threadIndex.set(thread.filePath, items);
      }
      for (const items of this.threadIndex.values()) {
        items.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
      }
    }
    return this.threadIndex.get(filePath) ?? [];
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
    const baseUrl = this.baseUrlProvider();
    const hostname = getGitLabHostname(baseUrl);
    if (!hostname) {
      throw new Error("Invalid GitLab host.");
    }
    return new GitLabReviewClient(hostname);
  }

  private findFile(filePath: string): ReviewFile | undefined {
    if (!this.fileIndex) {
      this.fileIndex = new Map((this.state?.files ?? []).map((file) => [file.path, file]));
    }
    return this.fileIndex.get(filePath);
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

  private reviewLineCacheKey(
    review: ReviewState,
    file: ReviewFile,
    hasContents: boolean,
    localEdit: LocalEdit | undefined,
    threads: readonly ReviewThread[]
  ): string {
    const threadLayout = threads
      .map((thread) => `${thread.id}:${thread.oldLine ?? ""}:${thread.newLine ?? thread.line ?? ""}`)
      .join("|");
    return `${reviewFileContentKey(review, file)}:${hasContents ? "full" : `patch:${file.patch?.length ?? 0}`}:${localEdit?.updatedAt ?? ""}:${threadLayout}`;
  }

  private updateNewChanges(previous: ReviewState | undefined, current: ReviewState): void {
    const detected = detectReviewUpdateRange(previous, current);
    if (detected) {
      this.setNewChanges(detected);
      return;
    }
    if (this.newChanges && (
      this.newChanges.projectId !== current.projectId
      || this.newChanges.mergeRequestIid !== current.mergeRequestIid
      || this.newChanges.toSha !== current.diffRefs?.headSha
    )) {
      this.setNewChanges(undefined);
    }
  }

  private setNewChanges(value: ReviewUpdateRange | undefined): void {
    this.newChanges = value;
    this.persistBestEffort(REVIEW_CACHE_KEYS.newChanges, value);
  }

  private emitChange(): void {
    this.overviewRevision += 1;
    this.overviewCache = undefined;
    this.threadIndex = undefined;
    this.fileIndex = undefined;
    this.onDidChangeEmitter.fire();
  }

  private cacheReviewFileContents(key: string, contents: ReviewFileContents): void {
    const characters = Buffer.byteLength(contents.oldText, "utf8") + Buffer.byteLength(contents.mrText, "utf8");
    const previous = this.reviewFileContentCache.get(key);
    if (previous) this.reviewFileContentCharacters -= previous.characters;
    this.reviewFileContentCache.set(key, { contents, characters, updatedAt: Date.now() });
    this.reviewFileContentCharacters += characters;
    while (
      (this.reviewFileContentCache.size > cacheLimits.reviewFileContents
        || this.reviewFileContentCharacters > cacheLimits.reviewFileContentCharacters)
      && this.reviewFileContentCache.size > 1
    ) {
      const oldest = [...this.reviewFileContentCache]
        .reduce((candidate, entry) => entry[1].updatedAt < candidate[1].updatedAt ? entry : candidate);
      this.reviewFileContentCache.delete(oldest[0]);
      this.reviewFileContentCharacters -= oldest[1].characters;
    }
  }

  private cacheReviewLines(key: string, lines: ReviewLine[]): void {
    const characters = lines.reduce(
      (total, line) => total + Buffer.byteLength(line.text, "utf8") + Buffer.byteLength(line.id, "utf8") + 32,
      0
    );
    const previous = this.reviewLineCache.get(key);
    if (previous) this.reviewLineCharacters -= previous.characters;
    this.reviewLineFailures.delete(key);
    this.reviewLineCache.set(key, { lines, characters, updatedAt: Date.now() });
    this.reviewLineCharacters += characters;
    while (
      (this.reviewLineCache.size > cacheLimits.reviewLineEntries
        || this.reviewLineCharacters > cacheLimits.reviewLineCharacters)
      && this.reviewLineCache.size > 1
    ) {
      const oldest = [...this.reviewLineCache]
        .reduce((candidate, entry) => entry[1].updatedAt < candidate[1].updatedAt ? entry : candidate);
      this.reviewLineCache.delete(oldest[0]);
      this.reviewLineCharacters -= oldest[1].characters;
    }
  }

  private prepareReviewLines(
    key: string,
    oldText: string,
    mrText: string,
    localText: string | undefined,
    threads: readonly ReviewThread[]
  ): void {
    if (this.reviewLineLoads.has(key) || this.reviewLineFailures.has(key)) return;
    let succeeded = false;
    const load = buildReviewLinesAsync(oldText, mrText, localText, threads)
      .then((lines) => {
        this.cacheReviewLines(key, lines);
        succeeded = true;
      })
      .catch(() => {
        // Keep the patch view usable if a very large full-file diff cannot be calculated.
        this.reviewLineFailures.add(key);
        if (this.reviewLineFailures.size > 50) {
          const oldest = this.reviewLineFailures.values().next().value as string | undefined;
          if (oldest) this.reviewLineFailures.delete(oldest);
        }
      })
      .finally(() => {
        this.reviewLineLoads.delete(key);
        if (succeeded) this.emitChange();
      });
    this.reviewLineLoads.set(key, load);
  }

  private persistLocalEdits(): Thenable<void> {
    return this.context.workspaceState.update(REVIEW_CACHE_KEYS.localEdits, this.localEdits);
  }

  private persistReviewState(): void {
    if (!this.state) {
      return;
    }
    const lightweightState: ReviewState = {
      ...this.state,
      files: this.state.files.map(({ patch: _patch, ...file }) => file)
    };
    this.persistBestEffort(REVIEW_CACHE_KEYS.lightweightReviewState, lightweightState);
    this.persistBestEffort(REVIEW_CACHE_KEYS.reviewState, undefined);
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
    while (reviewStatePatchSize(this.reviewStateCache.values()) > cacheLimits.reviewStateCharacters && this.reviewStateCache.size > 1) {
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

function reviewFileContentKey(review: ReviewState, file: ReviewFile): string {
  return `${review.id}:${review.diffRefs?.baseSha ?? ""}:${review.diffRefs?.headSha ?? ""}:${file.oldPath}:${file.newPath}`;
}

function toReviewFileView(file: ReviewFile): ReviewFileView {
  return {
    path: file.path,
    language: file.language,
    oldPath: file.oldPath,
    newPath: file.newPath,
    status: file.status,
    newFile: file.newFile,
    deletedFile: file.deletedFile,
    renamedFile: file.renamedFile,
    collapsed: file.collapsed,
    tooLarge: file.tooLarge,
    generatedFile: file.generatedFile
  };
}

function toReviewThreadSummary(thread: ReviewThread): ReviewThreadSummary {
  const authors = new Map<string, ReviewThreadSummary["authors"][number]>();
  for (const comment of thread.comments) {
    const name = comment.author || "GitLab user";
    const key = comment.authorId ?? name.trim().toLowerCase();
    const current = authors.get(key);
    if (!current || (!current.avatarUrl && comment.avatarUrl)) {
      authors.set(key, { id: comment.authorId, name, avatarUrl: comment.avatarUrl });
    }
  }
  const last = thread.comments.at(-1);
  return {
    id: thread.id,
    filePath: thread.filePath,
    line: thread.line,
    oldLine: thread.oldLine,
    newLine: thread.newLine,
    resolved: thread.resolved,
    resolvable: thread.resolvable,
    pending: thread.pending,
    commentCount: thread.comments.length,
    authors: [...authors.values()],
    lastComment: last ? { author: last.author, createdAt: last.createdAt } : undefined,
    searchText: thread.comments.map((comment) => `${comment.author}\n${comment.body}`).join("\n")
  };
}

function reviewStatePatchSize(states: Iterable<ReviewState>): number {
  let total = 0;
  for (const state of states) {
    for (const file of state.files) total += file.patch?.length ?? 0;
  }
  return total;
}

function normalizeCachedReviewState(value: unknown): ReviewState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ReviewState> & { files?: unknown[]; threads?: ReviewThread[] };
  if (!candidate.id || !candidate.projectId || !candidate.mergeRequestIid || !Array.isArray(candidate.files)) return undefined;
  const files = candidate.files.flatMap((raw): ReviewFile[] => {
    if (!raw || typeof raw !== "object") return [];
    const file = raw as Partial<ReviewFile> & { oldText?: string; mrText?: string };
    if (!file.path) return [];
    const counts = typeof file.additions === "number" && typeof file.deletions === "number"
      ? { additions: file.additions, deletions: file.deletions }
      : countLineDiff(file.oldText ?? "", file.mrText ?? "");
    return [{
      path: file.path,
      language: file.language ?? inferLanguage(file.path),
      oldPath: file.oldPath ?? file.path,
      newPath: file.newPath ?? file.path,
      patch: file.patch,
      status: file.status ?? "modified",
      newFile: file.newFile === true,
      deletedFile: file.deletedFile === true,
      renamedFile: file.renamedFile === true,
      collapsed: file.collapsed === true,
      tooLarge: file.tooLarge === true,
      generatedFile: file.generatedFile === true,
      ...counts
    }];
  });
  return {
    ...(candidate as ReviewState),
    reviewers: candidate.reviewers ?? [],
    commits: candidate.commits ?? [],
    threads: candidate.threads ?? [],
    draftNotes: candidate.draftNotes ?? [],
    files
  };
}

function pendingId(kind: string): string {
  return `${kind}-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
