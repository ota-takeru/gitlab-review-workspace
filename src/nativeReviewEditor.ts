import * as path from "node:path";
import * as vscode from "vscode";
import { CommentImageService, detectCommentImageMimeType } from "./commentImageService";
import { commentImageMimeTypes, type CommentImageMimeType } from "./commentImageTypes";
import { LocalGitService } from "./localGitService";
import {
  appendCommentMarkdown,
  nativeThreadLocation,
  normalizeTextForComparison,
  oldLineForMrLine,
  privateCommentImagePaths,
  type NativeReviewSide
} from "./nativeReviewUtils";
import { reviewContextKey, sameReviewContext, type ReviewContext, type ReviewMutationResult } from "./reviewContext";
import { ReviewStore } from "./reviewStore";
import type { ReviewComment, ReviewFileView, ReviewReaction, ReviewThread } from "./reviewTypes";

const nativeCommentControllerId = "gitlabReview.nativeComments";
const commentInputScheme = "comment";
const imagePasteKind = vscode.DocumentDropOrPasteEditKind.Empty.append("gitlabReview", "commentImage");

type NativeComparisonKind = "merge-request" | "latest-push" | "commit";
type NativeThreadMode = "all" | "head-only" | "none";

interface NativeReviewDocument {
  uri: vscode.Uri;
  text: string;
  filePath: string;
  side: NativeReviewSide;
  context: ReviewContext;
  sessionKey: string;
  allowNewComments: boolean;
}

interface NativeReviewSession {
  key: string;
  context: ReviewContext;
  filePath: string;
  file: ReviewFileView;
  base: NativeReviewDocument;
  head: NativeReviewDocument;
  comparisonKind: NativeComparisonKind;
  threadMode: NativeThreadMode;
  allowNewComments: boolean;
  stale: boolean;
  threads: Map<string, vscode.CommentThread>;
}

interface NativeThreadBinding {
  sessionKey: string;
  filePath: string;
  context: ReviewContext;
  reviewThreadId?: string;
}

interface NativeCommentBinding {
  nativeThread: vscode.CommentThread;
  filePath: string;
  reviewThreadId: string;
  reviewCommentId: string;
  context: ReviewContext;
  originalBody: string;
}

class GitLabNativeComment implements vscode.Comment {
  body: string | vscode.MarkdownString;
  mode = vscode.CommentMode.Preview;
  author: vscode.CommentAuthorInformation;
  contextValue?: string;
  label?: string;
  timestamp?: Date;
  reactions?: vscode.CommentReaction[];

  constructor(
    readonly reviewCommentId: string,
    comment: ReviewComment,
    renderedBody: vscode.MarkdownString
  ) {
    this.body = renderedBody;
    this.author = {
      name: comment.author || "GitLab user",
      iconPath: safeUri(comment.avatarUrl)
    };
    this.contextValue = comment.canEdit && !comment.pending
      ? "gitlabReview.native.editable"
      : "gitlabReview.native.readonly";
    this.label = comment.pending ? "Sending…" : editedLabel(comment);
    this.timestamp = safeDate(comment.createdAt);
    this.reactions = toNativeReactions(comment.reactions ?? []);
  }
}

class NativeImagePasteEdit extends vscode.DocumentPasteEdit {
  constructor(
    readonly bytes: Uint8Array,
    readonly filename: string,
    readonly mimeType: CommentImageMimeType,
    readonly context: ReviewContext
  ) {
    super("", "Upload image to GitLab", imagePasteKind);
  }
}

export class NativeReviewEditor implements vscode.TextDocumentContentProvider, vscode.Disposable {
  readonly scheme = "gitlab-review-diff";

  private readonly documents = new Map<string, NativeReviewDocument>();
  private readonly sessions = new Map<string, NativeReviewSession>();
  private readonly threadBindings = new WeakMap<vscode.CommentThread, NativeThreadBinding>();
  private readonly commentBindings = new WeakMap<vscode.Comment, NativeCommentBinding>();
  private readonly renderedCommentBodies = new Map<string, vscode.MarkdownString>();
  private readonly pendingCommentBodyLoads = new Set<string>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly onDidChangeActiveFileEmitter = new vscode.EventEmitter<string | undefined>();
  private readonly onDidRequestRevealThreadEmitter = new vscode.EventEmitter<string>();
  private readonly controller = vscode.comments.createCommentController(
    nativeCommentControllerId,
    "GitLab Merge Request"
  );
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingThreads = new WeakSet<vscode.CommentThread>();
  private readonly pendingUploads = new WeakSet<vscode.CommentThread>();
  private readonly pendingComments = new WeakSet<vscode.Comment>();
  private readonly pendingReactions = new WeakSet<vscode.Comment>();
  private activeFilePath?: string;
  private openGeneration = 0;
  private observedContextKey?: string;

  readonly onDidChange = this.onDidChangeEmitter.event;
  readonly onDidChangeActiveFile = this.onDidChangeActiveFileEmitter.event;
  readonly onDidRequestRevealThread = this.onDidRequestRevealThreadEmitter.event;

  constructor(
    private readonly store: ReviewStore,
    private readonly localGit: LocalGitService,
    private readonly commentImages: CommentImageService
  ) {
    this.controller.options = {
      prompt: "Reply to this GitLab discussion",
      placeHolder: "Write a GitLab comment (Markdown supported)"
    };
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => this.provideCommentingRanges(document)
    };
    this.controller.reactionHandler = (comment, reaction) => this.toggleReaction(comment, reaction);
    const initialContext = this.store.getReviewContext();
    this.observedContextKey = initialContext ? reviewContextKey(initialContext) : undefined;

    this.disposables.push(
      this.controller,
      this.onDidChangeEmitter,
      this.onDidRequestRevealThreadEmitter,
      this.store.onDidChange(() => this.syncFromStore()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateActiveFilePath()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.updateActiveFilePath()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.updateActiveFilePath()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.updateActiveFilePath()),
      vscode.workspace.onDidCloseTextDocument((document) => this.handleClosedDocument(document)),
      vscode.commands.registerCommand("gitlabReview.nativeComment.submit", (reply: vscode.CommentReply) =>
        this.submitComment(reply)
      ),
      vscode.commands.registerCommand("gitlabReview.nativeComment.uploadAndSubmit", (reply: vscode.CommentReply) =>
        this.uploadAndSubmit(reply)
      ),
      vscode.commands.registerCommand("gitlabReview.nativeComment.resolve", (thread: vscode.CommentThread) =>
        this.setResolved(thread, true)
      ),
      vscode.commands.registerCommand("gitlabReview.nativeComment.reopen", (thread: vscode.CommentThread) =>
        this.setResolved(thread, false)
      ),
      vscode.commands.registerCommand("gitlabReview.nativeComment.edit", (comment: GitLabNativeComment) =>
        this.startEdit(comment)
      ),
      vscode.commands.registerCommand("gitlabReview.nativeComment.saveEdit", (comment: GitLabNativeComment) =>
        this.saveEdit(comment)
      ),
      vscode.commands.registerCommand("gitlabReview.nativeComment.cancelEdit", (comment: GitLabNativeComment) =>
        this.cancelEdit(comment)
      ),
      vscode.commands.registerCommand("gitlabReview.nativeComment.revealInSidebar", (comment: vscode.Comment) =>
        this.requestRevealInSidebar(comment)
      ),
      vscode.languages.registerDocumentPasteEditProvider(
        { scheme: commentInputScheme },
        {
          provideDocumentPasteEdits: (document, _ranges, dataTransfer) =>
            this.provideImagePasteEdits(document, dataTransfer),
          resolveDocumentPasteEdit: (edit, token) => this.resolveImagePasteEdit(edit, token)
        },
        {
          providedPasteEditKinds: [imagePasteKind],
          pasteMimeTypes: [...commentImageMimeTypes, "files"]
        }
      )
    );
    this.updateActiveFilePath();
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString())?.text ?? "";
  }

  getActiveFilePath(): string | undefined {
    return this.activeFilePath;
  }

  async openFile(filePath: string, line?: number, threadId?: string): Promise<void> {
    const overview = this.store.getOverview();
    const selected = overview.selectedMergeRequest;
    if (!selected) {
      void vscode.window.showInformationMessage("No merge request is selected.");
      return;
    }
    const context = this.captureReviewContext();
    if (!context) {
      void vscode.window.showInformationMessage("The current merge request is still loading. Refresh it and try again.");
      return;
    }
    const generation = ++this.openGeneration;
    const sourceBranch = overview.sourceBranch;
    const projectIdentity = this.store.getProjectIdentity();
    let key: string | undefined;
    let session: NativeReviewSession | undefined;

    try {
      const contents = await this.store.loadReviewFileContents(filePath);
      this.ensureOpenIsCurrent(generation, context);
      const viewModel = this.store.getFileViewModel(filePath, {
        includeEditableText: true,
        targetLine: line
      });
      if (!viewModel) throw new Error("The review file is unavailable.");

      key = sessionKey(context, "merge-request", viewModel.file.path);
      const base = this.createVirtualDocument(
        key,
        context,
        viewModel.file.path,
        "base",
        contents.oldText,
        false
      );
      const head = await this.createHeadDocument(
        key,
        context,
        projectIdentity,
        sourceBranch,
        viewModel.file,
        contents.mrText
      );
      this.ensureOpenIsCurrent(generation, context);

      const previous = this.sessions.get(key);
      session = {
        key,
        context,
        filePath: viewModel.file.path,
        file: viewModel.file,
        base,
        head,
        comparisonKind: "merge-request",
        threadMode: "all",
        allowNewComments: !viewModel.file.deletedFile,
        stale: false,
        threads: previous?.threads ?? new Map()
      };
      this.sessions.set(key, session);
      this.syncSessionThreads(session);

      const targetThread = threadId
        ? viewModel.threads.find((thread) => thread.id === threadId)
        : undefined;
      if (targetThread) {
        const nativeTargetThread = session.threads.get(targetThread.id);
        if (nativeTargetThread) nativeTargetThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      }
      const targetLocation = targetThread ? nativeThreadLocation(targetThread) : undefined;
      const targetLine = targetLocation?.line ?? line;
      const selection = typeof targetLine === "number" && targetLine > 0
        ? new vscode.Range(targetLine - 1, 0, targetLine - 1, 0)
        : undefined;

      await vscode.commands.executeCommand(
        "vscode.diff",
        base.uri,
        head.uri,
        `${path.basename(viewModel.file.path)} — MR !${selected.iid}`,
        { preview: true, selection }
      );
      if (generation !== this.openGeneration) {
        this.disposeStaleOpen(key, session);
        return;
      }
      this.updateActiveFilePath();
    } catch (error) {
      if (isStaleNativeReviewError(error) || !this.sameCurrentContext(context)) {
        this.disposeStaleOpen(key, session);
        if (!this.sameCurrentContext(context)) void this.offerCurrentMrDiff(context, filePath, line);
        return;
      }
      if (generation !== this.openGeneration) {
        this.disposeStaleOpen(key, session);
        return;
      }
      this.disposeStaleOpen(key, session);
      void vscode.window.showErrorMessage(`VS Code の差分エディターで ${filePath} を開けませんでした。`);
    }
  }

  async openCommitFile(commitId: string, filePath: string): Promise<void> {
    const overview = this.store.getOverview();
    const selected = overview.selectedMergeRequest;
    if (!selected) {
      void vscode.window.showInformationMessage("No merge request is selected.");
      return;
    }
    const reviewContext = this.captureReviewContext();
    if (!reviewContext) {
      void vscode.window.showInformationMessage("The current merge request is still loading. Refresh it and try again.");
      return;
    }
    const generation = ++this.openGeneration;
    let key: string | undefined;
    let session: NativeReviewSession | undefined;
    try {
      const context = await this.store.loadCommitFileReviewContext(commitId, filePath);
      this.ensureOpenIsCurrent(generation, reviewContext);
      const contents = await this.store.loadCommitFileContents(commitId, context.file);
      this.ensureOpenIsCurrent(generation, reviewContext);
      const viewModel = this.store.buildCommitFileViewModel({ ...context, contents }, { targetLine: undefined });
      const currentHeadCommit = commitId === reviewContext.headSha || context.commit.id === reviewContext.headSha;
      const historical = !currentHeadCommit;
      key = sessionKey(reviewContext, "commit", `${commitId}:${viewModel.file.path}`);
      await this.openVirtualComparison(
        generation,
        reviewContext,
        viewModel.file,
        contents.oldText,
        contents.newText,
        key,
        `${path.basename(viewModel.file.path)} — commit ${context.commit.shortId}${historical ? " (read-only; open current MR diff to comment)" : ""}`,
        "commit",
        currentHeadCommit ? "head-only" : "none",
        currentHeadCommit && !viewModel.file.deletedFile
      );
      session = this.sessions.get(key);
    } catch (error) {
      if (isStaleNativeReviewError(error) || !this.sameCurrentContext(reviewContext)) {
        this.disposeStaleOpen(key, session);
        if (!this.sameCurrentContext(reviewContext)) void this.offerCurrentMrDiff(reviewContext, filePath);
        return;
      }
      if (generation !== this.openGeneration) {
        this.disposeStaleOpen(key, session);
        return;
      }
      this.disposeStaleOpen(key, session);
      void vscode.window.showErrorMessage(`VS Code の差分エディターで ${filePath} を開けませんでした。`);
    }
  }

  async openNewChangesFile(filePath: string): Promise<void> {
    const overview = this.store.getOverview();
    const selected = overview.selectedMergeRequest;
    if (!selected) {
      void vscode.window.showInformationMessage("No merge request is selected.");
      return;
    }
    const reviewContext = this.captureReviewContext();
    if (!reviewContext) {
      void vscode.window.showInformationMessage("The current merge request is still loading. Refresh it and try again.");
      return;
    }
    const generation = ++this.openGeneration;
    let key: string | undefined;
    let session: NativeReviewSession | undefined;
    try {
      const context = await this.store.loadNewChangesFileReviewContext(filePath);
      this.ensureOpenIsCurrent(generation, reviewContext);
      if (!context) throw new Error("The file is not part of the latest push.");
      const contents = await this.store.loadNewChangesFileContents(context);
      this.ensureOpenIsCurrent(generation, reviewContext);
      const viewModel = this.store.buildNewChangesFileViewModel({ ...context, contents });
      key = sessionKey(reviewContext, "latest-push", `${context.range.fromSha}:${context.range.toSha}:${viewModel.file.path}`);
      await this.openVirtualComparison(
        generation,
        reviewContext,
        viewModel.file,
        contents.oldText,
        contents.newText,
        key,
        `${path.basename(viewModel.file.path)} — latest push`,
        "latest-push",
        "head-only",
        !viewModel.file.deletedFile
      );
      session = this.sessions.get(key);
    } catch (error) {
      if (isStaleNativeReviewError(error) || !this.sameCurrentContext(reviewContext)) {
        this.disposeStaleOpen(key, session);
        if (!this.sameCurrentContext(reviewContext)) void this.offerCurrentMrDiff(reviewContext, filePath);
        return;
      }
      if (generation !== this.openGeneration) {
        this.disposeStaleOpen(key, session);
        return;
      }
      this.disposeStaleOpen(key, session);
      void vscode.window.showErrorMessage(`VS Code の差分エディターで最新pushの ${filePath} を開けませんでした。`);
    }
  }

  private async openVirtualComparison(
    generation: number,
    context: ReviewContext,
    file: ReviewFileView,
    oldText: string,
    newText: string,
    key: string,
    title: string,
    comparisonKind: NativeComparisonKind,
    threadMode: NativeThreadMode,
    allowNewComments: boolean
  ): Promise<void> {
    this.ensureOpenIsCurrent(generation, context);
    const base = this.createVirtualDocument(key, context, file.path, "base", oldText, false);
    const head = this.createVirtualDocument(key, context, file.path, "head", newText, allowNewComments);
    const previous = this.sessions.get(key);
    const session: NativeReviewSession = {
      key,
      context,
      filePath: file.path,
      file,
      base,
      head,
      comparisonKind,
      threadMode,
      allowNewComments,
      stale: false,
      threads: previous?.threads ?? new Map()
    };
    this.sessions.set(key, session);
    this.syncSessionThreads(session);
    try {
      await vscode.commands.executeCommand("vscode.diff", base.uri, head.uri, title, { preview: true });
    } catch (error) {
      this.disposeStaleOpen(key, session);
      throw error;
    }
    if (generation !== this.openGeneration) {
      this.disposeStaleOpen(key, session);
      throw new StaleNativeReviewError();
    }
    this.ensureOpenIsCurrent(generation, context);
    this.updateActiveFilePath();
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      this.disposeSession(session);
    }
    this.sessions.clear();
    this.documents.clear();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.onDidChangeActiveFileEmitter.dispose();
  }

  private createVirtualDocument(
    key: string,
    context: ReviewContext,
    filePath: string,
    side: NativeReviewSide,
    text: string,
    allowNewComments: boolean
  ): NativeReviewDocument {
    const uri = vscode.Uri.from({
      scheme: this.scheme,
      authority: "review",
      path: `/${encodeURIComponent(context.projectId)}/${context.mergeRequestIid}/${side}/${filePath}`,
      query: encodeURIComponent(key)
    });
    const document: NativeReviewDocument = {
      uri,
      text,
      filePath,
      side,
      context,
      sessionKey: key,
      allowNewComments
    };
    this.documents.set(uri.toString(), document);
    this.onDidChangeEmitter.fire(uri);
    return document;
  }

  private async createHeadDocument(
    key: string,
    context: ReviewContext,
    projectIdentity: string | undefined,
    sourceBranch: string,
    file: ReviewFileView,
    mrText: string
  ): Promise<NativeReviewDocument> {
    const local = await this.findMatchingLocalDocument(sourceBranch, projectIdentity, file.newPath, mrText);
    if (local) {
      const existing = this.documents.get(local.uri.toString());
      if (existing && existing.sessionKey !== key) {
        return this.createVirtualDocument(
          key,
          context,
          file.path,
          "head",
          mrText,
          !file.deletedFile
        );
      }
      // A matching disk file can still have unsaved editor changes; never bind that buffer blindly.
      const openDocument = this.openTextDocument(local.uri);
      if (openDocument && !this.isOpenDocumentTextEqual(openDocument, mrText)) {
        return this.createVirtualDocument(
          key,
          context,
          file.path,
          "head",
          mrText,
          !file.deletedFile
        );
      }
      const document: NativeReviewDocument = {
        uri: local.uri,
        text: local.text,
        filePath: file.path,
        side: "head",
        context,
        sessionKey: key,
        allowNewComments: !file.deletedFile
      };
      this.documents.set(document.uri.toString(), document);
      return document;
    }
    return this.createVirtualDocument(
      key,
      context,
      file.path,
      "head",
      mrText,
      !file.deletedFile
    );
  }

  private async findMatchingLocalDocument(
    sourceBranch: string,
    projectIdentity: string | undefined,
    filePath: string,
    mrText: string
  ): Promise<{ uri: vscode.Uri; text: string } | undefined> {
    if (!projectIdentity) return undefined;
    const state = this.localGit.getState(sourceBranch, projectIdentity);
    if (state.phase !== "ready" || state.remoteMatch !== "matched" || !state.repositoryRoot) return undefined;
    const root = path.resolve(state.repositoryRoot);
    const candidate = path.resolve(root, filePath);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    try {
      const uri = vscode.Uri.file(candidate);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(bytes);
      return normalizeTextForComparison(text) === normalizeTextForComparison(mrText)
        ? { uri, text }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private provideCommentingRanges(document: vscode.TextDocument): vscode.Range[] {
    const metadata = this.documents.get(document.uri.toString());
    if (!metadata?.allowNewComments || metadata.side !== "head" || document.lineCount < 1) return [];
    if (!this.isDocumentTextCurrent(document, metadata)) return [];
    if (!this.sameCurrentContext(metadata.context)) return [];
    const session = this.sessions.get(metadata.sessionKey);
    if (!session || session.stale || !session.allowNewComments || session.threadMode === "none") return [];
    const lastLine = document.lineAt(document.lineCount - 1);
    return [new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length)];
  }

  private syncFromStore(): void {
    const selected = this.store.getOverview().selectedMergeRequest;
    const currentContext = this.store.getReviewContext();
    const nextContextKey = currentContext ? reviewContextKey(currentContext) : undefined;
    if (nextContextKey !== this.observedContextKey) {
      this.openGeneration += 1;
      this.observedContextKey = nextContextKey;
    }
    for (const [key, session] of this.sessions) {
      if (!selected
        || selected.projectId !== session.context.projectId
        || selected.iid !== session.context.mergeRequestIid) {
        this.markSessionStale(session);
        continue;
      }
      if (!sameReviewContext(session.context, currentContext)) {
        this.markSessionStale(session);
        continue;
      }
      this.restoreSessionIfCurrent(session);
      this.syncSessionThreads(session);
    }
    this.updateActiveFilePath();
  }

  private syncSessionThreads(session: NativeReviewSession): void {
    if (session.stale || session.threadMode === "none") {
      for (const thread of session.threads.values()) thread.dispose();
      session.threads.clear();
      return;
    }
    const overview = this.store.getOverview();
    const ids = overview.threads
      .filter((thread) => thread.filePath === session.filePath)
      .map((thread) => thread.id);
    const reviewThreads = this.store.getThreadDetails(ids);
    const desiredIds = new Set<string>();

    for (const reviewThread of reviewThreads) {
      const location = nativeThreadLocation(reviewThread);
      if (!location) continue;
      const positionHeadSha = (reviewThread as ReviewThread & { positionHeadSha?: string }).positionHeadSha;
      if (positionHeadSha && positionHeadSha !== session.context.headSha) continue;
      if (session.threadMode === "head-only" && location.side === "base") continue;
      const document = location.side === "base" ? session.base : session.head;
      if (location.line > lineCount(document.text)) continue;
      desiredIds.add(reviewThread.id);

      let nativeThread = session.threads.get(reviewThread.id);
      if (!nativeThread || nativeThread.uri.toString() !== document.uri.toString()) {
        nativeThread?.dispose();
        nativeThread = this.controller.createCommentThread(
          document.uri,
          lineRange(location.line),
          []
        );
        nativeThread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        session.threads.set(reviewThread.id, nativeThread);
      }
      nativeThread.range = lineRange(location.line);
      nativeThread.state = reviewThread.resolved
        ? vscode.CommentThreadState.Resolved
        : vscode.CommentThreadState.Unresolved;
      nativeThread.contextValue = reviewThread.pending
        ? "gitlabReview.native.pending"
        : reviewThread.resolved
          ? "gitlabReview.native.resolved"
          : "gitlabReview.native.unresolved";
      nativeThread.label = reviewThread.pending
        ? "GitLab discussion — Saving…"
        : "GitLab discussion";
      nativeThread.canReply = !reviewThread.pending;
      nativeThread.comments = this.toNativeComments(nativeThread, reviewThread, session.context, session.filePath);
      this.threadBindings.set(nativeThread, {
        sessionKey: session.key,
        filePath: session.filePath,
        context: session.context,
        reviewThreadId: reviewThread.id
      });
    }

    for (const [id, thread] of session.threads) {
      if (desiredIds.has(id)) continue;
      thread.dispose();
      session.threads.delete(id);
    }
  }

  private toNativeComments(
    nativeThread: vscode.CommentThread,
    reviewThread: ReviewThread,
    context: ReviewContext,
    filePath: string
  ): vscode.Comment[] {
    const previous = new Map(
      nativeThread.comments
        .filter((comment): comment is GitLabNativeComment => comment instanceof GitLabNativeComment)
        .map((comment) => [comment.reviewCommentId, comment])
    );
    return reviewThread.comments.map((reviewComment) => {
      const editing = previous.get(reviewComment.id);
      const nativeComment = editing?.mode === vscode.CommentMode.Editing
        ? editing
        : new GitLabNativeComment(
          reviewComment.id,
          reviewComment,
          this.renderCommentBody(context, reviewComment)
        );
      this.commentBindings.set(nativeComment, {
        nativeThread,
        filePath,
        reviewThreadId: reviewThread.id,
        reviewCommentId: reviewComment.id,
        context,
        originalBody: reviewComment.body
      });
      return nativeComment;
    });
  }

  private renderCommentBody(context: ReviewContext, comment: ReviewComment): vscode.MarkdownString {
    const key = `${reviewContextKey(context)}:${comment.id}:${comment.body}`;
    const cached = this.renderedCommentBodies.get(key);
    if (cached) return cached;

    const initial = commentMarkdown(comment.body);
    this.renderedCommentBodies.set(key, initial);
    const imagePaths = privateCommentImagePaths(comment.body);
    if (!imagePaths.length || this.pendingCommentBodyLoads.has(key)) return initial;

    this.pendingCommentBodyLoads.add(key);
    void Promise.all(imagePaths.map(async (imagePath) => {
      try {
        this.store.assertReviewContext(context);
        const result = await this.commentImages.resolve({
          type: "resolveCommentImage",
          requestId: `native-comment-render-${comment.id}`,
          reviewContext: context,
          projectId: context.projectId,
          imagePath
        });
        this.store.assertReviewContext(context);
        return { imagePath, uri: vscode.Uri.file(result.cachePath).toString() };
      } catch {
        return undefined;
      }
    })).then((images) => {
      if (!this.sameCurrentContext(context)) return;
      let body = comment.body;
      for (const image of images) {
        if (image) body = body.replaceAll(image.imagePath, image.uri);
      }
      this.renderedCommentBodies.set(key, commentMarkdown(body));
      this.syncFromStore();
    }).finally(() => {
      this.pendingCommentBodyLoads.delete(key);
    });
    return initial;
  }

  private async toggleReaction(comment: vscode.Comment, reaction: vscode.CommentReaction): Promise<void> {
    const binding = this.commentBindings.get(comment);
    if (!binding || this.pendingReactions.has(comment)) return;
    this.pendingReactions.add(comment);
    try {
      const ok = await this.callMutation(
        binding.context,
        binding.filePath,
        () => this.store.toggleCommentReaction(
          binding.reviewThreadId,
          binding.reviewCommentId,
          reaction.label,
          binding.context
        )
      );
      if (!ok) return;
    } finally {
      this.pendingReactions.delete(comment);
    }
  }

  private async submitComment(reply: vscode.CommentReply): Promise<void> {
    if (this.pendingUploads.has(reply.thread)) {
      throw new vscode.CancellationError();
    }
    if (!await this.submitText(reply.thread, reply.text)) {
      throw new vscode.CancellationError();
    }
  }

  private async submitText(thread: vscode.CommentThread, body: string): Promise<boolean> {
    const trimmed = body.trim();
    if (!trimmed || this.pendingThreads.has(thread)) return false;
    const binding = this.threadBindings.get(thread);
    const metadata = this.documents.get(thread.uri.toString());
    const document = this.openTextDocument(thread.uri);
    const session = binding ? this.sessions.get(binding.sessionKey) : metadata ? this.sessions.get(metadata.sessionKey) : undefined;
    const context = binding?.context ?? metadata?.context;
    if (!context) return false;
    if (!this.sameCurrentContext(context)) {
      await this.offerCurrentMrDiff(context, metadata?.filePath ?? binding?.filePath);
      return false;
    }
    if (document && !this.isDocumentTextCurrent(document, metadata)) {
      void vscode.window.showErrorMessage(
        "The file changed locally while this review was open. Reopen the diff before commenting."
      );
      return false;
    }
    if (binding?.reviewThreadId) {
      this.pendingThreads.add(thread);
      const previousCanReply = thread.canReply;
      thread.canReply = false;
      try {
        return await this.callMutation(
          context,
          metadata?.filePath ?? binding.filePath,
          () => this.store.addComment(binding.reviewThreadId!, trimmed, context)
        );
      } finally {
        this.pendingThreads.delete(thread);
        if (thread.comments.length > 0 && thread.state !== vscode.CommentThreadState.Resolved) {
          thread.canReply = previousCanReply !== false;
        }
      }
    }
    if (!metadata || !session || metadata.side !== "head" || !thread.range) return false;
    if (session.stale || !session.allowNewComments || session.threadMode === "none") {
      await this.offerReadOnlyComparison(session.filePath);
      return false;
    }

    const mrLine = thread.range.end.line + 1;
    const viewModel = this.store.getFileViewModel(metadata.filePath, {
      includeEditableText: true,
      targetLine: mrLine
    });
    if (!viewModel) {
      void vscode.window.showErrorMessage("The current review file is unavailable. Reopen the current MR diff and try again.");
      return false;
    }
    const oldLine = oldLineForMrLine(viewModel.lines, mrLine);
    this.pendingThreads.add(thread);
    const previousCanReply = thread.canReply;
    thread.canReply = false;
    try {
      const success = await this.callMutation(
        context,
        metadata.filePath,
        () => this.store.addThread(
          metadata.filePath,
          mrLine,
          oldLine,
          trimmed,
          this.store.getSubmissionMode(),
          context
        )
      );
      if (success) {
        thread.dispose();
      } else {
        thread.canReply = previousCanReply ?? true;
      }
      return success;
    } finally {
      this.pendingThreads.delete(thread);
    }
  }

  private async uploadAndSubmit(reply: vscode.CommentReply): Promise<void> {
    if (this.pendingThreads.has(reply.thread) || this.pendingUploads.has(reply.thread)) {
      throw new vscode.CancellationError();
    }
    const context = this.contextForThread(reply.thread);
    if (!context) throw new vscode.CancellationError();
    const isExistingReply = Boolean(this.threadBindings.get(reply.thread)?.reviewThreadId);
    const previousCanReply = reply.thread.canReply;
    let submitted = false;
    this.pendingUploads.add(reply.thread);
    reply.thread.canReply = false;
    try {
      const selected = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        title: "Attach an image to the GitLab comment",
        filters: { Images: ["png", "jpg", "jpeg", "webp", "gif"] }
      });
      if (!selected?.[0]) throw new vscode.CancellationError();
      this.assertCurrentContext(context);
      const bytes = await vscode.workspace.fs.readFile(selected[0]);
      this.assertCurrentContext(context);
      const mimeType = detectCommentImageMimeType(bytes);
      if (!mimeType) throw new Error("Only PNG, JPEG, WebP, and GIF images are supported.");
      const markdown = await this.uploadImage(bytes, path.basename(selected[0].fsPath), mimeType, context);
      this.assertCurrentContext(context);
      if (!await this.submitText(reply.thread, appendCommentMarkdown(reply.text, markdown))) {
        throw new vscode.CancellationError();
      }
      submitted = true;
    } catch (error) {
      if (error instanceof vscode.CancellationError) throw error;
      if (isStaleNativeReviewError(error)) {
        await this.offerCurrentMrDiff(context, this.filePathForThread(reply.thread));
        throw new vscode.CancellationError();
      }
      const message = error instanceof Error ? error.message : "GitLab image upload failed.";
      void vscode.window.showErrorMessage(message);
      throw new vscode.CancellationError();
    } finally {
      this.pendingUploads.delete(reply.thread);
      if (!submitted || isExistingReply) reply.thread.canReply = previousCanReply;
    }
  }

  private async setResolved(thread: vscode.CommentThread, resolved: boolean): Promise<void> {
    const binding = this.threadBindings.get(thread);
    if (!binding?.reviewThreadId || this.pendingThreads.has(thread)) return;
    const reviewThread = this.store.getThreadDetails([binding.reviewThreadId])[0];
    if (!reviewThread || reviewThread.resolved === resolved) return;
    this.pendingThreads.add(thread);
    try {
      await this.callMutation(
        binding.context,
        binding.filePath,
        () => this.store.toggleResolved(binding.reviewThreadId!, binding.context)
      );
    } finally {
      this.pendingThreads.delete(thread);
    }
  }

  private startEdit(comment: GitLabNativeComment): void {
    const binding = this.commentBindings.get(comment);
    if (!binding) return;
    if (!this.sameCurrentContext(binding.context)) {
      void this.offerCurrentMrDiff(binding.context, binding.filePath);
      return;
    }
    comment.body = binding.originalBody;
    comment.mode = vscode.CommentMode.Editing;
    binding.nativeThread.comments = [...binding.nativeThread.comments];
  }

  private async saveEdit(comment: GitLabNativeComment): Promise<void> {
    const binding = this.commentBindings.get(comment);
    if (!binding || this.pendingComments.has(comment)) return;
    const body = comment.body instanceof vscode.MarkdownString ? comment.body.value : comment.body;
    const trimmed = body.trim();
    if (!trimmed) return;
    this.pendingComments.add(comment);
    try {
      const success = await this.callMutation(
        binding.context,
        binding.filePath,
        () => this.store.editComment(binding.reviewThreadId, binding.reviewCommentId, trimmed, binding.context)
      );
      if (!success) return;
      comment.body = commentMarkdown(trimmed);
      comment.mode = vscode.CommentMode.Preview;
      comment.contextValue = "gitlabReview.native.editable";
      binding.originalBody = trimmed;
      binding.nativeThread.comments = [...binding.nativeThread.comments];
    } finally {
      this.pendingComments.delete(comment);
    }
  }

  private cancelEdit(comment: GitLabNativeComment): void {
    const binding = this.commentBindings.get(comment);
    if (!binding) return;
    comment.body = commentMarkdown(binding.originalBody);
    comment.mode = vscode.CommentMode.Preview;
    binding.nativeThread.comments = [...binding.nativeThread.comments];
  }

  private requestRevealInSidebar(comment: vscode.Comment): void {
    const binding = this.commentBindings.get(comment);
    if (binding) this.onDidRequestRevealThreadEmitter.fire(binding.reviewThreadId);
  }

  private async provideImagePasteEdits(
    document: vscode.TextDocument,
    dataTransfer: vscode.DataTransfer
  ): Promise<NativeImagePasteEdit[] | undefined> {
    if (document.uri.authority !== nativeCommentControllerId) return undefined;
    const context = this.contextForPaste();
    if (!context || !this.sameCurrentContext(context)) {
      if (this.sessions.size > 0) {
        void vscode.window.showErrorMessage(
          "The review for this pasted image is not unambiguous. Use Attach Image and Comment after opening the current MR diff."
        );
      }
      return undefined;
    }
    const capturedContext = immutableReviewContext(context);
    for (const [mimeType, item] of dataTransfer) {
      if (!mimeType.toLowerCase().startsWith("image/") && mimeType !== "files") continue;
      const file = item.asFile();
      const bytes = file
        ? await file.data()
        : item.value instanceof Uint8Array
          ? item.value
          : undefined;
      if (!bytes) continue;
      if (!this.sameCurrentContext(context)) return undefined;
      const detected = detectCommentImageMimeType(bytes);
      if (!detected) continue;
      return [new NativeImagePasteEdit(
        bytes,
        file?.name || pastedImageFilename(detected),
        detected,
        capturedContext
      )];
    }
    return undefined;
  }

  private async resolveImagePasteEdit(
    edit: vscode.DocumentPasteEdit,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentPasteEdit> {
    if (!(edit instanceof NativeImagePasteEdit) || token.isCancellationRequested) return edit;
    try {
      this.assertCurrentContext(edit.context);
      edit.insertText = await this.uploadImage(edit.bytes, edit.filename, edit.mimeType, edit.context);
      this.assertCurrentContext(edit.context);
    } catch (error) {
      if (isStaleNativeReviewError(error)) {
        void this.offerCurrentMrDiff(edit.context);
      }
      const message = error instanceof Error ? error.message : "GitLab image upload failed.";
      void vscode.window.showErrorMessage(message);
      throw error;
    }
    return edit;
  }

  private async uploadImage(
    bytes: Uint8Array,
    filename: string,
    mimeType: CommentImageMimeType,
    context: ReviewContext
  ): Promise<string> {
    this.assertCurrentContext(context);
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Uploading image to GitLab…",
        cancellable: false
      },
      async () => {
        this.assertCurrentContext(context);
        const result = await this.commentImages.upload({
          type: "uploadCommentImage",
          requestId: `native-comment-${Date.now()}`,
          reviewContext: context,
          projectId: context.projectId,
          filename,
          mimeType,
          dataBase64: Buffer.from(bytes).toString("base64")
        });
        this.assertCurrentContext(context);
        return result.markdown;
      }
    );
  }

  private captureReviewContext(): ReviewContext | undefined {
    const context = this.store.getReviewContext();
    if (context) this.observedContextKey = reviewContextKey(context);
    this.updateActiveFilePath();
    return context ? immutableReviewContext(context) : undefined;
  }

  private sameCurrentContext(context: ReviewContext): boolean {
    return sameReviewContext(context, this.store.getReviewContext());
  }

  private assertCurrentContext(context: ReviewContext): void {
    try {
      this.store.assertReviewContext(context);
    } catch (error) {
      throw new StaleNativeReviewError(error instanceof Error ? error.message : undefined);
    }
  }

  private ensureOpenIsCurrent(generation: number, context: ReviewContext): void {
    if (generation !== this.openGeneration) throw new StaleNativeReviewError();
    this.assertCurrentContext(context);
  }

  private async callMutation(
    context: ReviewContext,
    filePath: string | vscode.Uri | undefined,
    operation: () => Promise<ReviewMutationResult>
  ): Promise<boolean> {
    try {
      this.assertCurrentContext(context);
      const result = await operation();
      if (result.ok) return true;
      await this.showMutationError(context, result.errorMessage, filePath);
      return false;
    } catch (error) {
      await this.showMutationError(
        context,
        error instanceof Error ? error.message : "GitLab could not save this change. Your draft has been kept.",
        filePath
      );
      return false;
    }
  }

  private async showMutationError(
    context: ReviewContext,
    errorMessage: string,
    filePath: string | vscode.Uri | undefined
  ): Promise<void> {
    if (!this.sameCurrentContext(context)) {
      await this.offerCurrentMrDiff(context, typeof filePath === "string" ? filePath : undefined);
      return;
    }
    void vscode.window.showErrorMessage(errorMessage);
  }

  private async offerCurrentMrDiff(
    context: ReviewContext,
    filePath?: string,
    line?: number
  ): Promise<void> {
    const action = "Open current MR diff";
    const selected = await vscode.window.showErrorMessage(
      "The merge request or diff changed while this review was open. Your draft has been kept.",
      action
    );
    if (selected === action && filePath) void this.openFile(filePath, line);
  }

  private async offerReadOnlyComparison(filePath: string): Promise<void> {
    const action = "Open current MR diff";
    const selected = await vscode.window.showErrorMessage(
      "This historical comparison is read-only. Open the current MR diff to add a comment.",
      action
    );
    if (selected === action) void this.openFile(filePath);
  }

  private contextForThread(thread: vscode.CommentThread): ReviewContext | undefined {
    const binding = this.threadBindings.get(thread);
    if (binding) return binding.context;
    return this.documents.get(thread.uri.toString())?.context;
  }

  private filePathForThread(thread: vscode.CommentThread): string | undefined {
    const binding = this.threadBindings.get(thread);
    if (binding) return binding.filePath;
    return this.documents.get(thread.uri.toString())?.filePath;
  }

  private contextForPaste(): ReviewContext | undefined {
    const contexts = new Map<string, ReviewContext>();
    for (const session of this.sessions.values()) {
      contexts.set(reviewContextKey(session.context), session.context);
    }
    const current = this.store.getReviewContext();
    if (!current || contexts.size !== 1 || !contexts.has(reviewContextKey(current))) return undefined;
    return contexts.get(reviewContextKey(current));
  }

  private updateActiveFilePath(): void {
    const activeDocument = vscode.window.activeTextEditor?.document;
    const activeMetadata = activeDocument
      ? this.currentDocumentMetadata(activeDocument.uri)
      : undefined;
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const activeTabMetadata = activeTab
      ? this.tabInputUris(activeTab.input)
        .map((uri) => this.currentDocumentMetadata(uri))
        .find((metadata): metadata is NativeReviewDocument => Boolean(metadata))
      : undefined;
    const next = (activeMetadata ?? activeTabMetadata)?.filePath;
    if (next === this.activeFilePath) return;
    this.activeFilePath = next;
    this.onDidChangeActiveFileEmitter.fire(next);
  }

  private handleClosedDocument(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const metadata = this.documents.get(key);
    // Retained sessions still own this URI so stale composers cannot be rebound to a new MR.
    if (metadata && !this.sessions.has(metadata.sessionKey)) this.documents.delete(key);
    this.updateActiveFilePath();
  }

  private openTextDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    const key = uri.toString();
    const candidates = [
      vscode.window.activeTextEditor?.document,
      ...vscode.window.visibleTextEditors.map((editor) => editor.document),
      ...(vscode.workspace.textDocuments ?? [])
    ];
    return candidates.find(
      (document): document is vscode.TextDocument => Boolean(document && document.uri.toString() === key)
    );
  }

  private currentDocumentMetadata(uri: vscode.Uri): NativeReviewDocument | undefined {
    const metadata = this.documents.get(uri.toString());
    if (!metadata || !this.sameCurrentContext(metadata.context)) return undefined;
    const session = this.sessions.get(metadata.sessionKey);
    return session && !session.stale ? metadata : undefined;
  }

  private isDocumentTextCurrent(
    document: vscode.TextDocument,
    metadata: NativeReviewDocument | undefined
  ): boolean {
    if (!metadata || !document) return true;
    try {
      const getText = (document as vscode.TextDocument & { getText?: () => string }).getText;
      if (typeof getText !== "function") return true;
      return normalizeTextForComparison(getText.call(document)) === normalizeTextForComparison(metadata.text);
    } catch {
      return false;
    }
  }

  private isOpenDocumentTextEqual(document: vscode.TextDocument, expectedText: string): boolean {
    try {
      const getText = (document as vscode.TextDocument & { getText?: () => string }).getText;
      if (typeof getText !== "function") return false;
      return normalizeTextForComparison(getText.call(document)) === normalizeTextForComparison(expectedText);
    } catch {
      return false;
    }
  }

  private tabInputUris(input: vscode.Tab["input"]): vscode.Uri[] {
    if (input instanceof vscode.TabInputText) return [input.uri];
    if (input instanceof vscode.TabInputTextDiff) return [input.modified, input.original];
    if (input instanceof vscode.TabInputCustom) return [input.uri];
    return [];
  }

  private markSessionStale(session: NativeReviewSession): void {
    session.stale = true;
    session.base.allowNewComments = false;
    session.head.allowNewComments = false;
  }

  private restoreSessionIfCurrent(session: NativeReviewSession): void {
    if (!session.stale) return;
    session.stale = false;
    session.base.allowNewComments = false;
    session.head.allowNewComments = session.allowNewComments;
  }

  private disposeStaleOpen(key: string | undefined, session: NativeReviewSession | undefined): void {
    if (!key) return;
    if (session && this.sessions.get(key) === session) {
      this.disposeSession(session);
      this.sessions.delete(key);
    } else if (!this.sessions.has(key)) {
      for (const [uri, document] of this.documents) {
        if (document.sessionKey === key) this.documents.delete(uri);
      }
    }
    this.updateActiveFilePath();
  }

  private disposeSession(session: NativeReviewSession): void {
    for (const thread of session.threads.values()) thread.dispose();
    session.threads.clear();
    for (const document of [session.base, session.head]) {
      const current = this.documents.get(document.uri.toString());
      if (current?.sessionKey === session.key) this.documents.delete(document.uri.toString());
    }
  }
}

class StaleNativeReviewError extends Error {
  readonly stale = true;

  constructor(message = "The merge request or diff changed while this review was open.") {
    super(message);
  }
}

function isStaleNativeReviewError(value: unknown): value is StaleNativeReviewError {
  return value instanceof StaleNativeReviewError || (typeof value === "object" && value !== null && "stale" in value && (value as { stale?: unknown }).stale === true);
}

function immutableReviewContext(context: ReviewContext): ReviewContext {
  return Object.freeze({ ...context });
}

function sessionKey(
  context: ReviewContext,
  comparisonKind: NativeComparisonKind,
  filePath: string
): string {
  return `${reviewContextKey(context)}:${comparisonKind}:${filePath}`;
}

function lineRange(line: number): vscode.Range {
  const index = Math.max(0, line - 1);
  return new vscode.Range(index, 0, index, 0);
}

function lineCount(text: string): number {
  if (!text) return 1;
  return text.split(/\r?\n/).length;
}

function commentMarkdown(body: string): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(body);
  markdown.supportHtml = false;
  markdown.isTrusted = false;
  return markdown;
}

function safeUri(value?: string): vscode.Uri | undefined {
  if (!value) return undefined;
  try {
    const uri = vscode.Uri.parse(value, true);
    return uri.scheme === "https" ? uri : undefined;
  } catch {
    return undefined;
  }
}

function safeDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function editedLabel(comment: ReviewComment): string | undefined {
  if (!comment.updatedAt) return undefined;
  const created = Date.parse(comment.createdAt);
  const updated = Date.parse(comment.updatedAt);
  return Number.isFinite(created) && Number.isFinite(updated) && updated > created ? "edited" : undefined;
}

const nativeReactionEmoji: Readonly<Record<string, string>> = {
  thumbsup: "👍",
  thumbsdown: "👎",
  smile: "😄",
  tada: "🎉",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀"
};

function toNativeReactions(reactions: readonly ReviewReaction[]): vscode.CommentReaction[] {
  return reactions.map((reaction) => ({
    label: reaction.name,
    count: reaction.count,
    iconPath: nativeReactionIcon(reaction.name),
    authorHasReacted: Boolean(reaction.currentUserAwardId)
  }));
}

function nativeReactionIcon(name: string): vscode.Uri {
  const emoji = nativeReactionEmoji[name] ?? "❔";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><text x="8" y="13" font-size="13" text-anchor="middle">${escapeXml(emoji)}</text></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(svg)}`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function pastedImageFilename(mimeType: CommentImageMimeType): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  return `pasted-image-${Date.now()}.${extension}`;
}
