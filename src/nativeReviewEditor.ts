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
import { ReviewStore } from "./reviewStore";
import type { ReviewComment, ReviewFileView, ReviewThread } from "./reviewTypes";

const nativeCommentControllerId = "gitlabReview.nativeComments";
const commentInputScheme = "comment";
const imagePasteKind = vscode.DocumentDropOrPasteEditKind.Empty.append("gitlabReview", "commentImage");

interface NativeReviewDocument {
  uri: vscode.Uri;
  text: string;
  filePath: string;
  side: NativeReviewSide;
  projectId: string;
  mergeRequestIid: number;
  sessionKey: string;
  allowNewComments: boolean;
}

interface NativeReviewSession {
  key: string;
  projectId: string;
  mergeRequestIid: number;
  filePath: string;
  file: ReviewFileView;
  base: NativeReviewDocument;
  head: NativeReviewDocument;
  threads: Map<string, vscode.CommentThread>;
}

interface NativeThreadBinding {
  sessionKey: string;
  filePath: string;
  reviewThreadId?: string;
}

interface NativeCommentBinding {
  nativeThread: vscode.CommentThread;
  reviewThreadId: string;
  reviewCommentId: string;
  originalBody: string;
}

class GitLabNativeComment implements vscode.Comment {
  body: string | vscode.MarkdownString;
  mode = vscode.CommentMode.Preview;
  author: vscode.CommentAuthorInformation;
  contextValue?: string;
  label?: string;
  timestamp?: Date;

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
  }
}

class NativeImagePasteEdit extends vscode.DocumentPasteEdit {
  constructor(
    readonly bytes: Uint8Array,
    readonly filename: string,
    readonly mimeType: CommentImageMimeType
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
  private activeFilePath?: string;

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

    this.disposables.push(
      this.controller,
      this.onDidChangeEmitter,
      this.onDidRequestRevealThreadEmitter,
      this.store.onDidChange(() => this.syncFromStore()),
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

    try {
      const contents = await this.store.loadReviewFileContents(filePath);
      const viewModel = this.store.getFileViewModel(filePath, {
        includeEditableText: true,
        targetLine: line
      });
      if (!viewModel) throw new Error("The review file is unavailable.");

      const key = sessionKey(selected.projectId, selected.iid, viewModel.file.path);
      const base = this.createVirtualDocument(
        key,
        selected.projectId,
        selected.iid,
        viewModel.file.path,
        "base",
        contents.oldText,
        false
      );
      const head = await this.createHeadDocument(
        key,
        selected.projectId,
        selected.iid,
        overview.sourceBranch,
        viewModel.file,
        contents.mrText
      );

      const previous = this.sessions.get(key);
      const session: NativeReviewSession = {
        key,
        projectId: selected.projectId,
        mergeRequestIid: selected.iid,
        filePath: viewModel.file.path,
        file: viewModel.file,
        base,
        head,
        threads: previous?.threads ?? new Map()
      };
      this.sessions.set(key, session);
      if (this.activeFilePath !== viewModel.file.path) {
        this.activeFilePath = viewModel.file.path;
        this.onDidChangeActiveFileEmitter.fire(this.activeFilePath);
      }
      this.syncSessionThreads(session);

      const targetThread = threadId
        ? viewModel.threads.find((thread) => thread.id === threadId)
        : undefined;
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
    } catch {
      void vscode.window.showErrorMessage(`VS Code の差分エディターで ${filePath} を開けませんでした。`);
    }
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
    projectId: string,
    mergeRequestIid: number,
    filePath: string,
    side: NativeReviewSide,
    text: string,
    allowNewComments: boolean
  ): NativeReviewDocument {
    const uri = vscode.Uri.from({
      scheme: this.scheme,
      authority: "review",
      path: `/${encodeURIComponent(projectId)}/${mergeRequestIid}/${side}/${filePath}`
    });
    const document: NativeReviewDocument = {
      uri,
      text,
      filePath,
      side,
      projectId,
      mergeRequestIid,
      sessionKey: key,
      allowNewComments
    };
    this.documents.set(uri.toString(), document);
    this.onDidChangeEmitter.fire(uri);
    return document;
  }

  private async createHeadDocument(
    key: string,
    projectId: string,
    mergeRequestIid: number,
    sourceBranch: string,
    file: ReviewFileView,
    mrText: string
  ): Promise<NativeReviewDocument> {
    const local = await this.findMatchingLocalDocument(sourceBranch, projectId, file.newPath, mrText);
    if (local) {
      const document: NativeReviewDocument = {
        uri: local.uri,
        text: local.text,
        filePath: file.path,
        side: "head",
        projectId,
        mergeRequestIid,
        sessionKey: key,
        allowNewComments: !file.deletedFile
      };
      this.documents.set(document.uri.toString(), document);
      return document;
    }
    return this.createVirtualDocument(
      key,
      projectId,
      mergeRequestIid,
      file.path,
      "head",
      mrText,
      !file.deletedFile
    );
  }

  private async findMatchingLocalDocument(
    sourceBranch: string,
    projectId: string,
    filePath: string,
    mrText: string
  ): Promise<{ uri: vscode.Uri; text: string } | undefined> {
    const state = this.localGit.getState(sourceBranch, projectId);
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
    const lastLine = document.lineAt(document.lineCount - 1);
    return [new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length)];
  }

  private syncFromStore(): void {
    const selected = this.store.getOverview().selectedMergeRequest;
    for (const [key, session] of this.sessions) {
      if (!selected || selected.projectId !== session.projectId || selected.iid !== session.mergeRequestIid) {
        this.disposeSession(session);
        this.sessions.delete(key);
        continue;
      }
      this.syncSessionThreads(session);
    }
  }

  private syncSessionThreads(session: NativeReviewSession): void {
    const overview = this.store.getOverview();
    const ids = overview.threads
      .filter((thread) => thread.filePath === session.filePath)
      .map((thread) => thread.id);
    const reviewThreads = this.store.getThreadDetails(ids);
    const desiredIds = new Set<string>();

    for (const reviewThread of reviewThreads) {
      const location = nativeThreadLocation(reviewThread);
      if (!location) continue;
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
      nativeThread.comments = this.toNativeComments(nativeThread, reviewThread, session.projectId);
      this.threadBindings.set(nativeThread, {
        sessionKey: session.key,
        filePath: session.filePath,
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
    projectId: string
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
          this.renderCommentBody(projectId, reviewComment)
        );
      this.commentBindings.set(nativeComment, {
        nativeThread,
        reviewThreadId: reviewThread.id,
        reviewCommentId: reviewComment.id,
        originalBody: reviewComment.body
      });
      return nativeComment;
    });
  }

  private renderCommentBody(projectId: string, comment: ReviewComment): vscode.MarkdownString {
    const key = `${projectId}:${comment.id}:${comment.body}`;
    const cached = this.renderedCommentBodies.get(key);
    if (cached) return cached;

    const initial = commentMarkdown(comment.body);
    this.renderedCommentBodies.set(key, initial);
    const imagePaths = privateCommentImagePaths(comment.body);
    if (!imagePaths.length || this.pendingCommentBodyLoads.has(key)) return initial;

    this.pendingCommentBodyLoads.add(key);
    void Promise.all(imagePaths.map(async (imagePath) => {
      try {
        const result = await this.commentImages.resolve({
          type: "resolveCommentImage",
          requestId: `native-comment-render-${comment.id}`,
          projectId,
          imagePath
        });
        return { imagePath, uri: vscode.Uri.file(result.cachePath).toString() };
      } catch {
        return undefined;
      }
    })).then((images) => {
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

  private async submitComment(reply: vscode.CommentReply): Promise<void> {
    await this.submitText(reply.thread, reply.text);
  }

  private async submitText(thread: vscode.CommentThread, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;
    const binding = this.threadBindings.get(thread);
    const document = this.documents.get(thread.uri.toString());
    if (binding?.reviewThreadId) {
      await this.store.addComment(binding.reviewThreadId, trimmed);
      return;
    }
    if (!document || document.side !== "head" || !thread.range) return;

    const mrLine = thread.range.end.line + 1;
    const viewModel = this.store.getFileViewModel(document.filePath, {
      includeEditableText: true,
      targetLine: mrLine
    });
    const oldLine = viewModel ? oldLineForMrLine(viewModel.lines, mrLine) : undefined;
    thread.dispose();
    await this.store.addThread(document.filePath, mrLine, oldLine, trimmed);
  }

  private async uploadAndSubmit(reply: vscode.CommentReply): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      title: "Attach an image to the GitLab comment",
      filters: { Images: ["png", "jpg", "jpeg", "webp", "gif"] }
    });
    if (!selected?.[0]) throw new vscode.CancellationError();
    try {
      const bytes = await vscode.workspace.fs.readFile(selected[0]);
      const mimeType = detectCommentImageMimeType(bytes);
      if (!mimeType) throw new Error("Only PNG, JPEG, WebP, and GIF images are supported.");
      const markdown = await this.uploadImage(bytes, path.basename(selected[0].fsPath), mimeType);
      await this.submitText(reply.thread, appendCommentMarkdown(reply.text, markdown));
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitLab image upload failed.";
      void vscode.window.showErrorMessage(message);
      throw new vscode.CancellationError();
    }
  }

  private async setResolved(thread: vscode.CommentThread, resolved: boolean): Promise<void> {
    const binding = this.threadBindings.get(thread);
    if (!binding?.reviewThreadId) return;
    const reviewThread = this.store.getThreadDetails([binding.reviewThreadId])[0];
    if (!reviewThread || reviewThread.resolved === resolved) return;
    await this.store.toggleResolved(binding.reviewThreadId);
  }

  private startEdit(comment: GitLabNativeComment): void {
    const binding = this.commentBindings.get(comment);
    if (!binding) return;
    comment.body = binding.originalBody;
    comment.mode = vscode.CommentMode.Editing;
    binding.nativeThread.comments = [...binding.nativeThread.comments];
  }

  private async saveEdit(comment: GitLabNativeComment): Promise<void> {
    const binding = this.commentBindings.get(comment);
    if (!binding) return;
    const body = comment.body instanceof vscode.MarkdownString ? comment.body.value : comment.body;
    await this.store.editComment(binding.reviewThreadId, binding.reviewCommentId, body);
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
    for (const [mimeType, item] of dataTransfer) {
      if (!mimeType.toLowerCase().startsWith("image/") && mimeType !== "files") continue;
      const file = item.asFile();
      const bytes = file
        ? await file.data()
        : item.value instanceof Uint8Array
          ? item.value
          : undefined;
      if (!bytes) continue;
      const detected = detectCommentImageMimeType(bytes);
      if (!detected) continue;
      return [new NativeImagePasteEdit(
        bytes,
        file?.name || pastedImageFilename(detected),
        detected
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
      edit.insertText = await this.uploadImage(edit.bytes, edit.filename, edit.mimeType);
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitLab image upload failed.";
      void vscode.window.showErrorMessage(message);
      throw error;
    }
    return edit;
  }

  private async uploadImage(
    bytes: Uint8Array,
    filename: string,
    mimeType: CommentImageMimeType
  ): Promise<string> {
    const projectId = this.store.getOverview().selectedMergeRequest?.projectId;
    if (!projectId) throw new Error("Select a merge request before uploading an image.");
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Uploading image to GitLab…",
        cancellable: false
      },
      async () => {
        const result = await this.commentImages.upload({
          type: "uploadCommentImage",
          requestId: `native-comment-${Date.now()}`,
          projectId,
          filename,
          mimeType,
          dataBase64: Buffer.from(bytes).toString("base64")
        });
        return result.markdown;
      }
    );
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

function sessionKey(projectId: string, mergeRequestIid: number, filePath: string): string {
  return `${projectId}!${mergeRequestIid}:${filePath}`;
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

function pastedImageFilename(mimeType: CommentImageMimeType): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  return `pasted-image-${Date.now()}.${extension}`;
}
