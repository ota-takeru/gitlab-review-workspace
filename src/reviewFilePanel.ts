import * as vscode from "vscode";
import { CommentImageService, CommentImageServiceError } from "./commentImageService";
import type { CommentImageWebviewMessage } from "./commentImageTypes";
import { LocalGitService } from "./localGitService";
import { canEditReviewLocally } from "./localGitUtils";
import { ReviewStore } from "./reviewStore";
import { configureWebview } from "./webviewHost";
import type {
  HostMessage,
  ReviewFileHostMessage,
  ReviewFileMessage,
  ReviewFileViewState
} from "./webviewProtocol";
import type { CommitFileReviewContext, NewChangesFileReviewContext, ReviewUpdateRange } from "./reviewTypes";

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
    this.store.markFileViewed(filePath);
    const existing = this.panels.get(filePath);
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
      () => this.setActiveFile(filePath),
      (active) => this.handlePanelViewState(filePath, active),
      () => this.handlePanelDisposed(filePath)
    );
    this.panels.set(filePath, panel);
    panel.reveal(line, threadId);
  }

  async openCommitFile(commitId: string, filePath: string): Promise<void> {
    try {
      const context = await this.store.loadCommitFileReviewContext(commitId, filePath);
      this.store.markFileViewed(filePath);
      const existing = this.panels.get(filePath);
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
        () => this.setActiveFile(filePath),
        (active) => this.handlePanelViewState(filePath, active),
        () => this.handlePanelDisposed(filePath)
      );
      this.panels.set(filePath, panel);
      panel.openCommit(context);
    } catch {
      void vscode.window.showErrorMessage("コミットのファイル差分を開けませんでした。");
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

  private handlePanelDisposed(filePath: string): void {
    this.panels.delete(filePath);
    if (this.activeFilePath === filePath) {
      queueMicrotask(() => this.syncActivePanel());
    }
  }

  private syncActivePanel(): void {
    if (this.disposed) return;
    const activePanel = [...this.panels.entries()].find(([, panel]) => panel.isActive());
    this.setActiveFile(activePanel?.[0]);
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

  constructor(
    context: vscode.ExtensionContext,
    private readonly store: ReviewStore,
    private readonly localGit: LocalGitService,
    private readonly commentImages: CommentImageService,
    private readonly filePath: string,
    private readonly onDidBecomeActive: () => void,
    private readonly onDidChangeActive: (active: boolean) => void,
    onDispose: () => void
  ) {
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
    this.lineWindowStart = 0;
    this.fullFileError = undefined;
    this.reveal(line, threadId);
    void this.syncNewChanges(true);
  }

  openCommit(context: CommitFileReviewContext): void {
    this.commitContext = context;
    this.reviewRange = "all";
    this.mode = "review";
    this.lineWindowStart = 0;
    this.fullFileError = undefined;
    this.reveal();
  }

  isActive(): boolean {
    return this.panel.active;
  }

  dispose(): void {
    this.panel.dispose();
  }

  refreshFromStore(): void {
    if (!this.panel.visible || this.mode === "edit" || this.store.getIsRefreshing()) return;
    void this.syncNewChanges(true);
    this.postState();
  }

  refreshFromLocalWorkspace(): void {
    if (this.mode === "edit" && !this.canEditLocally()) this.mode = "review";
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

    const newChanges = this.commitContext ? undefined : this.store.getNewChanges();
    const useNewChanges = this.reviewRange === "new" && Boolean(this.newChangesContext);
    const viewModel = this.commitContext
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
    this.panel.title = viewModel
      ? `${basename(this.filePath)} ${this.mode === "edit" ? "(editing)" : "(review)"}`
      : basename(this.filePath);

    const targetLine = this.pendingLine;
    const targetThreadId = this.pendingThreadId;
    const targetVisible = targetLine === undefined || Boolean(viewModel?.lines.some(
      (line) => line.mrLine === targetLine || line.oldLine === targetLine
    ));
    if (!targetVisible && viewModel?.fullFileState === "not-loaded") {
      void this.loadFullFile();
    }
    const selectedMergeRequest = this.store.getOverview().selectedMergeRequest;
    const state: ReviewFileViewState = {
      mode: this.mode,
      canEditLocally: this.canEditLocally(),
      projectId: selectedMergeRequest?.projectId,
      source: this.commitContext ? "commit" : useNewChanges ? "new-changes" : "review",
      filePath: this.filePath,
      threadScope: this.commitContext
        ? `commit:${this.commitContext.commit.id}:${this.filePath}`
        : selectedMergeRequest
          ? `${selectedMergeRequest.projectId}!${selectedMergeRequest.iid}:${this.filePath}`
          : this.filePath,
      viewModel,
      targetLine,
      targetThreadId,
      submissionMode: this.store.getSubmissionMode(),
      commit: this.commitContext?.commit,
      newChanges: newChanges ? {
        ...newChanges,
        selected: this.reviewRange,
        loading: this.newChangesLoading,
        fileChanged: this.newChangesContext === undefined ? undefined : this.newChangesContext !== null,
        errorMessage: this.newChangesError
      } : undefined
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
        this.lineWindowStart = Math.max(0, Math.floor(message.start));
        this.postState();
        return;
      case "setReviewRange":
        if (this.commitContext || (message.range === "new" && !this.store.getNewChanges())) return;
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
        if (!this.canEditLocally()) {
          this.postLocalEditSaveResult({
            type: "localEditSaveResult",
            requestId: message.requestId,
            ok: false,
            errorMessage: "The local branch is no longer available for editing. Your draft is still in the editor."
          });
          this.postState();
          return;
        }
        try {
          await this.store.saveLocalEdit(this.filePath, message.text);
          this.postLocalEditSaveResult({ type: "localEditSaveResult", requestId: message.requestId, ok: true });
          this.mode = "review";
          this.postState();
        } catch (error) {
          this.postLocalEditSaveResult({
            type: "localEditSaveResult",
            requestId: message.requestId,
            ok: false,
            errorMessage: error instanceof Error ? error.message : "Could not save the local edit."
          });
        }
        return;
      case "clearLocalEdit":
        try {
          await this.store.clearLocalEdit(this.filePath);
          this.mode = "review";
          this.postState();
        } catch {
          void vscode.window.showErrorMessage("ローカル編集を破棄できませんでした。保存済みの編集内容は保持されています。");
        }
        return;
      case "addComment":
        await this.store.addComment(message.threadId, message.body);
        return;
      case "editComment":
        await this.store.editComment(message.threadId, message.commentId, message.body);
        return;
      case "toggleResolved":
        await this.store.toggleResolved(message.threadId);
        return;
      case "addThread":
        await this.store.addThread(
          this.filePath,
          message.mrLine,
          this.reviewRange === "new" ? undefined : message.oldLine,
          message.body,
          message.mode ?? this.store.getSubmissionMode()
        );
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

  private postLocalEditSaveResult(message: ReviewFileHostMessage): void {
    void this.panel.webview.postMessage(
      message satisfies HostMessage<ReviewFileViewState, ReviewFileHostMessage>
    );
  }

  private async loadFullFile(): Promise<boolean> {
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
        if (this.commitContext !== commitContext || !this.panel.visible) return false;
        commitContext.contents = contents;
      } else if (this.reviewRange === "new" && this.newChangesContext) {
        const comparisonContext = this.newChangesContext;
        await this.store.loadNewChangesFileContents(comparisonContext);
        if (this.newChangesContext !== comparisonContext || !this.panel.visible) return false;
      } else {
        await this.store.loadReviewFileContents(this.filePath);
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
    if (this.commitContext) return;
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
      if (newChangesRangeKey(this.store.getNewChanges()) !== key) return;
      this.newChangesContext = context ?? null;
      this.newChangesError = undefined;
    } catch (error) {
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
    const selected = this.store.getOverview().selectedMergeRequest;
    if (!selected || selected.projectId !== message.projectId) {
      await this.postCommentImageFailure(message, "The image request does not match the selected merge request.");
      return;
    }
    try {
      if (message.type === "uploadCommentImage") {
        const result = await this.commentImages.upload(message);
        await this.panel.webview.postMessage({
          type: "commentImageUploaded",
          requestId: message.requestId,
          markdown: result.markdown,
          imagePath: result.imagePath,
          displayUri: this.panel.webview.asWebviewUri(vscode.Uri.file(result.cachePath)).toString()
        } satisfies HostMessage<ReviewFileViewState>);
      } else {
        const result = await this.commentImages.resolve(message);
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
    if (this.commitContext || this.reviewRange === "new") return false;
    const overview = this.store.getOverview();
    const selected = overview.selectedMergeRequest;
    if (!selected || !overview.sourceBranch) return false;
    const localState = this.localGit.getState(overview.sourceBranch, selected.projectId);
    return canEditReviewLocally(localState);
  }
}

function newChangesRangeKey(range: ReviewUpdateRange | undefined): string {
  return range ? `${range.projectId}!${range.mergeRequestIid}:${range.fromSha}:${range.toSha}` : "";
}

function basename(filePath: string): string {
  const parts = filePath.split("/");
  return parts.at(-1) ?? filePath;
}
