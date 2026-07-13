import * as vscode from "vscode";
import { BranchFileEditor } from "./branchFileEditor";
import { CommentImageService } from "./commentImageService";
import { GlabAuthService } from "./glabAuth";
import { GitLabHostResolver } from "./gitlabHostResolver";
import { LocalGitService } from "./localGitService";
import { MyWorkStore } from "./myWorkStore";
import { ReviewFilePanelManager } from "./reviewFilePanel";
import { ReviewStore } from "./reviewStore";
import { SidebarProvider } from "./sidebarProvider";

export function activate(context: vscode.ExtensionContext): void {
  const hostResolver = new GitLabHostResolver();
  const store = new ReviewStore(context, () => hostResolver.getBaseUrl());
  const glabAuth = new GlabAuthService(hostResolver);
  const localGit = new LocalGitService(context);
  const myWork = new MyWorkStore(context, () => hostResolver.getBaseUrl());
  const commentImages = new CommentImageService(
    context.globalStorageUri.fsPath,
    () => hostResolver.getBaseUrl()
  );
  const filePanels = new ReviewFilePanelManager(context, store, localGit, commentImages);
  const branchFiles = new BranchFileEditor(store);
  const sidebar = new SidebarProvider(context, store, {
    openFile: (filePath, line, threadId) => filePanels.openFile(filePath, line, threadId),
    openBranchFile: (branch, filePath) => branchFiles.open(branch, filePath),
    openCommitDiffFile: (commitId, filePath) => filePanels.openCommitFile(commitId, filePath),
    getActiveFilePath: () => filePanels.getActiveFilePath(),
    onDidChangeActiveFile: filePanels.onDidChangeActiveFile
  }, glabAuth, localGit, myWork, commentImages);
  const authListener = glabAuth.onDidChangeState((state) => {
    if (state.phase === "available") {
      void store.refresh();
    } else if (state.phase === "signedOut") {
      void commentImages.clearCache().catch(() => undefined);
    }
  });
  const imageCacheConfigurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("gitlabReview.gitlabBaseUrl")) {
      void commentImages.clearCache().catch(() => undefined);
      void glabAuth.refreshStatus();
    }
  });

  context.subscriptions.push(
    glabAuth,
    localGit,
    myWork,
    sidebar,
    authListener,
    imageCacheConfigurationListener,
    filePanels,
    branchFiles,
    vscode.workspace.registerFileSystemProvider(branchFiles.scheme, branchFiles, { isReadonly: true }),
    vscode.window.registerWebviewViewProvider("gitlabReview.sidebar", sidebar, {
      webviewOptions: {
        retainContextWhenHidden: false
      }
    }),
    vscode.commands.registerCommand(
      "gitlabReview.openFile",
      (filePath?: string, line?: number, threadId?: string) => {
        const targetFile = filePath ?? store.getOverview().files[0]?.path;
        if (!targetFile) {
          void vscode.window.showInformationMessage("No review files are available.");
          return;
        }

        filePanels.openFile(targetFile, line, threadId);
      }
    ),
    vscode.commands.registerCommand("gitlabReview.login", () => glabAuth.startLogin()),
    vscode.commands.registerCommand("gitlabReview.refreshAuth", () => glabAuth.refreshStatus()),
    vscode.commands.registerCommand("gitlabReview.refreshReview", () => store.refresh())
  );

  void glabAuth.refreshStatus();
}

export function deactivate(): void {
  // VS Code disposes registered subscriptions for this extension context.
}
