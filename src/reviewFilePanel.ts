import * as vscode from "vscode";
import { CommentImageService, CommentImageServiceError } from "./commentImageService";
import { commentImageRequestMatchesReviewContext, type CommentImageWebviewMessage } from "./commentImageTypes";
import { LocalGitService } from "./localGitService";
import { canEditReviewLocally } from "./localGitUtils";
import { reviewContextKey, sameReviewContext, type ReviewContext, type ReviewMutationResult } from "./reviewContext";
import { ReviewStore } from "./reviewStore";
import { configureWebview } from "./webviewHost";
import type {
  HostMessage,
  ReviewMutationMessage,
  ReviewFileHostMessage,
  ReviewFileMessage,
  ReviewFileViewState
} from "./webviewProtocol";
import type { CommitFileReviewContext, FileReviewViewModel, NewChangesFileReviewContext, ReviewUpdateRange } from "./reviewTypes";

type PanelMode = "review" | "edit";

export class ReviewFilePanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, ReviewFilePanel>();
  private readonly onDidChangeActiveFileEmitter = new vscode.EventEmitter<string | undefined>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeFilePath?: string;
  private disposed = false;

  readonly onDidChangeActiveFile = this.onDidChangeActiveFileEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ReviewStore,
    private readonly localGit: LocalGitService,
    private readonly commentImages: CommentImageService
  ) {
    this.subscriptions.push(
      this.store.onDidChange(() => {
        for (const panel of this.panels.values()) {
          panel.refreshFromStore();
        }
      }),
      this.localGit.onDidChange(() => {
        for (const panel of this.panels.values()) {
          panel.refreshFromLocalWorkspace();
        }
      })
    );
  }

  getActiveFilePath(): string | undefined {
    return this.activeFilePath;
  }

  openFile(filePath: string, line?: number, threadId?: string): void {
    const reviewContext = this.store.getReviewContext();
    if (!reviewContext) {
      void vscode.window.showInformationMessage("The current merge request is still loading. Refresh it and try again.");
      return;
    }
    const key = reviewFilePanelKey(reviewContext, "review", filePath);
    const existing = this.panels.get(key)
      ?? [...this.panels.values()].find((candidate) => candidate.filePath === filePath && candidate.matchesReviewContext(reviewContext));
    if (existing) {
      existing.openReview(line, threadId);
      return;
    }

    const panel = new ReviewFilePanel(
      this.context,
      this.store,
      this.localGit,
      this.commentImages,
      filePath,
      reviewContext,
      (line, threadId) => this.openCurrentReviewFile(filePath, line, threadId),
      () => this.setActiveFile(filePath),
      (active) => this.handlePanelViewState(filePath, active),
      () => this.handlePanelDisposed(key)
    );
    this.panels.set(key, panel);
    panel.reveal(line, threadId);
  }

  async openCommitFile(commitId: string, filePath: string): Promise<void> {
    const reviewContext = this.store.getReviewContext();
    if (!reviewContext) {
      void vscode.window.showInformationMessage("The current merge request is still loading. Refresh it and try again.");
      return;
    }
    try {
      const context = await this.store.loadCommitFileReviewContext(commitId, filePath);
      this.store.assertReviewContext(reviewContext);
      const key = reviewFilePanelKey(reviewContext, "commit", `${commitId}:${filePath}`);
      const existing = this.panels.get(key);
      if (existing) {
        existing.openCommit(context);
        return;
      }

      const panel = new ReviewFilePanel(
        this.context,
        this.store,
        this.localGit,
        this.commentImages,
        filePath,
        reviewContext,
        (line, threadId) => this.openCurrentReviewFile(filePath, line, threadId),
        () => this.setActiveFile(filePath),
        (active) => this.handlePanelViewState(filePath, active),
        () => this.handlePanelDisposed(key)
      );
      this.panels.set(key, panel);
      panel.openCommit(context);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "コミットのファイル差分を開けませんでした。");
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const panel of [...this.panels.values()]) {
      panel.dispose();
    }
    this.panels.clear();
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.onDidChangeActiveFileEmitter.dispose();
  }

  private handlePanelViewState(filePath: string, active: boolean): void {
    if (active) {
      this.setActiveFile(filePath);
      return;
    }
    queueMicrotask(() => this.syncActivePanel());
  }

  private handlePanelDisposed(key: string): void {
    const panel = this.panels.get(key);
    this.panels.delete(key);
    if (panel?.filePath === this.activeFilePath) {
      queueMicrotask(() => this.syncActivePanel());
    }
  }

  private openCurrentReviewFile(filePath: string, line?: number, threadId?: string): void {
    if (!this.store.getReviewContext()) {
      throw new Error("The current merge request is still loading. Refresh it and try again.");
    }
    this.openFile(filePath, line, threadId);
  }

  private syncActivePanel(): void {
    if (this.disposed) return;
    const activePanel = [...this.panels.values()].find((panel) => panel.isActive());
    this.setActiveFile(activePanel?.filePath);
  }

  private setActiveFile(filePath: string | undefined): void {
    if (this.disposed || this.activeFilePath === filePath) return;
    this.activeFilePath = filePath;
    this.onDidChangeActiveFileEmitter.fire(filePath);
  }
}

class ReviewFilePanel {
  private readonly panel: vscode.WebviewPanel;
  private mode: PanelMode = "review";
  private commitContext?: CommitFileReviewContext;
  private reviewRange: "all" | "new" = "all";
  private newChangesContext?: NewChangesFileReviewContext | null;
  private newChangesLoading = false;
  private newChangesError?: string;
  private newChangesKey = "";
  private pendingLine?: number;
  private pendingThreadId?: string;
  private ready = false;
  private lineWindowStart = 0;
  private fullFileLoading = false;
  private fullFileError?: string;
  private postScheduled = false;
  private stale = false;
  private readonly viewContext: ReviewContext;
  private renderedViewModel?: FileReviewViewModel;
  private renderedSource: ReviewFileViewState["source"] = "review";
  private renderedNewChanges?: ReviewFileViewState["newChanges"];

  constructor(
    context: vscode.ExtensionContext,
    private readonly store: ReviewStore,
    private readonly localGit: LocalGitService,
    private readonly commentImages: CommentImageService,
    readonly filePath: string,
    viewContext: ReviewContext,
    private readonly onOpenCurrentReviewFile: (line?: number, threadId?: string) => void,
    private readonly onDidBecomeActive: () => void,
    private readonly onDidChangeActive: (active: boolean) => void,
    onDispose: () => void
  ) {
    this.viewContext = Object.freeze({ ...viewContext });
    this.panel = vscode.window.createWebviewPanel(
      "gitlabReview.fileReview",
      basename(filePath),
      vscode.ViewColumn.One,
      { retainContextWhenHidden: false }
    );

    this.panel.onDidDispose(onDispose);
    this.panel.onDidChangeViewState(({ webviewPanel }) => {
      this.onDidChangeActive(webviewPanel.active);
      if (!webviewPanel.visible && this.commitContext?.contents) {
        this.commitContext = { ...this.commitContext, contents: undefined };
      }
      if (webviewPanel.visible) this.postState();
    });
    this.panel.webview.onDidReceiveMessage((message: ReviewFileMessage) => {
      void this.handleMessage(message);
    });
    configureWebview(this.panel.webview, context.extensionUri, "review-file", [vscode.Uri.file(this.commentImages.cacheRootPath)]);
  }

  reveal(line?: number, threadId?: string): void {
    this.pendingLine = line;
    this.pendingThreadId = threadId;
    this.panel.reveal(vscode.ViewColumn.One);
    this.onDidBecomeActive();
    this.postState();
  }

  openReview(line?: number, threadId?: string): void {
    this.commitContext = undefined;
    this.mode = "review";
    this.stale = false;
    this.renderedViewModel = undefined;
    this.renderedSource = "review";
    this.renderedNewChanges = undefined;
    this.reviewRange = "all";
    this.lineWindowStart = 0;
    this.fullFileError = undefined;
    this.reveal(line, threadId);
    void this.syncNewChanges(true);
  }

  openCommit(context: CommitFileReviewContext): void {
    this.commitContext = context;
    this.reviewRange = "all";
    this.mode = "review";
    this.stale = false;
    this.renderedViewModel = undefined;
    this.renderedSource = "commit";
    this.renderedNewChanges = undefined;
    this.lineWindowStart = 0;
    this.fullFileError = undefined;
    this.reveal();
  }

  isActive(): boolean {
    return this.panel.active;
  }

  matchesReviewContext(context: ReviewContext): boolean {
    return !this.commitContext && sameReviewContext(this.viewContext, context);
  }

  dispose(): void {
    this.panel.dispose();
  }

  refreshFromStore(): void {
    this.stale = !sameReviewContext(this.viewContext, this.store.getReviewContext());
    if (!this.stale && this.panel.visible && this.mode !== "edit" && !this.store.getIsRefreshing()) {
      void this.syncNewChanges(true);
    }
    if (this.panel.visible) this.postState();
  }

  refreshFromLocalWorkspace(): void {
    if (!this.panel.visible) return;
    this.postState();
  }

  private postState(): void {
    if (!this.ready || !this.panel.visible || this.postScheduled) return;
    this.postScheduled = true;
    queueMicrotask(() => {
      this.postScheduled = false;
      this.deliverState();
    });
  }

  private deliverState(): void {
    if (!this.ready || !this.panel.visible) return;

    const liveReviewContext = this.store.getReviewContext();
    const current = sameReviewContext(this.viewContext, liveReviewContext);
    this.stale = !current;
    let newChanges: ReviewFileViewState["newChanges"] | undefined;
    let useNewChanges = false;
    let source: ReviewFileViewState["source"] = this.renderedSource;
    let viewModel = this.renderedViewModel;

    if (current) {
      const range = this.commitContext ? undefined : this.store.getNewChanges();
      useNewChanges = this.reviewRange === "new" && Boolean(this.newChangesContext);
      source = this.commitContext ? "commit" : useNewChanges ? "new-changes" : "review";
      viewModel = this.commitContext
        ? this.store.buildCommitFileViewModel(this.commitContext, {
            windowStart: this.lineWindowStart,
            targetLine: this.pendingLine,
            includeEditableText: this.mode === "edit",
            fullFileStateOverride: this.fullFileLoading ? "loading" : this.fullFileError ? "error" : undefined,
            fullFileMessage: this.fullFileError
          })
        : useNewChanges
          ? this.store.buildNewChangesFileViewModel(this.newChangesContext as NewChangesFileReviewContext, {
              windowStart: this.lineWindowStart,
              targetLine: this.pendingLine,
              fullFileStateOverride: this.fullFileLoading ? "loading" : this.fullFileError ? "error" : undefined,
              fullFileMessage: this.fullFileError
            })
          : this.store.getFileViewModel(this.filePath, {
              windowStart: this.lineWindowStart,
              targetLine: this.pendingLine,
              includeEditableText: this.mode === "edit",
              fullFileStateOverride: this.fullFileLoading ? "loading" : undefined,
              fullFileMessage: this.fullFileError
            });
      if (this.isHistoricalCommit() && viewModel) viewModel = withoutReviewThreads(viewModel);
      newChanges = range ? {
        ...range,
        selected: this.reviewRange,
        loading: this.newChangesLoading,
        fileChanged: this.newChangesContext === undefined ? undefined : this.newChangesContext !== null,
        errorMessage: this.newChangesError
      } : undefined;
      this.renderedViewModel = viewModel;
      this.renderedSource = source;
      this.renderedNewChanges = newChanges;
    } else {
      newChanges = this.renderedNewChanges;
      useNewChanges = this.renderedSource === "new-changes";
      source = this.renderedSource;
    }
    this.panel.title = viewModel
      ? `${basename(this.filePath)} ${this.mode === "edit" ? "(editing)" : "(review)"}`
      : basename(this.filePath);

    const targetLine = this.pendingLine;
    const targetThreadId = this.pendingThreadId;
    const targetVisible = targetLine === undefined || Boolean(viewModel?.lines.some(
      (line) => line.mrLine === targetLine || line.oldLine === targetLine
    ));
    if (current && !targetVisible && viewModel?.fullFileState === "not-loaded") {
      void this.loadFullFile();
    }
    const historical = this.isHistoricalCommit();
    const canComment = current && !historical && this.canCommentSource(source);
    const commentUnavailableReason = !current
      ? "This review changed while the file was open. Open the current MR diff to continue."
      : historical
        ? "Historical commit diffs are read-only. Open the current MR diff to comment."
        : !canComment
          ? "Comments are unavailable for this diff. Open the current MR diff to comment."
          : undefined;
    const state: ReviewFileViewState = {
      reviewContext: this.viewContext,
      liveReviewContext,
      stale: !current,
      canComment,
      commentUnavailableReason,
      mode: this.mode,
      canEditLocally: this.canEditLocally(),
      projectId: this.viewContext.projectId,
      source,
      filePath: this.filePath,
      threadScope: this.commitContext
        ? `${reviewContextKey(this.viewContext)}:commit:${this.commitContext.commit.id}:${this.filePath}`
        : `${reviewContextKey(this.viewContext)}:${this.filePath}`,
      viewModel,
      targetLine,
      targetThreadId,
      submissionMode: this.store.getSubmissionMode(),
      commit: this.commitContext?.commit,
      newChanges
    };
    void this.panel.webview
      .postMessage({ type: "state", state } satisfies HostMessage<ReviewFileViewState>)
      .then((delivered) => {
        if (!delivered) return;
        if (targetVisible && this.pendingLine === targetLine) this.pendingLine = undefined;
        if (targetVisible && this.pendingThreadId === targetThreadId) this.pendingThreadId = undefined;
      });
  }

  private async handleMessage(message: ReviewFileMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.ready = true;
        this.postState();
        return;
      case "loadFullFile":
        await this.loadFullFile();
        return;
      case "loadLineWindow":
        if (!this.isViewCurrent()) return;
        this.lineWindowStart = Math.max(0, Math.floor(message.start));
        this.postState();
        return;
      case "setReviewRange":
        if (!this.isViewCurrent() || this.commitContext || (message.range === "new" && !this.store.getNewChanges())) return;
        this.reviewRange = message.range;
        this.lineWindowStart = 0;
        this.fullFileError = undefined;
        if (message.range === "new") await this.syncNewChanges(false);
        this.postState();
        return;
      case "enterEdit":
        if (!this.canEditLocally()) {
          this.mode = "review";
          this.postState();
          return;
        }
        if (!await this.loadFullFile()) return;
        this.mode = "edit";
        this.postState();
        return;
      case "cancelEdit":
        this.mode = "review";
        this.postState();
        return;
      case "saveLocalEdit":
        await this.handleLocalEditSave(message);
        return;
      case "clearLocalEdit":
        await this.runReviewMutation(message, () => this.store.clearLocalEdit(this.filePath));
        return;
      case "addComment":
        await this.runReviewMutation(message, () => this.store.addComment(message.threadId, message.body, message.reviewContext));
        return;
      case "loadCommentReactions":
        await this.runReviewMutation(message, () => this.store.loadCommentReactions(message.threadId, message.commentId));
        return;
      case "toggleCommentReaction":
        await this.runReviewMutation(message, () => this.store.toggleCommentReaction(message.threadId, message.commentId, message.name, message.reviewContext));
        return;
      case "editComment":
        await this.runReviewMutation(message, () => this.store.editComment(message.threadId, message.commentId, message.body, message.reviewContext));
        return;
      case "toggleResolved":
        await this.runReviewMutation(message, () => this.store.toggleResolved(message.threadId, message.reviewContext));
        return;
      case "addThread":
        await this.runReviewMutation(message, () => this.addThreadAtCurrentMrLine(message));
        return;
      case "openCurrentReviewFile":
        await this.runReviewMutation(message, () => {
          this.onOpenCurrentReviewFile(message.line, message.threadId);
          return { ok: true } as const;
        }, false, false);
        return;
      case "setSubmissionMode":
        this.store.setSubmissionMode(message.mode);
        this.postState();
        return;
      case "uploadCommentImage":
      case "resolveCommentImage":
        await this.handleCommentImage(message);
        return;
    }
  }

  private async loadFullFile(): Promise<boolean> {
    if (!this.isViewCurrent()) {
      this.stale = true;
      this.postState();
      return false;
    }
    if (this.fullFileLoading) return false;
    const currentModel = this.commitContext
      ? this.store.buildCommitFileViewModel(this.commitContext)
      : this.reviewRange === "new" && this.newChangesContext
        ? this.store.buildNewChangesFileViewModel(this.newChangesContext)
      : this.store.getFileViewModel(this.filePath);
    if (currentModel?.fullFileState === "loaded") return true;
    this.fullFileLoading = true;
    this.fullFileError = undefined;
    this.postState();
    try {
      const commitContext = this.commitContext;
      if (commitContext) {
        const contents = await this.store.loadCommitFileContents(commitContext.commit.id, commitContext.file);
        this.store.assertReviewContext(this.viewContext);
        if (this.commitContext !== commitContext || !this.panel.visible) return false;
        commitContext.contents = contents;
      } else if (this.reviewRange === "new" && this.newChangesContext) {
        const comparisonContext = this.newChangesContext;
        await this.store.loadNewChangesFileContents(comparisonContext);
        this.store.assertReviewContext(this.viewContext);
        if (this.newChangesContext !== comparisonContext || !this.panel.visible) return false;
      } else {
        await this.store.loadReviewFileContents(this.filePath);
        this.store.assertReviewContext(this.viewContext);
      }
      this.lineWindowStart = 0;
      return true;
    } catch (error) {
      this.fullFileError = error instanceof Error ? error.message : "Could not load the full file.";
      return false;
    } finally {
      this.fullFileLoading = false;
      this.postState();
    }
  }

  private async syncNewChanges(autoSelect: boolean): Promise<void> {
    if (this.commitContext || !this.isViewCurrent()) return;
    const range = this.store.getNewChanges();
    const key = newChangesRangeKey(range);
    if (!range) {
      this.newChangesKey = "";
      this.newChangesContext = undefined;
      this.newChangesError = undefined;
      this.newChangesLoading = false;
      this.reviewRange = "all";
      return;
    }
    if (key !== this.newChangesKey) {
      this.newChangesKey = key;
      this.newChangesContext = undefined;
      this.newChangesError = undefined;
      this.newChangesLoading = false;
      if (autoSelect) this.reviewRange = "new";
    }
    if (this.reviewRange !== "new" || this.newChangesContext !== undefined || this.newChangesLoading) return;

    this.newChangesLoading = true;
    this.postState();
    try {
      const context = await this.store.loadNewChangesFileReviewContext(this.filePath);
      this.store.assertReviewContext(this.viewContext);
      if (newChangesRangeKey(this.store.getNewChanges()) !== key) return;
      this.newChangesContext = context ?? null;
      this.newChangesError = undefined;
    } catch (error) {
      if (!this.isViewCurrent()) return;
      if (newChangesRangeKey(this.store.getNewChanges()) !== key) return;
      this.newChangesContext = undefined;
      this.newChangesError = error instanceof Error ? error.message : "Could not compare the new changes.";
    } finally {
      if (newChangesRangeKey(this.store.getNewChanges()) === key) {
        this.newChangesLoading = false;
        this.postState();
      }
    }
  }

  private async handleCommentImage(message: CommentImageWebviewMessage): Promise<void> {
    if (!commentImageRequestMatchesReviewContext(message, this.viewContext)) {
      await this.postCommentImageFailure(message, "The image request does not match the selected merge request.");
      return;
    }
    try {
      this.store.assertReviewContext(message.reviewContext);
    } catch {
      await this.postCommentImageFailure(message, "The image request does not match the selected merge request.");
      return;
    }
    try {
      if (message.type === "uploadCommentImage") {
        const result = await this.commentImages.upload(message);
        this.store.assertReviewContext(message.reviewContext);
        await this.panel.webview.postMessage({
          type: "commentImageUploaded",
          requestId: message.requestId,
          markdown: result.markdown,
          imagePath: result.imagePath,
          displayUri: this.panel.webview.asWebviewUri(vscode.Uri.file(result.cachePath)).toString()
        } satisfies HostMessage<ReviewFileViewState>);
      } else {
        const result = await this.commentImages.resolve(message);
        this.store.assertReviewContext(message.reviewContext);
        await this.panel.webview.postMessage({
          type: "commentImageResolved",
          requestId: message.requestId,
          imagePath: message.imagePath,
          displayUri: this.panel.webview.asWebviewUri(vscode.Uri.file(result.cachePath)).toString(),
          fallbackUrl: result.fallbackUrl
        } satisfies HostMessage<ReviewFileViewState>);
      }
    } catch (error) {
      const fallbackUrl = error instanceof CommentImageServiceError ? error.fallbackUrl : undefined;
      const errorMessage = error instanceof CommentImageServiceError ? error.message : "GitLab comment image could not be processed.";
      await this.postCommentImageFailure(message, errorMessage, fallbackUrl);
    }
  }

  private async postCommentImageFailure(
    message: CommentImageWebviewMessage,
    errorMessage: string,
    fallbackUrl?: string
  ): Promise<void> {
    if (message.type === "uploadCommentImage") {
      await this.panel.webview.postMessage({
        type: "commentImageUploadFailed",
        requestId: message.requestId,
        message: errorMessage
      } satisfies HostMessage<ReviewFileViewState>);
    } else {
      await this.panel.webview.postMessage({
        type: "commentImageResolveFailed",
        requestId: message.requestId,
        imagePath: message.imagePath,
        message: errorMessage,
        fallbackUrl
      } satisfies HostMessage<ReviewFileViewState>);
    }
  }

  private canEditLocally(): boolean {
    if (this.stale || this.commitContext || this.reviewRange === "new") return false;
    const overview = this.store.getOverview();
    const selected = overview.selectedMergeRequest;
    if (!selected || !overview.sourceBranch) return false;
    const localState = this.localGit.getState(overview.sourceBranch, this.store.getProjectIdentity());
    return canEditReviewLocally(localState);
  }

  private async runReviewMutation<T extends object>(
    message: ReviewMutationMessage<T>,
    operation: () => void | ReviewMutationResult | Promise<void | ReviewMutationResult>,
    requireCommenting = true,
    requireCurrent = true
  ): Promise<void> {
    let result: ReviewMutationResult;
    try {
      this.assertViewContext(message.reviewContext, requireCommenting, requireCurrent);
      const outcome = await operation();
      result = outcome ?? { ok: true };
      if (result.ok && "type" in message && message.type === "clearLocalEdit") {
        this.mode = "review";
      }
    } catch (error) {
      result = {
        ok: false,
        errorMessage: error instanceof Error
          ? error.message
          : "The current merge request is no longer available. Your draft has been kept."
      };
    }
    await this.postReviewMutationResult(message.requestId, result);
    this.postState();
  }

  private async handleLocalEditSave(
    message: Extract<ReviewFileMessage, { type: "saveLocalEdit" }>
  ): Promise<void> {
    let result: ReviewMutationResult;
    try {
      this.assertViewContext(message.reviewContext, false);
      if (!this.canEditLocally()) {
        throw new Error("The local branch is no longer available for editing. Your draft is still in the editor.");
      }
      await this.store.saveLocalEdit(this.filePath, message.text);
      result = { ok: true };
      this.mode = "review";
    } catch (error) {
      result = {
        ok: false,
        errorMessage: error instanceof Error ? error.message : "Could not save the local edit."
      };
    }
    this.postLocalEditSaveResult(result, message.requestId);
    this.postState();
  }

  private async postReviewMutationResult(requestId: string, result: ReviewMutationResult): Promise<void> {
    await this.panel.webview.postMessage({
      type: "reviewMutationResult",
      requestId,
      ...result
    } satisfies HostMessage<ReviewFileViewState, ReviewFileHostMessage>);
  }

  private postLocalEditSaveResult(result: ReviewMutationResult, requestId: string): void {
    void this.panel.webview.postMessage({
      type: "localEditSaveResult",
      requestId,
      ...result
    } satisfies HostMessage<ReviewFileViewState, ReviewFileHostMessage>);
  }

  private assertViewContext(expected: ReviewContext, requireCommenting: boolean, requireCurrent = true): void {
    if (!sameReviewContext(expected, this.viewContext)) {
      throw new Error("This file belongs to a different review. Open the current MR diff and retry; your draft has been kept.");
    }
    if (requireCurrent) this.store.assertReviewContext(expected);
    if (requireCommenting && (!this.canCommentSource(this.renderedSource) || this.isHistoricalCommit())) {
      throw new Error(this.commentUnavailableReason());
    }
  }

  private isViewCurrent(): boolean {
    return sameReviewContext(this.viewContext, this.store.getReviewContext()) && !this.stale;
  }

  private commentUnavailableReason(): string {
    if (!this.isViewCurrent()) return "This review changed while the file was open. Open the current MR diff to continue.";
    if (this.isHistoricalCommit()) return "Historical commit diffs are read-only. Open the current MR diff to comment.";
    return "Comments are unavailable for this diff. Open the current MR diff to comment.";
  }

  private async addThreadAtCurrentMrLine(
    message: Extract<ReviewFileMessage, { type: "addThread" }>
  ): Promise<ReviewMutationResult> {
    const mode = message.mode ?? this.store.getSubmissionMode();
    const oldLine = this.renderedSource === "new-changes" || this.commitContext
      ? await this.mapCurrentMrOldLine(message.mrLine, message.reviewContext)
      : message.oldLine;
    return this.store.addThread(this.filePath, message.mrLine, oldLine, message.body, mode, message.reviewContext);
  }

  private async mapCurrentMrOldLine(mrLine: number, expected: ReviewContext): Promise<number | undefined> {
    // Comparison and commit panels carry coordinates from their own diff. The
    // GitLab mutation API needs the current MR position, so resolve it from
    // the complete current-MR file before sending the request.
    await this.store.loadReviewFileContents(this.filePath);
    this.store.assertReviewContext(expected);
    const current = this.store.getFileViewModel(this.filePath, { targetLine: mrLine });
    const line = current?.lines.find((candidate) => candidate.mrLine === mrLine);
    if (!line) throw new Error("This line is no longer available in the current merge request diff. Your draft has been kept.");
    return line.oldLine;
  }

  private isHistoricalCommit(): boolean {
    return Boolean(this.commitContext && this.commitContext.commit.id !== this.viewContext.headSha);
  }

  private canCommentSource(source: ReviewFileViewState["source"]): boolean {
    if (source === "review") return true;
    if (source === "commit") return !this.isHistoricalCommit();
    return Boolean(this.newChangesContext && this.newChangesContext.range.toSha === this.viewContext.headSha);
  }
}

function newChangesRangeKey(range: ReviewUpdateRange | undefined): string {
  return range ? `${range.projectId}!${range.mergeRequestIid}:${range.fromSha}:${range.toSha}` : "";
}

function basename(filePath: string): string {
  const parts = filePath.split("/");
  return parts.at(-1) ?? filePath;
}

function withoutReviewThreads(model: FileReviewViewModel): FileReviewViewModel {
  return {
    ...model,
    summary: {
      ...model.summary,
      threadCount: 0,
      unresolvedThreadCount: 0,
      resolvedThreadCount: 0
    },
    threads: [],
    lines: model.lines.map((line) => ({ ...line, threadIds: [] }))
  };
}

function reviewFilePanelKey(context: ReviewContext, source: "review" | "commit", filePath: string): string {
  return `${reviewContextKey(context)}:${source}:${filePath}`;
}
