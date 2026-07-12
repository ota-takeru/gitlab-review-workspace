import * as vscode from "vscode";
import { ReviewStore } from "./reviewStore";
import { CommitDiffMessage, CommitDiffViewState, HostMessage } from "./webviewProtocol";
import { configureWebview } from "./webviewHost";

export class CommitDiffPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ReviewStore
  ) {}

  async open(commitId: string, filePath: string): Promise<void> {
    const before = this.store.getOverview();
    const selectedKey = before.selectedMergeRequest
      ? `${before.selectedMergeRequest.projectId}!${before.selectedMergeRequest.iid}`
      : undefined;
    const commit = before.commits.find((candidate) => candidate.id === commitId);
    if (!commit || !selectedKey) return;

    try {
      const files = await this.store.loadCommitDiff(commitId);
      const after = this.store.getOverview();
      const afterKey = after.selectedMergeRequest
        ? `${after.selectedMergeRequest.projectId}!${after.selectedMergeRequest.iid}`
        : undefined;
      if (afterKey !== selectedKey || !after.commits.some((candidate) => candidate.id === commitId)) return;
      const file = files.find((candidate) => candidate.path === filePath);
      if (!file) return;

      const key = `${selectedKey}\0${commitId}\0${filePath}`;
      const existing = this.panels.get(key);
      if (existing) {
        existing.reveal(vscode.ViewColumn.One);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "gitlabReview.commitDiff",
        `${basename(file.path)} · ${commit.shortId}`,
        vscode.ViewColumn.One,
        { retainContextWhenHidden: true }
      );
      let state: CommitDiffViewState = { commit, file };
      const postState = (): void => {
        const hostMessage: HostMessage<CommitDiffViewState> = { type: "state", state };
        void panel.webview.postMessage(hostMessage);
      };
      const loadFullFile = async (): Promise<void> => {
        if (state.fullFile || state.fullFileLoading) return;
        state = { ...state, fullFileLoading: true, fullFileError: undefined };
        postState();
        try {
          const fullFile = await this.store.loadCommitFileContents(commitId, file);
          state = { ...state, fullFile, fullFileLoading: false };
        } catch {
          state = {
            ...state,
            fullFileLoading: false,
            fullFileError: "ファイル全体を読み込めませんでした。"
          };
        }
        postState();
      };
      const messageListener = panel.webview.onDidReceiveMessage((message: CommitDiffMessage) => {
        if (message?.type === "ready") {
          postState();
        } else if (message?.type === "loadFullFile") {
          void loadFullFile();
        }
      });
      // The Vue app posts `ready` as soon as it mounts, so attach the
      // receiver before assigning the Webview HTML.
      configureWebview(panel.webview, this.context.extensionUri, "commit-diff");
      panel.onDidDispose(() => {
        messageListener.dispose();
        this.panels.delete(key);
      });
      this.panels.set(key, panel);
    } catch {
      void vscode.window.showErrorMessage("コミットのファイル差分を開けませんでした。");
    }
  }

  dispose(): void {
    for (const panel of [...this.panels.values()]) panel.dispose();
    this.panels.clear();
  }
}

function basename(filePath: string): string {
  return filePath.split("/").at(-1) || filePath;
}
