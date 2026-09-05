import * as vscode from "vscode";
import { GitLabFileContentError, GitLabReviewClient, normalizeReactionName } from "./gitlabApi";
import { getGitLabHostname } from "./glabAuthUtils";
import { inferLanguage } from "./gitlabMappers";
import { buildReviewLines, buildReviewLinesFromPatch, countLineDiff, countPatchDiff } from "./diffUtils";
import { editedTimestamp } from "./commentUtils";
import { buildReviewLinesAsync, shouldBuildReviewLinesInWorker } from "./reviewDiffWorkerClient";
import { ReviewThreadSortOrder, sortReviewThreads } from "./reviewTreeUtils";
import { detectReviewUpdateRange, mergeReviewUpdateRanges } from "./reviewUpdateUtils";
import { cloneReactions, mergeReactionUsers, optimisticallyToggleReaction } from "./reactionUtils";
import {
  calculateReviewProgress,
  isReviewFileNewSinceLastReview,
  isReviewFileViewed,
  normalizeReviewProgressRecords
} from "./reviewProgressUtils";
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
  ReviewComment,
  ReviewFile,
  ReviewFileContents,
  ReviewFileView,
  ReviewLine,
  ReviewLoadState,
  ReviewOverview,
  ReviewProgressByMergeRequest,
  ReviewProgressRecord,
  ReviewState,
  ReviewSubmissionMode,
  ReviewThread,
  ReviewThreadSummary,
  ReviewUpdateRange,
  RepositoryTreeEntry
} from "./reviewTypes";
import type { MergeRequestWorkspaceAssociation } from "./localGitTypes";
import { contextForReview, normalizeInstanceUrl, reviewContextKey, reviewIdentityKey, sameReviewContext, type ReviewContext, type ReviewMutationResult } from "./reviewContext";
import { instanceStorage } from "./reviewStorage";

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
  newChanges: "gitlabReview.newChanges.v1",
  submissionMode: "gitlabReview.submissionMode.v1",
  reviewProgress: "gitlabReview.reviewProgress.v1"
} as const;

const cacheLimits = {
  reviewStates: 3,
  branchTrees: 8,
  branchTreeEntries: 2_000,
  branchFiles: 20,
  branchFileCharacters: 2_000_000,
  commitDiffs: 12,
  commitDiffCharacters: 2_000_000,
  commitFileContents: 12,
  commitFileContentCharacters: 16_000_000,
  comparisonFileContents: 12,
  comparisonFileContentCharacters: 16_000_000,
  reviewStateCharacters: 8_000_000,
  reviewFileContentCharacters: 16_000_000,
  reviewFileContents: 12,
  reviewLineCharacters: 16_000_000,
  reviewLineEntries: 12,
  lineWindow: 1_200
} as const;
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

interface CachedCommitFileContents {
  contents: CommitFileContents;
  characters: number;
  updatedAt: number;
}

export class ReviewStore {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private state?: ReviewState;
  private loadState: ReviewLoadState = "loading";
  private isRefreshing = false;
  private errorMessage?: string;
  private threadSortOrder: ReviewThreadSortOrder = "open-first";
  private submissionMode: ReviewSubmissionMode = "comment";
  private instanceUrl = "";
  private storage!: Pick<vscode.Memento, "get" | "update">;
  private liveContext?: ReviewContext;
  private operationQueue: Promise<unknown> = Promise.resolve();
  private branchCacheGeneration = 0;
  private selectedReference?: MergeRequestReference;
  private lastLoadedReference?: MergeRequestReference;
  private readonly reviewStateCache = new Map<string, ReviewState>();
  private readonly clients = new Map<string, GitLabReviewClient>();
  private reviewProgress: ReviewProgressByMergeRequest = {};
  private refreshGeneration = 0;
  private readonly refreshLoads = new Map<string, Promise<void>>();
  private localEdits: LocalEditsByMergeRequest = {};
  private workspaceAssociations: WorkspaceAssociations = {};
  private readonly branchTreeCache = new Map<string, RepositoryTreeEntry[]>();
  private readonly branchFileCache = new Map<string, BranchFileContent>();
  private readonly branchTreeCacheTimes = new Map<string, number>();
  private readonly branchFileCacheTimes = new Map<string, number>();
  private readonly branchTreeLoads = new Map<string, Promise<RepositoryTreeEntry[]>>();
  private readonly branchFileLoads = new Map<string, Promise<BranchFileContent>>();
  private readonly commitDiffCache = new Map<string, CommitDiffFile[]>();
  private readonly commitDiffCacheTimes = new Map<string, number>();
  private readonly commitDiffLoads = new Map<string, Promise<CommitDiffFile[]>>();
  private readonly commitFileContentCache = new Map<string, CachedCommitFileContents>();
  private readonly commitFileContentLoads = new Map<string, Promise<CommitFileContents>>();
  private readonly comparisonFileContentCache = new Map<string, CachedCommitFileContents>();
  private readonly comparisonFileContentLoads = new Map<string, Promise<CommitFileContents>>();
  private readonly comparisonLoads = new Map<string, Promise<CommitDiffFile[]>>();
  private newChanges?: ReviewUpdateRange;
  private readonly reviewFileContentCache = new Map<string, CachedReviewFileContents>();
  private readonly reviewFileContentLoads = new Map<string, Promise<ReviewFileContents>>();
  private readonly reviewFileContentErrors = new Map<string, { state: FileReviewViewModel["fullFileState"]; message: string }>();
  private readonly reviewLineCache = new Map<string, CachedReviewLines>();
  private readonly reviewLineLoads = new Map<string, Promise<void>>();
  private readonly reviewLineFailures = new Set<string>();
  private readonly reactionLoads = new Map<string, Promise<void>>();
  private readonly reactionMutations = new Set<string>();
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
    this.instanceUrl = this.configuredInstance();
    this.storage = instanceStorage(context.workspaceState, this.instanceUrl);
    this.hydrateStorage();
  }

  private hydrateStorage(): void {
    const cachedState = normalizeCachedReviewState(
      this.storage.get<unknown>(REVIEW_CACHE_KEYS.lightweightReviewState)
    );
    this.state = cachedState?.instanceUrl === this.instanceUrl
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
      this.storage.get<string>(REVIEW_CACHE_KEYS.threadSortOrder)
    );
    this.submissionMode = normalizeSubmissionMode(
      this.storage.get<string>(REVIEW_CACHE_KEYS.submissionMode)
    );
    this.reviewProgress = normalizeReviewProgressRecords(
      this.storage.get<unknown>(REVIEW_CACHE_KEYS.reviewProgress)
    );
    this.selectedReference = this.storage.get<MergeRequestReference>(
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
      this.storage.get<LocalEditsByMergeRequest>(REVIEW_CACHE_KEYS.localEdits) ?? {};
    this.workspaceAssociations =
      this.storage.get<WorkspaceAssociations>(REVIEW_CACHE_KEYS.workspaceAssociations) ?? {};
    const cachedNewChanges = this.storage.get<ReviewUpdateRange>(REVIEW_CACHE_KEYS.newChanges);
    this.newChanges = cachedNewChanges && this.state?.diffRefs?.headSha === cachedNewChanges.toSha
      && this.state.projectId === cachedNewChanges.projectId
      && this.state.mergeRequestIid === cachedNewChanges.mergeRequestIid
      ? cachedNewChanges
      : undefined;
    this.hydrateMap(
      this.branchTreeCache,
      this.branchTreeCacheTimes,
      this.storage.get<CacheEntry<RepositoryTreeEntry[]>[]>(REVIEW_CACHE_KEYS.branchTrees) ?? [],
      cacheLimits.branchTrees
    );
    this.hydrateMap(
      this.branchFileCache,
      this.branchFileCacheTimes,
      this.storage.get<CacheEntry<BranchFileContent>[]>(REVIEW_CACHE_KEYS.branchFiles) ?? [],
      cacheLimits.branchFiles
    );
    this.hydrateMap(
      this.commitDiffCache,
      this.commitDiffCacheTimes,
      this.storage.get<CacheEntry<CommitDiffFile[]>[]>(REVIEW_CACHE_KEYS.commitDiffs) ?? [],
      cacheLimits.commitDiffs
    );
    this.trimCommitDiffCharacters();
    this.loadState = this.state ? "ready" : "loading";
  }

  getOverview(): ReviewOverview {
    this.resetConnection();
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
    const progress = calculateReviewProgress(
      files,
      this.state?.threads ?? [],
      this.getReviewProgressRecord(this.state),
      this.state?.diffRefs?.headSha,
      this.newChanges,
      this.state?.draftNotes?.length ?? 0
    );

    const value: ReviewOverview = {
      reviewContext: this.getReviewContext(),
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
      newChanges: this.newChanges,
      progress
    };
    this.overviewCache = { revision: this.overviewRevision, value };
    return value;
  }

  getReviewContext(): ReviewContext | undefined {
    const current = contextForReview(this.state);
    return this.instanceUrl === this.configuredInstance() && sameReviewContext(current, this.liveContext)
      ? current
      : undefined;
  }

  getProjectIdentity(): string | undefined {
    if (this.instanceUrl !== this.configuredInstance()) return undefined;
    return this.state?.projectPath;
  }

  assertReviewContext(expected: ReviewContext | undefined): void {
    if (!sameReviewContext(expected, this.getReviewContext())) {
      throw new Error("The GitLab instance, merge request, or diff changed. Open the current review and retry; your draft has been kept.");
    }
  }

  invalidateAuthentication(): void {
    this.liveContext = undefined;
    this.clients.clear();
    this.refreshGeneration += 1;
    this.refreshLoads.clear();
    this.isRefreshing = false;
    this.emitChange();
  }

  /** Invalidate immediately, before authentication or any new network request. */
  resetConnection(): void {
    const next = this.configuredInstance();
    if (next === this.instanceUrl) return;
    this.instanceUrl = next;
    this.storage = instanceStorage(this.context.workspaceState, next);
    this.refreshGeneration += 1;
    this.branchCacheGeneration += 1;
    this.liveContext = undefined;
    this.operationQueue = Promise.resolve();
    this.isRefreshing = false;
    this.errorMessage = undefined;
    this.reviewStateCache.clear();
    this.clients.clear();
    for (const cache of [this.refreshLoads, this.branchTreeCache, this.branchFileCache,
      this.branchTreeCacheTimes, this.branchFileCacheTimes, this.branchTreeLoads, this.branchFileLoads,
      this.commitDiffCache, this.commitDiffCacheTimes, this.commitDiffLoads, this.commitFileContentCache,
      this.commitFileContentLoads, this.comparisonFileContentCache, this.comparisonFileContentLoads,
      this.comparisonLoads, this.reviewFileContentCache, this.reviewFileContentLoads,
      this.reviewFileContentErrors, this.reviewLineCache, this.reviewLineLoads, this.reactionLoads]) cache.clear();
    this.reactionMutations.clear();
    this.reviewLineFailures.clear();
    this.reviewFileContentCharacters = 0;
    this.reviewLineCharacters = 0;
    this.hydrateStorage();
    this.emitChange();
  }

  private configuredInstance(): string {
    try { return normalizeInstanceUrl(this.baseUrlProvider()); }
    catch { return ""; }
  }

  private assertSnapshot(review: ReviewState): void {
    if (this.configuredInstance() !== review.instanceUrl || !sameReviewContext(contextForReview(review), contextForReview(this.state))) {
      throw new Error("The selected review changed while loading. Open the current review and retry.");
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.catch(() => undefined);
    return result;
  }

  private runMutation(
    expected: ReviewContext | undefined,
    operation: (review: ReviewState, client: GitLabReviewClient) => Promise<void>
  ): Promise<ReviewMutationResult> {
    // Validate both at receipt and execution: a queued refresh can change the SHA.
    try { this.assertReviewContext(expected); }
    catch (error) { return Promise.resolve({ ok: false, errorMessage: error instanceof Error ? error.message : "Review unavailable." }); }
    return this.enqueue(async () => {
      let review: ReviewState | undefined;
      try {
        this.assertReviewContext(expected);
        review = this.state!;
        const client = this.getClient();
        await operation(review, client);
        if (this.state === review && this.instanceUrl === this.configuredInstance()) this.persistReviewState();
        return { ok: true } as const;
      } catch (error) {
        return { ok: false, errorMessage: error instanceof Error ? error.message : "GitLab could not save this change. Your draft has been kept." } as const;
      } finally {
        if (this.state === review && this.instanceUrl === this.configuredInstance()) this.emitChange();
      }
    });
  }

  getThreadDetails(threadIds: readonly string[]): ReviewThread[] {
    if (!this.state || threadIds.length === 0) return [];
    const requested = new Set(threadIds);
    return this.state.threads.filter((thread) => requested.has(thread.id));
  }

  getNewChanges(): ReviewUpdateRange | undefined {
    return this.newChanges;
  }

  markFileViewed(filePath: string): void {
    const review = this.state;
    if (!review || !review.files.some((file) => file.path === filePath)) return;
    const record = this.getReviewProgressRecord(review);
    const headSha = review.diffRefs?.headSha;
    if (record.viewedFiles.includes(filePath) && (!headSha || record.viewedFileHeads?.[filePath] === headSha)) {
      return;
    }
    if (!record.viewedFiles.includes(filePath)) record.viewedFiles.push(filePath);
    if (headSha) record.viewedFileHeads = { ...record.viewedFileHeads, [filePath]: headSha };
    this.persistReviewProgress();
    this.emitChange();
  }

  markReviewComplete(): void {
    const review = this.state;
    if (!review) return;
    const overview = this.getOverview();
    if (overview.unresolvedThreads > 0 || (review.draftNotes?.length ?? 0) > 0) {
      void vscode.window.showInformationMessage("Resolve open discussions and submit pending review comments first.");
      return;
    }
    const record = this.getReviewProgressRecord(review);
    record.viewedFiles = review.files.map((file) => file.path);
    const headSha = review.diffRefs?.headSha;
    record.viewedFileHeads = headSha
      ? Object.fromEntries(record.viewedFiles.map((filePath) => [filePath, headSha]))
      : undefined;
    record.lastReviewedSha = headSha;
    record.lastReviewedAt = new Date().toISOString();
    if (this.newChanges) this.setNewChanges(undefined);
    this.persistReviewProgress();
    this.emitChange();
  }

  getWorkspaceAssociation(projectId: string, mergeRequestIid: number): MergeRequestWorkspaceAssociation | undefined {
    return this.workspaceAssociations[workspaceAssociationKey(projectId, mergeRequestIid)];
  }

  async rememberWorkspaceAssociation(association: MergeRequestWorkspaceAssociation): Promise<void> {
    const key = workspaceAssociationKey(association.projectId, association.mergeRequestIid);
    this.workspaceAssociations[key] = { ...association };
    await this.storage.update(REVIEW_CACHE_KEYS.workspaceAssociations, this.workspaceAssociations);
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

    this.reviewFileContentErrors.delete(cacheKey);
    const load = this.getClient().loadMergeRequestFileContents(review, file)
      .then((contents) => {
        this.assertSnapshot(review);
        const threads = this.getThreadsForFile(filePath);
        const localEdit = this.getLocalEdit(review.id, filePath);
        return buildReviewLinesAsync(contents.oldText, contents.mrText, localEdit?.editedText, threads)
          .then((lines) => {
            this.assertSnapshot(review);
            this.cacheReviewFileContents(cacheKey, contents);
            this.cacheReviewLines(this.reviewLineCacheKey(review, file, true, localEdit, threads), lines);
            this.reviewFileContentErrors.delete(cacheKey);
            return contents;
          });
      })
      .catch((error: unknown) => {
        if (sameReviewContext(contextForReview(this.state), contextForReview(review))) {
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
    this.resetConnection();
    const reference = this.getSelectedReference();
    const cacheKey = reference ? reviewStateCacheKey(reference.projectId, reference.iid) : undefined;
    if (cacheKey) {
      const existing = this.refreshLoads.get(cacheKey);
      if (existing) return existing;
    }

    const generation = ++this.refreshGeneration;
    const instanceUrl = this.instanceUrl;
    this.isRefreshing = true;
    this.emitChange();
    const load = this.enqueue(() => this.performRefresh(reference, generation, instanceUrl));
    if (!cacheKey) return load;

    this.refreshLoads.set(cacheKey, load);
    void load.then(
      () => {
        if (this.refreshLoads.get(cacheKey) === load) this.refreshLoads.delete(cacheKey);
      },
      () => {
        if (this.refreshLoads.get(cacheKey) === load) this.refreshLoads.delete(cacheKey);
      }
    );
    return load;
  }

  private async performRefresh(reference: MergeRequestReference | undefined, generation: number, instanceUrl: string): Promise<void> {
    if (generation !== this.refreshGeneration || instanceUrl !== this.configuredInstance()) return;
    this.isRefreshing = true;
    if (!this.state) {
      this.loadState = "loading";
    }
    this.errorMessage = undefined;
    this.emitChange();

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
          if (generation !== this.refreshGeneration || instanceUrl !== this.configuredInstance()) return;
          loadedState.instanceUrl = instanceUrl;
          loadedState.id = reviewIdentityKey({ instanceUrl, projectId: loadedState.projectId, mergeRequestIid: loadedState.mergeRequestIid });
          const newChangesToHydrate = this.updateNewChanges(previousState, loadedState);
          this.state = loadedState;
          this.liveContext = contextForReview(loadedState);
          this.branchCacheGeneration += 1;
          this.branchTreeCache.clear();
          this.branchFileCache.clear();
          this.branchTreeCacheTimes.clear();
          this.branchFileCacheTimes.clear();
          this.persistBestEffort(REVIEW_CACHE_KEYS.branchTrees, []);
          this.persistBestEffort(REVIEW_CACHE_KEYS.branchFiles, []);
          this.lastLoadedReference = reference;
          this.cacheReviewState(this.state);
          this.loadState = "ready";
          this.errorMessage = undefined;
          this.persistReviewState();
          if (newChangesToHydrate) void this.hydrateNewChangesPaths(newChangesToHydrate);
        } catch {
          if (generation !== this.refreshGeneration || instanceUrl !== this.configuredInstance()) return;
          this.state = previousState;
          this.lastLoadedReference = previousState ? reference : undefined;
          this.loadState = previousState ? "ready" : "error";
          this.errorMessage = "GitLab の MR を読み込めませんでした。キャッシュを表示しています。";
        }
      }

    } catch {
      if (generation !== this.refreshGeneration || instanceUrl !== this.configuredInstance()) return;
      this.state = previousState;
      this.lastLoadedReference = previousState && reference ? reference : undefined;
      this.loadState = previousState ? "ready" : "error";
      this.errorMessage = "GitLab の MR を読み込めませんでした。キャッシュを表示しています。";
    } finally {
      if (generation === this.refreshGeneration && instanceUrl === this.configuredInstance()) {
        this.isRefreshing = false;
        this.emitChange();
      }
    }
  }

  async selectMergeRequest(projectId: string, iid: number): Promise<void> {
    this.resetConnection();
    if (!projectId || !Number.isInteger(iid) || iid < 1) {
      return;
    }

    const nextReference = { projectId, iid };
    const previousReference = this.selectedReference;
    const cachedState = this.state && stateMatchesReference(this.state, nextReference, this.lastLoadedReference)
      ? this.state
      : this.getCachedReviewState(nextReference);
    if (this.state) this.cacheReviewState(this.state);
    if (!sameReference(previousReference, nextReference)) {
      this.refreshLoads.clear();
    }
    this.state = cachedState;
    this.liveContext = undefined;
    if (this.newChanges && (this.newChanges.projectId !== projectId || this.newChanges.mergeRequestIid !== iid)) {
      this.setNewChanges(undefined);
    }
    this.lastLoadedReference = cachedState ? nextReference : undefined;
    this.loadState = cachedState ? "ready" : "loading";
    this.errorMessage = undefined;
    this.selectedReference = nextReference;
    this.persistBestEffort(REVIEW_CACHE_KEYS.selectedMergeRequest, this.selectedReference);
    this.emitChange();
    await this.refresh();
  }

  async setThreadSortOrder(order: ReviewThreadSortOrder): Promise<void> {
    this.threadSortOrder = normalizeThreadSortOrder(order);
    await this.storage.update(REVIEW_CACHE_KEYS.threadSortOrder, this.threadSortOrder);
    this.emitChange();
  }

  getSubmissionMode(): ReviewSubmissionMode {
    return this.submissionMode;
  }

  setSubmissionMode(mode: ReviewSubmissionMode): void {
    this.submissionMode = normalizeSubmissionMode(mode);
    this.persistBestEffort(REVIEW_CACHE_KEYS.submissionMode, this.submissionMode);
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

    const existing = this.branchTreeLoads.get(cacheKey);
    if (existing) return existing;

    let load: Promise<RepositoryTreeEntry[]>;
    load = this.getClient().listRepositoryTree(review.projectId, branch)
      .then((entries) => {
        this.assertSnapshot(review);
        const boundedEntries = entries.slice(0, cacheLimits.branchTreeEntries);
        this.setLimitedCache(
          this.branchTreeCache,
          this.branchTreeCacheTimes,
          cacheKey,
          boundedEntries,
          cacheLimits.branchTrees
        );
        this.persistMapCacheBestEffort(REVIEW_CACHE_KEYS.branchTrees, this.branchTreeCache, this.branchTreeCacheTimes);
        return boundedEntries;
      })
      .finally(() => {
        if (this.branchTreeLoads.get(cacheKey) === load) this.branchTreeLoads.delete(cacheKey);
      });
    this.branchTreeLoads.set(cacheKey, load);
    return load;
  }

  async loadCommitDiff(commitId: string): Promise<CommitDiffFile[]> {
    const review = this.state;
    if (!review || !review.commits.some((commit) => commit.id === commitId)) {
      throw new Error("The commit is not part of the current merge request.");
    }

    const cacheKey = `${review.instanceUrl}:${review.projectId}:${commitId}`;
    const cached = this.commitDiffCache.get(cacheKey);
    if (cached) {
      this.commitDiffCacheTimes.set(cacheKey, Date.now());
      this.persistCommitDiffCache();
      return cached;
    }

    const existing = this.commitDiffLoads.get(cacheKey);
    if (existing) return existing;

    let load: Promise<CommitDiffFile[]>;
    load = this.getClient().loadCommitDiff(review.projectId, commitId)
      .then((files) => {
        this.assertSnapshot(review);
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
      })
      .finally(() => {
        if (this.commitDiffLoads.get(cacheKey) === load) this.commitDiffLoads.delete(cacheKey);
      });
    this.commitDiffLoads.set(cacheKey, load);
    return load;
  }

  async loadCommitFileContents(commitId: string, file: CommitDiffFile): Promise<CommitFileContents> {
    const review = this.state;
    if (!review || !review.commits.some((commit) => commit.id === commitId)) {
      throw new Error("The commit is not part of the current merge request.");
    }
    const cacheKey = `${review.instanceUrl}:${commitFileContentKey(review.projectId, commitId, file)}`;
    const cached = this.commitFileContentCache.get(cacheKey);
    if (cached) {
      cached.updatedAt = Date.now();
      return cached.contents;
    }
    const existing = this.commitFileContentLoads.get(cacheKey);
    if (existing) return existing;

    let load: Promise<CommitFileContents>;
    load = this.getClient().loadCommitFileContents(review.projectId, commitId, file)
      .then(async (contents) => {
        this.assertSnapshot(review);
        this.cacheCommitFileContents(cacheKey, contents);
        const threads = this.getThreadsForFile(file.path);
        const threadLayout = threads
          .map((thread) => `${thread.id}:${thread.oldLine ?? ""}:${thread.newLine ?? thread.line ?? ""}`)
          .join("|");
        const lines = await buildReviewLinesAsync(contents.oldText, contents.newText, undefined, threads);
        this.assertSnapshot(review);
        this.cacheReviewLines(`commit:${review.id}:${commitId}:${file.path}:full:${threadLayout}`, lines);
        return contents;
      })
      .finally(() => {
        if (this.commitFileContentLoads.get(cacheKey) === load) this.commitFileContentLoads.delete(cacheKey);
      });
    this.commitFileContentLoads.set(cacheKey, load);
    return load;
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
    const files = await this.loadComparisonFiles(range);
    this.applyChangedPaths(range, files);
    const file = files.find((candidate) => candidate.path === filePath || candidate.oldPath === filePath || candidate.newPath === filePath);
    return file ? { range, file } : undefined;
  }

  async loadNewChangesFileContents(context: NewChangesFileReviewContext): Promise<CommitFileContents> {
    const review = this.state;
    if (!review || this.newChanges?.fromSha !== context.range.fromSha || this.newChanges.toSha !== context.range.toSha) {
      throw new Error("The new changes comparison is no longer current.");
    }
    const cacheKey = `${review.instanceUrl}:` + comparisonFileContentKey(
      review.projectId,
      context.range.fromSha,
      context.range.toSha,
      context.file
    );
    const cached = this.comparisonFileContentCache.get(cacheKey);
    if (cached) {
      cached.updatedAt = Date.now();
      context.contents = cached.contents;
      return cached.contents;
    }
    const existing = this.comparisonFileContentLoads.get(cacheKey);
    if (existing) {
      const contents = await existing;
      context.contents = contents;
      return contents;
    }

    let load: Promise<CommitFileContents>;
    load = this.getClient().loadComparisonFileContents(
      review.projectId,
      context.range.fromSha,
      context.range.toSha,
      context.file
    )
      .then(async (contents) => {
        this.assertSnapshot(review);
        this.cacheComparisonFileContents(cacheKey, contents);
        const threads = this.getThreadsForFile(context.file.path);
        const threadLayout = threads
          .map((thread) => `${thread.id}:${thread.oldLine ?? ""}:${thread.newLine ?? thread.line ?? ""}`)
          .join("|");
        const lines = await buildReviewLinesAsync(contents.oldText, contents.newText, undefined, threads);
        this.assertSnapshot(review);
        this.cacheReviewLines(`commit:${review.id}:compare:${context.range.fromSha}:${context.range.toSha}:${context.file.path}:full:${threadLayout}`, lines);
        return contents;
      })
      .finally(() => {
        if (this.comparisonFileContentLoads.get(cacheKey) === load) this.comparisonFileContentLoads.delete(cacheKey);
      });
    this.comparisonFileContentLoads.set(cacheKey, load);
    const contents = await load;
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
    const lineKey = `commit:${this.state?.id}:${context.commit.id}:${context.file.path}:${context.contents ? "full" : "patch"}:${threadLayout}`;
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

    const existing = this.branchFileLoads.get(cacheKey);
    if (existing) return existing;

    let load: Promise<BranchFileContent>;
    load = this.getClient().readRepositoryFile(review.projectId, branch, filePath)
      .then((file) => {
        this.assertSnapshot(review);
        if (file.content.length > cacheLimits.branchFileCharacters) return file;
        this.setLimitedCache(
          this.branchFileCache,
          this.branchFileCacheTimes,
          cacheKey,
          file,
          cacheLimits.branchFiles
        );
        this.trimBranchFileCharacters();
        this.persistMapCacheBestEffort(REVIEW_CACHE_KEYS.branchFiles, this.branchFileCache, this.branchFileCacheTimes);
        return file;
      })
      .finally(() => {
        if (this.branchFileLoads.get(cacheKey) === load) this.branchFileLoads.delete(cacheKey);
      });
    this.branchFileLoads.set(cacheKey, load);
    return load;
  }

  addComment(threadId: string, body: string, expected?: ReviewContext): Promise<ReviewMutationResult> {
    return this.runMutation(expected, async (review, client) => {
      const thread = review.threads.find((item) => item.id === threadId);
      const trimmed = requireCommentBody(body);
      if (!thread || thread.pending) throw new Error("This discussion is no longer available. Your reply has been kept.");
      const pendingComment: ReviewComment = {
        id: pendingId("comment"), author: "you", body: trimmed,
        createdAt: new Date().toISOString(), canEdit: true, pending: true
      };
      thread.comments.push(pendingComment);
      thread.pending = true;
      this.emitChange();
      try {
        const confirmed = await client.addReply(review, threadId, trimmed);
        const index = thread.comments.indexOf(pendingComment);
        if (index >= 0) thread.comments[index] = confirmed;
      } catch (error) {
        thread.comments = thread.comments.filter((comment) => comment !== pendingComment);
        throw error;
      } finally { thread.pending = false; }
    });
  }

  async loadCommentReactions(threadId: string, commentId: string): Promise<void> {
    const expected = this.getReviewContext();
    if (!expected) return;
    return this.enqueue(async () => {
      if (!sameReviewContext(expected, this.getReviewContext())) return;
      await this.loadCommentReactionsSnapshot(threadId, commentId);
    });
  }

  private async loadCommentReactionsSnapshot(threadId: string, commentId: string): Promise<void> {
    const review = this.state;
    const context = this.getReviewContext();
    const comment = this.findComment(threadId, commentId);
    if (!review || !context || !comment || comment.pending || comment.reactionsLoaded || comment.reactionsLoading) return;
    const key = JSON.stringify([review.id, commentId]);
    const existing = this.reactionLoads.get(key);
    if (existing) return existing;
    comment.reactionsLoading = true;
    comment.reactionError = undefined;
    this.emitChange();
    const load = this.getClient().listCommentReactions(review, commentId)
      .then((reactions) => {
        if (this.state !== review || !sameReviewContext(context, this.getReviewContext())) return;
        comment.reactions = reactions;
        comment.reactionsLoaded = true;
        this.persistReviewState();
      })
      .catch(() => {
        if (this.state === review) comment.reactionError = "Could not load reactions.";
      })
      .finally(() => {
        comment.reactionsLoading = false;
        if (this.reactionLoads.get(key) === load) this.reactionLoads.delete(key);
        if (this.state === review) this.emitChange();
      });
    this.reactionLoads.set(key, load);
    return load;
  }

  toggleCommentReaction(threadId: string, commentId: string, name: string, expected?: ReviewContext): Promise<ReviewMutationResult> {
    return this.runMutation(expected, async (review, client) => {
      const thread = review.threads.find((item) => item.id === threadId);
      const comment = thread?.comments.find((item) => item.id === commentId);
      if (!comment || comment.pending) throw new Error("This comment is no longer available.");
      const normalizedName = normalizeReactionName(name);
      if (!comment.reactionsLoaded) {
        comment.reactions = await client.listCommentReactions(review, commentId);
        this.assertReviewContext(expected);
        comment.reactionsLoaded = true;
      }
      const previous = cloneReactions(comment.reactions ?? []);
      const awardId = comment.reactions?.find((reaction) => reaction.name === normalizedName)?.currentUserAwardId;
      comment.reactions = optimisticallyToggleReaction(comment.reactions ?? [], normalizedName, review.currentUserId, Boolean(awardId));
      comment.reactionError = undefined;
      this.emitChange();
      try {
        if (awardId) await client.removeCommentReaction(review, commentId, awardId);
        else {
          const added = await client.addCommentReaction(review, commentId, normalizedName);
          const optimistic = comment.reactions.find((reaction) => reaction.name === normalizedName);
          if (optimistic) {
            optimistic.currentUserAwardId = added.currentUserAwardId;
            optimistic.users = mergeReactionUsers(optimistic.users, added.users);
          }
        }
        const settled = comment.reactions.find((reaction) => reaction.name === normalizedName);
        if (settled) settled.pending = false;
      } catch (error) {
        comment.reactions = previous;
        comment.reactionError = "Could not update the reaction.";
        throw error;
      }
    });
  }

  editComment(threadId: string, commentId: string, body: string, expected?: ReviewContext): Promise<ReviewMutationResult> {
    return this.runMutation(expected, async (review, client) => {
      const thread = review.threads.find((item) => item.id === threadId);
      const index = thread?.comments.findIndex((comment) => comment.id === commentId) ?? -1;
      const comment = thread?.comments[index];
      const trimmed = requireCommentBody(body);
      if (!thread || !comment || !comment.canEdit || comment.pending) throw new Error("This comment cannot be edited. Your draft has been kept.");
      const previous = { ...comment };
      comment.body = trimmed;
      comment.updatedAt = editedTimestamp(comment.createdAt);
      comment.pending = true;
      this.emitChange();
      try {
        const confirmed = await client.updateComment(review, threadId, commentId, trimmed);
        thread.comments[index] = {
          ...previous, ...confirmed, body: confirmed.body || trimmed,
          createdAt: confirmed.createdAt === new Date(0).toISOString() ? previous.createdAt : confirmed.createdAt,
          updatedAt: editedTimestamp(previous.createdAt, confirmed.updatedAt), canEdit: true, pending: false
        };
      } catch (error) {
        thread.comments[index] = previous;
        throw error;
      }
    });
  }

  toggleResolved(threadId: string, expected?: ReviewContext): Promise<ReviewMutationResult> {
    return this.runMutation(expected, async (review, client) => {
      const thread = review.threads.find((item) => item.id === threadId);
      if (!thread || thread.pending || thread.resolvable === false) throw new Error("This discussion cannot be changed.");
      const previousResolved = thread.resolved;
      thread.resolved = !previousResolved;
      thread.pending = true;
      this.emitChange();
      try {
        const confirmed = await client.setResolved(review, threadId, thread.resolved);
        confirmed.comments = confirmed.comments.map((comment) => {
          const previous = thread.comments.find((candidate) => candidate.id === comment.id);
          return previous ? { ...comment, authorId: previous.authorId, updatedAt: comment.updatedAt ?? previous.updatedAt, canEdit: previous.canEdit } : comment;
        });
        const index = review.threads.indexOf(thread);
        if (index >= 0) review.threads[index] = confirmed;
      } catch (error) {
        thread.resolved = previousResolved;
        throw error;
      } finally { thread.pending = false; }
    });
  }

  addThread(filePath: string, mrLine: number, oldLine: number | undefined, body: string,
    mode: ReviewSubmissionMode = this.submissionMode, expected?: ReviewContext): Promise<ReviewMutationResult> {
    return this.runMutation(expected, async (review, client) => {
      const file = review.files.find((item) => item.path === filePath);
      const trimmed = requireCommentBody(body);
      if (!file || !Number.isInteger(mrLine) || mrLine < 1) throw new Error("This line is no longer available. Your draft has been kept.");
      if (mode === "review") {
        await this.createDraftNote(review, () => client.createDraftThread(review, file, mrLine, oldLine, trimmed), trimmed, filePath, mrLine);
      } else {
        await this.createDiscussion(review, () => client.createThread(review, file, mrLine, oldLine, trimmed), trimmed, filePath, mrLine, oldLine);
      }
    });
  }

  addOverviewThread(body: string, mode: ReviewSubmissionMode = "comment", expected?: ReviewContext): Promise<ReviewMutationResult> {
    return this.runMutation(expected, async (review, client) => {
      const trimmed = requireCommentBody(body);
      if (mode === "review") await this.createDraftNote(review, () => client.createOverviewDraftNote(review, trimmed), trimmed);
      else await this.createDiscussion(review, () => client.createOverviewThread(review, trimmed), trimmed);
    });
  }

  private async createDiscussion(review: ReviewState, create: () => Promise<ReviewThread>, body: string,
    filePath?: string, line?: number, oldLine?: number): Promise<void> {
    const pending: ReviewThread = {
      id: pendingId("thread"), filePath, line, oldLine, newLine: line,
      resolved: false, resolvable: Boolean(filePath), pending: true,
      comments: [{ id: pendingId("comment"), author: "you", body, createdAt: new Date().toISOString(), canEdit: true, pending: true }]
    };
    review.threads.push(pending);
    this.emitChange();
    try {
      const confirmed = await create();
      const index = review.threads.indexOf(pending);
      if (index >= 0) review.threads[index] = confirmed;
    } catch (error) {
      review.threads = review.threads.filter((thread) => thread !== pending);
      throw error;
    }
  }

  private async createDraftNote(review: ReviewState, create: () => Promise<ReviewDraftNote>, body: string,
    filePath?: string, line?: number): Promise<void> {
    const pending: ReviewDraftNote = { id: pendingId("draft-note"), body, filePath, line, pending: true };
    const drafts = review.draftNotes ?? (review.draftNotes = []);
    drafts.push(pending);
    this.emitChange();
    try {
      const confirmed = await create();
      const index = drafts.indexOf(pending);
      if (index >= 0) drafts[index] = confirmed;
    } catch (error) {
      const index = drafts.indexOf(pending);
      if (index >= 0) drafts.splice(index, 1);
      throw error;
    }
  }

  publishReviewDraft(draftId: string, expected?: ReviewContext): Promise<ReviewMutationResult> {
    return this.runMutation(expected, async (review, client) => {
      const draft = review.draftNotes?.find((item) => item.id === draftId);
      if (!draft || draft.pending) throw new Error("This draft is no longer available.");
      draft.pending = true;
      this.emitChange();
      try {
        await client.publishDraftNote(review, draftId);
        review.draftNotes = review.draftNotes?.filter((item) => item !== draft) ?? [];
      } finally { draft.pending = false; }
    }).then((result) => {
      if (result.ok && sameReviewContext(expected, this.getReviewContext())) void this.refresh();
      return result;
    });
  }

  submitReview(expected?: ReviewContext): Promise<ReviewMutationResult> {
    return this.runMutation(expected, async (review, client) => {
      const drafts = review.draftNotes ?? [];
      if (!drafts.length || drafts.some((draft) => draft.pending)) throw new Error("There are no ready draft comments to submit.");
      drafts.forEach((draft) => { draft.pending = true; });
      this.emitChange();
      try {
        await client.publishAllDraftNotes(review);
        review.draftNotes = [];
      } finally { drafts.forEach((draft) => { draft.pending = false; }); }
    }).then((result) => {
      if (result.ok && sameReviewContext(expected, this.getReviewContext())) void this.refresh();
      return result;
    });
  }
  async saveLocalEdit(filePath: string, editedText: string): Promise<void> {
    const review = this.state;
    const file = this.findFile(filePath);
    if (!review || !file) {
      throw new Error("The file is no longer available in the selected merge request.");
    }
    const storage = this.storage;
    return this.enqueue(async () => {
      this.assertSnapshot(review);
      const contents = this.reviewFileContentCache.get(reviewFileContentKey(review, file))?.contents
        ?? await this.loadReviewFileContents(filePath);
      this.assertSnapshot(review);
      let localEdit: LocalEdit | undefined;
      if (editedText !== contents.mrText) {
        localEdit = { filePath, editedText, updatedAt: new Date().toISOString() };
        const threads = this.getThreadsForFile(filePath);
        const lines = await buildReviewLinesAsync(contents.oldText, contents.mrText, editedText, threads);
        this.assertSnapshot(review);
        this.cacheReviewLines(this.reviewLineCacheKey(review, file, true, localEdit, threads), lines);
      }
      const edits = { ...(this.localEdits[review.id] ?? {}) };
      if (localEdit) edits[filePath] = localEdit;
      else delete edits[filePath];
      const nextLocalEdits = { ...this.localEdits, [review.id]: edits };
      await storage.update(REVIEW_CACHE_KEYS.localEdits, nextLocalEdits);
      this.assertSnapshot(review);
      this.localEdits = nextLocalEdits;
      this.emitChange();
    });
  }

  async clearLocalEdit(filePath: string): Promise<void> {
    const review = this.state;
    if (!review) return;
    const storage = this.storage;
    return this.enqueue(async () => {
      this.assertSnapshot(review);
      if (!this.getLocalEdit(review.id, filePath)) return;
      const edits = { ...this.localEdits[review.id] };
      delete edits[filePath];
      const nextLocalEdits = { ...this.localEdits, [review.id]: edits };
      await storage.update(REVIEW_CACHE_KEYS.localEdits, nextLocalEdits);
      this.assertSnapshot(review);
      this.localEdits = nextLocalEdits;
      this.emitChange();
    });
  }

  private getFileSummary(file: ReviewFile): FileSummary {
    const threads = this.getThreadsForFile(file.path);
    const resolvedThreadCount = threads.filter((thread) => thread.resolvable !== false && thread.resolved).length;
    const localEdit = this.state ? this.getLocalEdit(this.state.id, file.path) : undefined;
    const record = this.getReviewProgressRecord(this.state);
    const headSha = this.state?.diffRefs?.headSha;

    return {
      path: file.path,
      language: file.language,
      additions: file.additions,
      deletions: file.deletions,
      threadCount: threads.length,
      resolvedThreadCount,
      unresolvedThreadCount: threads.filter((thread) => thread.resolvable !== false).length - resolvedThreadCount,
      hasLocalEdit: Boolean(localEdit),
      localEditUpdatedAt: localEdit?.updatedAt,
      viewed: isReviewFileViewed(file.path, record, headSha, this.newChanges),
      newSinceLastReview: isReviewFileNewSinceLastReview(file.path, record, headSha, this.newChanges)
    };
  }

  private getReviewProgressRecord(review: ReviewState | undefined): ReviewProgressRecord {
    if (!review) return { viewedFiles: [] };
    const key = workspaceAssociationKey(review.projectId, review.mergeRequestIid);
    if (!this.reviewProgress[key]) this.reviewProgress[key] = { viewedFiles: [] };
    return this.reviewProgress[key];
  }

  private persistReviewProgress(): void {
    this.persistBestEffort(REVIEW_CACHE_KEYS.reviewProgress, this.reviewProgress);
  }

  private getThreadsForFile(filePath: string): ReviewThread[] {
    if (!this.threadIndex) {
      this.threadIndex = new Map<string, ReviewThread[]>();
      for (const thread of this.state?.threads ?? []) {
        if (!thread.filePath || (thread.positionHeadSha && thread.positionHeadSha !== this.state?.diffRefs?.headSha)) continue;
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
    if (!this.instanceUrl || this.instanceUrl !== this.configuredInstance()) {
      throw new Error("The GitLab instance changed. Refresh the connection before continuing.");
    }
    const baseUrl = this.baseUrlProvider();
    const hostname = getGitLabHostname(baseUrl);
    if (!hostname) {
      throw new Error("Invalid GitLab host.");
    }
    const cached = this.clients.get(hostname);
    if (cached) return cached;
    const client = new GitLabReviewClient(hostname);
    this.clients.set(hostname, client);
    return client;
  }

  private findFile(filePath: string): ReviewFile | undefined {
    if (!this.fileIndex) {
      this.fileIndex = new Map((this.state?.files ?? []).map((file) => [file.path, file]));
    }
    return this.fileIndex.get(filePath);
  }

  private findComment(threadId: string, commentId: string): ReviewComment | undefined {
    return this.state?.threads
      .find((thread) => thread.id === threadId)
      ?.comments.find((comment) => comment.id === commentId);
  }

  private replaceThread(threadId: string, replacement: ReviewThread): void {
    const index = this.state?.threads.findIndex((thread) => thread.id === threadId) ?? -1;
    if (index >= 0 && this.state) {
      this.state.threads[index] = replacement;
    }
  }

  private branchCacheKey(review: ReviewState, branch: string): string {
    return `${review.id}:${branch}:${this.branchCacheGeneration}`;
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

  private updateNewChanges(previous: ReviewState | undefined, current: ReviewState): ReviewUpdateRange | undefined {
    const detected = detectReviewUpdateRange(previous, current);
    if (detected) {
      const merged = mergeReviewUpdateRanges(this.newChanges, detected);
      this.setNewChanges(merged);
      return merged;
    }
    if (this.newChanges && (
      this.newChanges.projectId !== current.projectId
      || this.newChanges.mergeRequestIid !== current.mergeRequestIid
      || this.newChanges.toSha !== current.diffRefs?.headSha
    )) {
      this.setNewChanges(undefined);
      return undefined;
    }
    return this.newChanges?.changedPaths === undefined ? this.newChanges : undefined;
  }

  private async hydrateNewChangesPaths(range: ReviewUpdateRange): Promise<void> {
    const instanceUrl = this.instanceUrl;
    try {
      const files = await this.loadComparisonFiles(range);
      if (instanceUrl === this.configuredInstance()) this.applyChangedPaths(range, files);
    } catch {
      // Without a comparison, progress remains conservative and treats every file as new.
    }
  }

  private async loadComparisonFiles(range: ReviewUpdateRange): Promise<CommitDiffFile[]> {
    const instanceUrl = this.instanceUrl;
    const cacheKey = `compare:${instanceUrl}:${range.projectId}:${range.fromSha}:${range.toSha}`;
    const cached = this.commitDiffCache.get(cacheKey);
    if (cached) {
      this.commitDiffCacheTimes.set(cacheKey, Date.now());
      return cached;
    }
    const existing = this.comparisonLoads.get(cacheKey);
    if (existing) return existing;

    let load: Promise<CommitDiffFile[]>;
    load = this.getClient().compareCommits(range.projectId, range.fromSha, range.toSha)
      .then((files) => {
        if (instanceUrl !== this.configuredInstance()) throw new Error("The GitLab instance changed while loading the comparison.");
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
      })
      .finally(() => {
        if (this.comparisonLoads.get(cacheKey) === load) this.comparisonLoads.delete(cacheKey);
      });
    this.comparisonLoads.set(cacheKey, load);
    return load;
  }

  private applyChangedPaths(range: ReviewUpdateRange, files: readonly CommitDiffFile[]): void {
    const current = this.newChanges;
    if (!current
        || current.projectId !== range.projectId
        || current.mergeRequestIid !== range.mergeRequestIid
        || current.fromSha !== range.fromSha
        || current.toSha !== range.toSha) {
      return;
    }
    const changedPaths = [...new Set(files.flatMap((file) => [file.path, file.oldPath, file.newPath]))]
      .filter((filePath): filePath is string => Boolean(filePath));
    if (current.changedPaths
        && current.changedPaths.length === changedPaths.length
        && current.changedPaths.every((filePath, index) => filePath === changedPaths[index])) {
      return;
    }
    this.setNewChanges({ ...current, changedPaths });
    this.emitChange();
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

  private cacheCommitFileContents(key: string, contents: CommitFileContents): void {
    this.cacheBoundedCommitFileContents(
      this.commitFileContentCache,
      key,
      contents,
      cacheLimits.commitFileContents,
      cacheLimits.commitFileContentCharacters
    );
  }

  private cacheComparisonFileContents(key: string, contents: CommitFileContents): void {
    this.cacheBoundedCommitFileContents(
      this.comparisonFileContentCache,
      key,
      contents,
      cacheLimits.comparisonFileContents,
      cacheLimits.comparisonFileContentCharacters
    );
  }

  private cacheBoundedCommitFileContents(
    cache: Map<string, CachedCommitFileContents>,
    key: string,
    contents: CommitFileContents,
    maxEntries: number,
    maxCharacters: number
  ): void {
    const characters = Buffer.byteLength(contents.oldText, "utf8") + Buffer.byteLength(contents.newText, "utf8");
    const previous = cache.get(key);
    if (previous) {
      // The cache is bounded by both entry count and content size.
      // Remove the old size before replacing the value.
      cache.delete(key);
    }
    cache.set(key, { contents, characters, updatedAt: Date.now() });
    while (cache.size > maxEntries || totalCachedCharacters(cache) > maxCharacters) {
      if (cache.size <= 1) break;
      const oldest = [...cache].reduce(
        (candidate, entry) => entry[1].updatedAt < candidate[1].updatedAt ? entry : candidate
      );
      cache.delete(oldest[0]);
    }
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

  private persistLocalEdits(value: LocalEditsByMergeRequest = this.localEdits): Thenable<void> {
    return this.storage.update(REVIEW_CACHE_KEYS.localEdits, value);
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
    void Promise.resolve(this.storage.update(key, value)).catch(() => {
      // A storage failure must not turn a successful GitLab request into a UI failure.
    });
  }
}

function requireCommentBody(body: string): string {
  if (typeof body !== "string" || !body.trim()) throw new Error("Write a comment before submitting.");
  return body.trim();
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

function normalizeSubmissionMode(mode: string | undefined): ReviewSubmissionMode {
  return mode === "review" ? "review" : "comment";
}

function commitDiffSize(files: readonly CommitDiffFile[]): number {
  return files.reduce(
    (total, file) => total + file.diff.length + file.oldPath.length + file.newPath.length,
    0
  );
}

function totalCachedCharacters(cache: Map<string, CachedCommitFileContents>): number {
  return [...cache.values()].reduce((total, entry) => total + entry.characters, 0);
}

function reviewFileContentKey(review: ReviewState, file: ReviewFile): string {
  return `${review.id}:${review.diffRefs?.baseSha ?? ""}:${review.diffRefs?.headSha ?? ""}:${file.oldPath}:${file.newPath}`;
}

function commitFileContentKey(
  projectId: string,
  commitId: string,
  file: Pick<CommitDiffFile, "oldPath" | "newPath" | "newFile" | "deletedFile">
): string {
  return `commit:${projectId}:${commitId}:${file.oldPath}:${file.newPath}:${file.newFile ? "new" : ""}:${file.deletedFile ? "deleted" : ""}`;
}

function comparisonFileContentKey(
  projectId: string,
  fromSha: string,
  toSha: string,
  file: Pick<CommitDiffFile, "oldPath" | "newPath" | "newFile" | "deletedFile">
): string {
  return `compare:${projectId}:${fromSha}:${toSha}:${file.oldPath}:${file.newPath}:${file.newFile ? "new" : ""}:${file.deletedFile ? "deleted" : ""}`;
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
    searchText: [
      thread.filePath,
      ...thread.comments.map((comment) => `${comment.author}\n${comment.body}`)
    ].filter(Boolean).join("\n")
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
