import * as vscode from "vscode";
import { CommentImageService, CommentImageServiceError } from "./commentImageService";
import type { CommentImageWebviewMessage } from "./commentImageTypes";
import { GlabAuthService } from "./glabAuth";
import { LocalGitService } from "./localGitService";
import { MyWorkStore } from "./myWorkStore";
import { ReviewStore } from "./reviewStore";
import type { ReviewOverview } from "./reviewTypes";
import { configureWebview } from "./webviewHost";
import { createSidebarViewState } from "./webviewViewModels";
import type {
  BranchTreeState,
  CommitDiffState,
  HostMessage,
  SidebarMessage,
  SidebarViewState
} from "./webviewProtocol";

export interface ReviewNavigator {
  openFile(filePath: string, line?: number, threadId?: string): void;
  openBranchFile(branch: string, filePath: string): Promise<void>;
  openCommitDiffFile(commitId: string, filePath: string): Promise<void>;
  getActiveFilePath(): string | undefined;
  onDidChangeActiveFile: vscode.Event<string | undefined>;
}

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private branchTree: BranchTreeState = { phase: "hidden", entries: [] };
  private branchTreeRequestId = 0;
  private commitDiff: CommitDiffState = { phase: "hidden", files: [] };
  private commitDiffRequestId = 0;
  private localScopeKey = "";
  private activeTab: "review" | "my-work" = "review";
  private myWorkPollingTimer?: ReturnType<typeof setInterval>;
  private updateScheduled = false;
  private readonly expandedThreadIds = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ReviewStore,
    private readonly navigator: ReviewNavigator,
    private readonly glabAuth: GlabAuthService,
    private readonly localGit: LocalGitService,
    private readonly myWork: MyWorkStore,
    private readonly commentImages: CommentImageService
  ) {
    this.context.subscriptions.push(
      this.store.onDidChange(() => {
        const overview = this.store.getOverview();
        if (this.store.getIsRefreshing() && this.branchTree.phase !== "hidden") {
          this.branchTreeRequestId += 1;
          this.branchTree = { phase: "hidden", entries: [] };
        }
        if (!isCommitDiffValid(this.commitDiff, overview)) {
          this.commitDiffRequestId += 1;
          this.commitDiff = { phase: "hidden", files: [] };
        }
        const nextLocalScopeKey = `${overview.selectedMergeRequest?.projectId ?? ""}!${overview.selectedMergeRequest?.iid ?? ""}:${overview.sourceBranch}`;
        if (nextLocalScopeKey !== this.localScopeKey) {
          this.localScopeKey = nextLocalScopeKey;
          this.expandedThreadIds.clear();
          void this.refreshLocalWorkspace();
        }
        this.pushUpdate();
      }),
      this.glabAuth.onDidChangeState((state) => {
        this.pushUpdate();
        if (state.phase === "available" && this.activeTab === "my-work") void this.myWork.refresh();
      }),
      this.localGit.onDidChange(() => this.pushUpdate()),
      this.myWork.onDidChange(() => this.pushUpdate()),
      this.navigator.onDidChangeActiveFile(() => this.pushUpdate())
    );
    this.context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused && this.activeTab === "review") {
          void this.refreshLocalWorkspace();
        }
      })
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.onDidReceiveMessage((message: SidebarMessage) => void this.handleMessage(message));
    webviewView.onDidChangeVisibility(() => {
      this.updateMyWorkPolling();
      if (webviewView.visible && this.activeTab === "my-work") void this.myWork.refresh();
      if (webviewView.visible) this.pushUpdate();
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.stopMyWorkPolling();
      }
    });
    // Register the receiver before loading the Vue bundle so its initial
    // `ready` message cannot race past the extension host.
    configureWebview(webviewView.webview, this.context.extensionUri, "sidebar", [vscode.Uri.file(this.commentImages.cacheRootPath)]);
    if (this.activeTab === "review") void this.refreshLocalWorkspace();
  }

  dispose(): void {
    this.stopMyWorkPolling();
  }

  private pushUpdate(): void {
    if (!this.view?.visible || this.updateScheduled) return;
    this.updateScheduled = true;
    queueMicrotask(() => {
      this.updateScheduled = false;
      this.deliverUpdate();
    });
  }

  private deliverUpdate(): void {
    if (!this.view?.visible) return;
    const auth = this.glabAuth.getState();
    const overview = this.store.getOverview();
    const detailIds = new Set(this.expandedThreadIds);
    if (overview.threads.length <= 20) {
      for (const thread of overview.threads) {
        if (!thread.resolved) detailIds.add(thread.id);
      }
    }
    const state = createSidebarViewState(
      overview,
      { phase: auth.phase, hostname: auth.hostname, reason: auth.reason },
      this.branchTree,
      this.commitDiff,
      this.navigator.getActiveFilePath(),
      this.localGit.getState(overview.sourceBranch, overview.selectedMergeRequest?.projectId),
      this.activeTab,
      this.myWork.getState(),
      this.store.getThreadDetails([...detailIds])
    );
    void this.view.webview.postMessage({ type: "state", state } satisfies HostMessage<SidebarViewState>);
  }

  private async handleMessage(message: SidebarMessage): Promise<void> {
    switch (message.type) {
      case "ready": this.pushUpdate(); return;
      case "openFile": this.navigator.openFile(message.filePath, message.line, message.threadId); return;
      case "toggleBranchTree": await this.toggleBranchTree(message.branch); return;
      case "closeBranchTree":
        this.branchTreeRequestId += 1;
        this.branchTree = { phase: "hidden", entries: [] };
        this.pushUpdate();
        return;
      case "openBranchFile": await this.navigator.openBranchFile(message.branch, message.filePath); return;
      case "openCommitFile": await this.navigator.openCommitDiffFile(message.commitId, message.filePath); return;
      case "addComment": await this.store.addComment(message.threadId, message.body); return;
      case "addOverviewThread": await this.store.addOverviewThread(message.body, message.mode); return;
      case "publishReviewDraft": await this.store.publishReviewDraft(message.draftId); return;
      case "submitReview": await this.store.submitReview(); return;
      case "editComment": await this.store.editComment(message.threadId, message.commentId, message.body); return;
      case "toggleResolved": await this.store.toggleResolved(message.threadId); return;
      case "setThreadExpanded":
        if (message.expanded) this.expandedThreadIds.add(message.threadId);
        else this.expandedThreadIds.delete(message.threadId);
        this.pushUpdate();
        return;
      case "login": await this.glabAuth.startLogin(); return;
      case "refreshAuth": await this.glabAuth.refreshStatus(); return;
      case "refreshReview": await this.store.refresh(); return;
      case "refreshLocalWorkspace": await this.refreshLocalWorkspace(); return;
      case "switchCurrentWorkspace": await this.switchCurrentWorkspace(message.branch); return;
      case "openExistingWorktree": await this.openExistingWorktree(message.path); return;
      case "createWorktree": await this.createWorktree(message.branch); return;
      case "showRemoteBranchInstructions": this.showRemoteBranchInstructions(); return;
      case "setThreadSort": await this.store.setThreadSortOrder(message.order); return;
      case "setSidebarTab": await this.setSidebarTab(message.tab); return;
      case "refreshMyWork": await this.myWork.refresh(); return;
      case "openMyWorkMergeRequest": await this.openMyWorkMergeRequest(message.projectId, message.iid); return;
      case "uploadCommentImage": await this.handleCommentImage(message); return;
      case "resolveCommentImage": await this.handleCommentImage(message); return;
      case "openCommit": await this.openCommit(message.commitId); return;
      case "toggleCommit": await this.toggleCommit(message.commitId); return;
      case "collapseCommit":
        this.commitDiffRequestId += 1;
        this.commitDiff = { phase: "hidden", files: [] };
        this.pushUpdate();
        return;
    }
  }

  private async handleCommentImage(message: CommentImageWebviewMessage): Promise<void> {
    const webview = this.view?.webview;
    if (!webview) return;
    const selected = this.store.getOverview().selectedMergeRequest;
    if (!selected || selected.projectId !== message.projectId) {
      await this.postCommentImageFailure(webview, message, "The image request does not match the selected merge request.");
      return;
    }
    try {
      if (message.type === "uploadCommentImage") {
        const result = await this.commentImages.upload(message);
        await webview.postMessage({
          type: "commentImageUploaded",
          requestId: message.requestId,
          markdown: result.markdown,
          imagePath: result.imagePath,
          displayUri: webview.asWebviewUri(vscode.Uri.file(result.cachePath)).toString()
        } satisfies HostMessage<SidebarViewState>);
      } else {
        const result = await this.commentImages.resolve(message);
        await webview.postMessage({
          type: "commentImageResolved",
          requestId: message.requestId,
          imagePath: message.imagePath,
          displayUri: webview.asWebviewUri(vscode.Uri.file(result.cachePath)).toString(),
          fallbackUrl: result.fallbackUrl
        } satisfies HostMessage<SidebarViewState>);
      }
    } catch (error) {
      const fallbackUrl = error instanceof CommentImageServiceError ? error.fallbackUrl : undefined;
      const errorMessage = error instanceof CommentImageServiceError ? error.message : "GitLab comment image could not be processed.";
      await this.postCommentImageFailure(webview, message, errorMessage, fallbackUrl);
    }
  }

  private async postCommentImageFailure(
    webview: vscode.Webview,
    message: CommentImageWebviewMessage,
    errorMessage: string,
    fallbackUrl?: string
  ): Promise<void> {
    if (message.type === "uploadCommentImage") {
      await webview.postMessage({
        type: "commentImageUploadFailed",
        requestId: message.requestId,
        message: errorMessage
      } satisfies HostMessage<SidebarViewState>);
    } else {
      await webview.postMessage({
        type: "commentImageResolveFailed",
        requestId: message.requestId,
        imagePath: message.imagePath,
        message: errorMessage,
        fallbackUrl
      } satisfies HostMessage<SidebarViewState>);
    }
  }

  private async setSidebarTab(tab: "review" | "my-work"): Promise<void> {
    const changed = this.activeTab !== tab;
    this.activeTab = tab;
    this.updateMyWorkPolling();
    this.pushUpdate();
    if (!changed) return;
    if (tab === "my-work") {
      await this.myWork.refresh();
    } else {
      await this.refreshLocalWorkspace();
    }
  }

  private async openMyWorkMergeRequest(projectId: string, iid: number): Promise<void> {
    const selection = this.store.selectMergeRequest(projectId, iid);
    this.activeTab = "review";
    this.updateMyWorkPolling();
    this.pushUpdate();
    await selection;
  }

  private updateMyWorkPolling(): void {
    this.stopMyWorkPolling();
    if (this.activeTab !== "my-work" || !this.view?.visible) return;
    this.myWorkPollingTimer = setInterval(() => void this.myWork.refresh(), 3 * 60 * 1000);
  }

  private stopMyWorkPolling(): void {
    if (!this.myWorkPollingTimer) return;
    clearInterval(this.myWorkPollingTimer);
    this.myWorkPollingTimer = undefined;
  }

  private async refreshLocalWorkspace(): Promise<void> {
    const overview = this.store.getOverview();
    await this.localGit.refresh(overview.sourceBranch, overview.selectedMergeRequest?.projectId);
    this.pushUpdate();
  }

  private async switchCurrentWorkspace(branch: string): Promise<void> {
    const state = this.localGit.getState(this.store.getOverview().sourceBranch, this.store.getOverview().selectedMergeRequest?.projectId);
    if (state.target.kind !== "local-branch" || state.target.branch !== branch || state.dirty.total > 0) {
      void vscode.window.showWarningMessage("現在のworkspaceは安全に切り替えられない状態です。", { modal: true });
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `現在のworkspaceを ${branch} に切り替えますか？`,
      { modal: true },
      "切り替える"
    );
    if (choice !== "切り替える") return;
    try {
      await this.localGit.switchCurrentWorkspace(branch);
      await this.refreshLocalWorkspace();
      await this.rememberWorkspaceAssociation(this.localGit.getState(branch, this.store.getOverview().selectedMergeRequest?.projectId).repositoryRoot);
      void vscode.window.showInformationMessage(`Workspaceを ${branch} に切り替えました。`);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Workspaceの切り替えに失敗しました。");
      await this.refreshLocalWorkspace();
    }
  }

  private async openExistingWorktree(path: string): Promise<void> {
    if (!path) return;
    const overview = this.store.getOverview();
    const state = this.localGit.getState(overview.sourceBranch, overview.selectedMergeRequest?.projectId);
    if (state.target.kind !== "existing-worktree" || state.target.path !== path) {
      await this.refreshLocalWorkspace();
      void vscode.window.showWarningMessage("このworktreeの状態が変わっています。最新のローカル状態を確認してください。");
      return;
    }
    try {
      await this.localGit.openWorktree(path);
      await this.rememberWorkspaceAssociation(path);
    } catch {
      void vscode.window.showErrorMessage("既存worktreeを別windowで開けませんでした。");
    }
  }

  private async createWorktree(branch: string): Promise<void> {
    const state = this.localGit.getState(this.store.getOverview().sourceBranch, this.store.getOverview().selectedMergeRequest?.projectId);
    if (state.target.kind !== "local-branch" || state.target.branch !== branch) {
      void vscode.window.showWarningMessage("このbranchは新しいworktreeを作成できるlocal branchではありません。", { modal: true });
      return;
    }
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "この場所にworktreeを作成"
    });
    const path = folders?.[0]?.fsPath;
    if (!path) return;
    const choice = await vscode.window.showWarningMessage(
      `${path} に ${branch} のworktreeを作成しますか？`,
      { modal: true },
      "作成して開く"
    );
    if (choice !== "作成して開く") return;
    try {
      await this.localGit.createWorktree(branch, path);
      await this.rememberWorkspaceAssociation(path);
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path), true);
      await this.refreshLocalWorkspace();
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "worktreeの作成に失敗しました。");
      await this.refreshLocalWorkspace();
    }
  }

  private showRemoteBranchInstructions(): void {
    void vscode.window.showInformationMessage(
      "このbranchはremoteにのみ存在します。自動でfetchやbranch作成は行いません。必要であればGitのSource Controlまたはターミナルからlocal branchを作成してください。"
    );
  }

  private async rememberWorkspaceAssociation(worktreePath?: string): Promise<void> {
    const overview = this.store.getOverview();
    const selected = overview.selectedMergeRequest;
    if (!selected || !overview.sourceBranch) return;
    const state = this.localGit.getState(overview.sourceBranch, selected.projectId);
    await this.store.rememberWorkspaceAssociation({
      projectId: selected.projectId,
      mergeRequestIid: selected.iid,
      sourceBranch: overview.sourceBranch,
      repositoryRoot: state.repositoryRoot,
      worktreePath,
      lastOpenedAt: new Date().toISOString()
    });
  }

  private async openCommit(commitId: string): Promise<void> {
    const commit = this.store.getOverview().commits.find((candidate) => candidate.id === commitId);
    if (!commit?.webUrl) return;
    try {
      const uri = vscode.Uri.parse(commit.webUrl, true);
      if (uri.scheme === "https" || uri.scheme === "http") await vscode.env.openExternal(uri);
    } catch {
      // Remote URLs are optional and treated as untrusted input.
    }
  }

  private async toggleCommit(commitId: string): Promise<void> {
    const overview = this.store.getOverview();
    const mrKey = overviewMergeRequestKey(overview);
    if (!mrKey || !overview.commits.some((commit) => commit.id === commitId)) return;
    if (this.commitDiff.phase !== "hidden" && this.commitDiff.mrKey === mrKey && this.commitDiff.commitId === commitId) {
      // Selection is idempotent. Collapsing is an explicit `collapseCommit`
      // action so duplicate webview messages cannot hide an active filter.
      return;
    }
    const requestId = ++this.commitDiffRequestId;
    this.commitDiff = { phase: "loading", mrKey, commitId, files: [] };
    this.pushUpdate();
    try {
      const files = await this.store.loadCommitDiff(commitId);
      if (requestId !== this.commitDiffRequestId || overviewMergeRequestKey(this.store.getOverview()) !== mrKey) return;
      this.commitDiff = {
        phase: "ready",
        mrKey,
        commitId,
        files: files.map(({ diff: _diff, ...file }) => file)
      };
    } catch {
      if (requestId !== this.commitDiffRequestId || overviewMergeRequestKey(this.store.getOverview()) !== mrKey) return;
      this.commitDiff = { phase: "error", mrKey, commitId, files: [], errorMessage: "コミット差分を取得できませんでした。" };
    }
    this.pushUpdate();
  }

  private async toggleBranchTree(branch: string): Promise<void> {
    if (this.branchTree.branch === branch) {
      this.branchTreeRequestId += 1;
      this.branchTree = { phase: "hidden", entries: [] };
      this.pushUpdate();
      return;
    }
    const requestId = ++this.branchTreeRequestId;
    this.branchTree = { phase: "loading", branch, entries: [] };
    this.pushUpdate();
    try {
      const entries = await this.store.loadBranchTree(branch);
      if (requestId !== this.branchTreeRequestId) return;
      this.branchTree = { phase: "ready", branch, entries };
    } catch {
      if (requestId !== this.branchTreeRequestId) return;
      this.branchTree = { phase: "error", branch, entries: [], errorMessage: "ブランチのファイル一覧を取得できませんでした。" };
    }
    this.pushUpdate();
  }
}

function overviewMergeRequestKey(overview: ReviewOverview): string | undefined {
  const selected = overview.selectedMergeRequest;
  return selected ? `${selected.projectId}!${selected.iid}` : undefined;
}

function isCommitDiffValid(state: CommitDiffState, overview: ReviewOverview): boolean {
  if (state.phase === "hidden") return true;
  return state.mrKey === overviewMergeRequestKey(overview)
    && Boolean(state.commitId && overview.commits.some((commit) => commit.id === state.commitId));
}
