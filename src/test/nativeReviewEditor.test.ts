import assert from "node:assert/strict";
import test from "node:test";
import { reviewContextKey, type ReviewContext } from "../reviewContext";

type Listener<T> = (value: T) => void;

class MockEventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  readonly event = (listener: Listener<T>): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

class MockDisposable {
  dispose(): void {}
}

class MockUri {
  readonly fsPath: string;

  constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query = ""
  ) {
    this.fsPath = scheme === "file" ? path : "";
  }

  static from(value: { scheme: string; authority?: string; path?: string; query?: string }): MockUri {
    return new MockUri(value.scheme, value.authority ?? "", value.path ?? "", value.query ?? "");
  }

  static file(filePath: string): MockUri {
    return new MockUri("file", "", filePath);
  }

  static parse(value: string): MockUri {
    const match = /^([^:]+):(?:\/\/([^/]*))?(.*?)(?:\?(.*))?$/.exec(value);
    return new MockUri(match?.[1] ?? "", match?.[2] ?? "", match?.[3] ?? value, match?.[4] ?? "");
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}${this.query ? `?${this.query}` : ""}`;
  }
}

class MockRange {
  constructor(
    readonly startLine: number,
    readonly startCharacter: number,
    readonly endLine: number,
    readonly endCharacter: number
  ) {}

  get start(): { line: number; character: number } {
    return { line: this.startLine, character: this.startCharacter };
  }

  get end(): { line: number; character: number } {
    return { line: this.endLine, character: this.endCharacter };
  }
}

class MockMarkdownString {
  supportHtml = false;
  isTrusted = false;

  constructor(public value: string) {}
}

class MockPasteEditKind {
  constructor(readonly value: string) {}

  append(...parts: string[]): MockPasteEditKind {
    return new MockPasteEditKind([this.value, ...parts].join("/"));
  }
}

class MockTabInputText {
  constructor(readonly uri: MockUri) {}
}

class MockTabInputTextDiff {
  constructor(readonly original: MockUri, readonly modified: MockUri) {}
}

class MockTabInputCustom {
  constructor(readonly uri: MockUri) {}
}

class MockTabInputTerminal {}

class MockDocumentPasteEdit {
  constructor(
    public insertText: string,
    readonly title: string,
    readonly kind: MockPasteEditKind
  ) {}
}

interface MockState {
  activeTextEditor: { document: { uri: MockUri; lineCount: number } } | undefined;
  visibleTextEditors: Array<{ document: { uri: MockUri; lineCount: number } }>;
  activeTab: { input: unknown } | undefined;
  activeChanged: MockEventEmitter<unknown>;
  visibleChanged: MockEventEmitter<unknown>;
  tabsChanged: MockEventEmitter<unknown>;
  tabGroupsChanged: MockEventEmitter<unknown>;
  closedDocuments: MockEventEmitter<{ uri: MockUri }>;
  errors: string[];
  infos: string[];
  diffCalls: Array<readonly unknown[]>;
  commandHandlers: Map<string, (...args: any[]) => any>;
  controllers: any[];
  nextAction: string | undefined;
  fsReadFile: (...args: any[]) => Promise<Uint8Array>;
  openDialog: (...args: any[]) => Promise<Array<{ fsPath: string; uri?: MockUri }> | undefined>;
}

const mockState: MockState = {
  activeTextEditor: undefined,
  visibleTextEditors: [],
  activeTab: undefined,
  activeChanged: new MockEventEmitter(),
  visibleChanged: new MockEventEmitter(),
  tabsChanged: new MockEventEmitter(),
  tabGroupsChanged: new MockEventEmitter(),
  closedDocuments: new MockEventEmitter(),
  errors: [],
  infos: [],
  diffCalls: [],
  commandHandlers: new Map(),
  controllers: [],
  nextAction: undefined,
  fsReadFile: async () => new Uint8Array(),
  openDialog: async () => undefined
};

function resetMockState(): void {
  mockState.activeTextEditor = undefined;
  mockState.visibleTextEditors = [];
  mockState.activeTab = undefined;
  mockState.errors = [];
  mockState.infos = [];
  mockState.diffCalls = [];
  mockState.commandHandlers.clear();
  mockState.controllers = [];
  mockState.nextAction = undefined;
  mockState.fsReadFile = async () => new Uint8Array();
  mockState.openDialog = async () => undefined;
}

const vscodeMock = {
  Uri: MockUri,
  Range: MockRange,
  MarkdownString: MockMarkdownString,
  DocumentPasteEdit: MockDocumentPasteEdit,
  DocumentDropOrPasteEditKind: { Empty: new MockPasteEditKind("empty") },
  TabInputText: MockTabInputText,
  TabInputTextDiff: MockTabInputTextDiff,
  TabInputCustom: MockTabInputCustom,
  TabInputTerminal: MockTabInputTerminal,
  CommentMode: { Preview: 0, Editing: 1 },
  CommentThreadState: { Unresolved: 0, Resolved: 1 },
  CommentThreadCollapsibleState: { Collapsed: 0, Expanded: 1 },
  ProgressLocation: { Notification: 15 },
  CancellationError: class MockCancellationError extends Error {},
  EventEmitter: MockEventEmitter,
  comments: {
    createCommentController: (_id: string, _label: string) => {
      const threads: any[] = [];
      const controller: any = {
        options: undefined,
        commentingRangeProvider: undefined,
        reactionHandler: undefined,
        threads,
        createCommentThread(uri: MockUri, range: MockRange, comments: readonly unknown[]) {
          const thread: any = {
            uri,
            range,
            comments: [...comments],
            collapsibleState: 0,
            canReply: true,
            contextValue: undefined,
            label: undefined,
            state: undefined,
            disposed: false,
            dispose() {
              this.disposed = true;
              const index = threads.indexOf(this);
              if (index >= 0) threads.splice(index, 1);
            }
          };
          threads.push(thread);
          return thread;
        },
        dispose() {
          for (const thread of [...threads]) thread.dispose();
        }
      };
      mockState.controllers.push(controller);
      return controller;
    }
  },
  commands: {
    registerCommand: (command: string, handler: (...args: any[]) => any) => {
      mockState.commandHandlers.set(command, handler);
      return new MockDisposable();
    },
    executeCommand: async (command: string, ...args: unknown[]) => {
      if (command === "vscode.diff") {
        mockState.diffCalls.push(args);
        const head = args[1] as MockUri;
        const document = { uri: head, lineCount: 20 };
        mockState.activeTextEditor = { document };
        mockState.visibleTextEditors = [{ document }];
        mockState.activeTab = { input: new MockTabInputTextDiff(args[0] as MockUri, head) };
        mockState.activeChanged.fire(mockState.activeTextEditor);
        mockState.visibleChanged.fire(mockState.visibleTextEditors);
        mockState.tabsChanged.fire(undefined);
      }
      return mockState.commandHandlers.get(command)?.(...args);
    }
  },
  languages: {
    registerDocumentPasteEditProvider: () => new MockDisposable()
  },
  window: {
    get activeTextEditor() {
      return mockState.activeTextEditor;
    },
    get visibleTextEditors() {
      return mockState.visibleTextEditors;
    },
    onDidChangeActiveTextEditor: mockState.activeChanged.event,
    onDidChangeVisibleTextEditors: mockState.visibleChanged.event,
    tabGroups: {
      get activeTabGroup() {
        return { activeTab: mockState.activeTab };
      },
      onDidChangeTabs: mockState.tabsChanged.event,
      onDidChangeTabGroups: mockState.tabGroupsChanged.event
    },
    showErrorMessage: async (message: string, ...actions: string[]) => {
      mockState.errors.push(message);
      return mockState.nextAction && actions.includes(mockState.nextAction) ? mockState.nextAction : undefined;
    },
    showInformationMessage: async (message: string) => {
      mockState.infos.push(message);
      return undefined;
    },
    showOpenDialog: (...args: any[]) => mockState.openDialog(...args),
    withProgress: async (_options: unknown, task: () => Promise<unknown>) => task()
  },
  workspace: {
    onDidCloseTextDocument: mockState.closedDocuments.event,
    fs: {
      readFile: (...args: any[]) => mockState.fsReadFile(...args)
    }
  }
};

const moduleApi = require("node:module") as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleApi._load;
moduleApi._load = function load(request, parent, isMain) {
  if (request === "vscode") return vscodeMock;
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { NativeReviewEditor } = require("../nativeReviewEditor") as {
  NativeReviewEditor: new (store: unknown, localGit: unknown, commentImages: unknown) => any;
};
moduleApi._load = originalModuleLoad;

const baseContext: ReviewContext = {
  instanceUrl: "https://gitlab.example.com",
  projectId: "group/project",
  mergeRequestIid: 17,
  baseSha: "base-sha",
  startSha: "start-sha",
  headSha: "head-sha"
};

function makeHarness(options: {
  currentContext?: ReviewContext;
  addThreadResult?: { ok: true } | { ok: false; errorMessage: string };
  currentLines?: Array<{ id: string; kind: string; text: string; oldLine?: number; mrLine?: number; threadIds: string[] }>;
} = {}): any {
  resetMockState();
  let currentContext = options.currentContext ?? baseContext;
  const storeChanges = new MockEventEmitter<void>();
  const file = {
    path: "src/example.ts",
    oldPath: "src/example.ts",
    newPath: "src/example.ts",
    language: "typescript",
    status: "modified",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    collapsed: false,
    tooLarge: false,
    generatedFile: false
  };
  const currentLines = options.currentLines ?? [
    { id: "line-10", kind: "mr-added", text: "new", mrLine: 10, threadIds: [] }
  ];
  const addThreadCalls: unknown[][] = [];
  const store: any = {
    onDidChange: storeChanges.event,
    getReviewContext: () => currentContext,
    getProjectIdentity: () => "group/project",
    assertReviewContext: (expected: ReviewContext | undefined) => {
      if (!expected || reviewContextKey(expected) !== reviewContextKey(currentContext)) throw new Error("stale review context");
    },
    getOverview: () => ({
      selectedMergeRequest: { projectId: file.path ? "group/project" : "", iid: 17 },
      sourceBranch: "feature",
      threads: [],
      files: [file],
      commits: []
    }),
    loadReviewFileContents: async () => ({ oldText: "old\n", mrText: "new\n" }),
    getFileViewModel: () => ({
      file,
      lines: currentLines,
      threads: [],
      summary: {},
      editableText: "new\n",
      hasLocalEdit: false,
      contentMode: "full",
      fullFileState: "loaded",
      lineWindow: { start: 0, end: currentLines.length, total: currentLines.length, hasPrevious: false, hasNext: false }
    }),
    getThreadDetails: () => [],
    getSubmissionMode: () => "comment",
    addThread: (...args: unknown[]) => {
      addThreadCalls.push(args);
      return Promise.resolve(options.addThreadResult ?? { ok: true });
    },
    addComment: async () => ({ ok: true }),
    toggleCommentReaction: async () => ({ ok: true }),
    toggleResolved: async () => ({ ok: true }),
    editComment: async () => ({ ok: true }),
    loadNewChangesFileReviewContext: async () => ({
      range: { fromSha: "old-push", toSha: baseContext.headSha, projectId: "group/project", mergeRequestIid: 17 },
      file: { ...file, diff: "@@", oldPath: file.oldPath, newPath: file.newPath }
    }),
    loadNewChangesFileContents: async () => ({ oldText: "before\n", newText: "after\n" }),
    buildNewChangesFileViewModel: () => ({
      file,
      lines: [{ id: "comparison-line", kind: "mr-added", text: "after", mrLine: 1, threadIds: [] }],
      threads: [],
      summary: {},
      editableText: "after\n",
      hasLocalEdit: false,
      contentMode: "full",
      fullFileState: "loaded",
      lineWindow: { start: 0, end: 1, total: 1, hasPrevious: false, hasNext: false }
    })
  };
  const localGit = { getState: () => ({ phase: "unavailable" }) };
  const uploadCalls: unknown[] = [];
  const commentImages = {
    resolve: async () => ({ cachePath: "", imagePath: "" }),
    upload: async (...args: unknown[]) => {
      uploadCalls.push(args);
      return { markdown: "![image](/uploads/image.png)", imagePath: "", cachePath: "" };
    }
  };
  const editor = new NativeReviewEditor(store, localGit, commentImages);
  return {
    editor,
    store,
    file,
    localGit,
    commentImages,
    currentLines,
    addThreadCalls,
    uploadCalls,
    setContext: (next: ReviewContext) => { currentContext = next; },
    emitStoreChange: () => storeChanges.fire(),
    closeDocument: (document: { uri: MockUri }) => mockState.closedDocuments.fire(document),
    state: mockState,
    controller: mockState.controllers[0]
  };
}

test("stale revision prevents an async open from publishing an old session", async () => {
  let resolveContents!: (value: { oldText: string; mrText: string }) => void;
  const harness = makeHarness();
  harness.store.loadReviewFileContents = () => new Promise((resolve) => { resolveContents = resolve; });
  const opening = harness.editor.openFile(harness.file.path);
  harness.setContext({ ...baseContext, headSha: "new-head" });
  resolveContents({ oldText: "old\n", mrText: "new\n" });
  await opening;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.state.diffCalls.length, 0);
  assert.equal(harness.state.errors.some((message: string) => message.includes("changed")), true);
  harness.editor.dispose();
});

test("a failed fresh comment keeps the composer and allows retry", async () => {
  const harness = makeHarness({ addThreadResult: { ok: false, errorMessage: "save failed" } });
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), []);
  await (harness.editor as any).submitText(composer, "keep this draft");
  assert.equal(composer.disposed, false);
  assert.equal(composer.canReply, true);
  assert.equal(harness.state.errors.includes("save failed"), true);
  assert.equal(harness.addThreadCalls.length, 1);
  harness.editor.dispose();
});

test("the submit command rejects on failure so VS Code keeps the composer", async () => {
  const harness = makeHarness({ addThreadResult: { ok: false, errorMessage: "save failed" } });
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), []);
  const submit = harness.state.commandHandlers.get("gitlabReview.nativeComment.submit");
  assert.ok(submit);

  await assert.rejects(() => submit!({ thread: composer, text: "keep this draft" }));
  assert.equal(composer.disposed, false);

  harness.store.addThread = async () => ({ ok: true });
  await assert.doesNotReject(() => submit!({ thread: composer, text: "keep this draft" }));
  assert.equal(composer.disposed, true);
  harness.editor.dispose();
});

test("the submit command rejects stale comments and keeps their draft", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), []);
  const submit = harness.state.commandHandlers.get("gitlabReview.nativeComment.submit");
  assert.ok(submit);
  harness.setContext({ ...baseContext, headSha: "new-head" });
  harness.emitStoreChange();

  await assert.rejects(() => submit!({ thread: composer, text: "keep this draft" }));
  assert.equal(composer.disposed, false);
  assert.equal(harness.state.errors.some((message: string) => message.includes("changed")), true);
  harness.editor.dispose();
});

test("an in-flight image attach reserves the composer and rejects duplicates", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), []);
  const upload = harness.state.commandHandlers.get("gitlabReview.nativeComment.uploadAndSubmit");
  const submit = harness.state.commandHandlers.get("gitlabReview.nativeComment.submit");
  assert.ok(upload);
  assert.ok(submit);
  harness.state.fsReadFile = async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let resolveDialog!: (value: Array<{ fsPath: string }>) => void;
  harness.state.openDialog = () => new Promise((resolve) => { resolveDialog = resolve; });

  const first = upload!({ thread: composer, text: "comment" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(composer.canReply, false);
  await assert.rejects(() => upload!({ thread: composer, text: "duplicate" }));
  await assert.rejects(() => submit!({ thread: composer, text: "competing submit" }));

  resolveDialog([{ fsPath: "C:\\image.png" }]);
  await first;
  assert.equal(harness.uploadCalls.length, 1);
  assert.equal(harness.addThreadCalls.length, 1);
  assert.equal(composer.disposed, true);
  harness.editor.dispose();
});

test("a failed image attach restores reply availability and rejects the command", async () => {
  const harness = makeHarness({ addThreadResult: { ok: false, errorMessage: "save failed" } });
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), []);
  const upload = harness.state.commandHandlers.get("gitlabReview.nativeComment.uploadAndSubmit");
  assert.ok(upload);
  harness.state.fsReadFile = async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  harness.state.openDialog = async () => [{ fsPath: "C:\\image.png" }];

  await assert.rejects(() => upload!({ thread: composer, text: "keep this draft" }));
  assert.equal(harness.uploadCalls.length, 1);
  assert.equal(harness.addThreadCalls.length, 1);
  assert.equal(composer.disposed, false);
  assert.equal(composer.canReply, true);
  harness.editor.dispose();
});

test("a successful image reply leaves the existing thread replyable", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const thread: any = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), [{}]);
  (harness.editor as any).threadBindings.set(thread, {
    sessionKey: session.key,
    filePath: harness.file.path,
    context: baseContext,
    reviewThreadId: "thread-1"
  });
  const upload = harness.state.commandHandlers.get("gitlabReview.nativeComment.uploadAndSubmit");
  assert.ok(upload);
  harness.state.fsReadFile = async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  harness.state.openDialog = async () => [{ fsPath: "C:\\image.png" }];

  await upload!({ thread, text: "reply with image" });

  assert.equal(harness.uploadCalls.length, 1);
  assert.equal(thread.canReply, true);
  assert.equal(thread.disposed, false);
  harness.editor.dispose();
});

test("switching merge requests keeps stale sessions and their composers", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), []);

  harness.setContext({ ...baseContext, headSha: "new-head" });
  harness.emitStoreChange();

  assert.equal(session.stale, true);
  assert.equal(composer.disposed, false);
  assert.equal((harness.editor as any).sessions.size, 1);
  assert.equal(harness.editor.getActiveFilePath(), undefined);
  harness.editor.dispose();
});

test("a store refresh during a new context open does not cancel that open", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  harness.setContext({ ...baseContext, headSha: "new-head" });
  harness.emitStoreChange();
  let refreshed = false;
  harness.store.loadReviewFileContents = async () => {
    if (!refreshed) {
      refreshed = true;
      harness.emitStoreChange();
    }
    return { oldText: "old\n", mrText: "new\n" };
  };

  await harness.editor.openFile(harness.file.path);

  assert.equal(harness.state.diffCalls.length, 2);
  const currentSession = [...(harness.editor as any).sessions.values()]
    .find((candidate: any) => candidate.context.headSha === "new-head");
  assert.ok(currentSession);
  assert.equal(currentSession.stale, false);
  assert.equal(harness.editor.getActiveFilePath(), harness.file.path);
  harness.editor.dispose();
});

test("a local file URI is not reused by a different review context", async () => {
  const harness = makeHarness();
  harness.localGit.getState = () => ({
    phase: "ready",
    remoteMatch: "matched",
    repositoryRoot: "C:\\repo"
  });
  harness.state.fsReadFile = async () => new TextEncoder().encode("new\n");

  await harness.editor.openFile(harness.file.path);
  const firstSession = [...(harness.editor as any).sessions.values()][0];
  assert.equal(firstSession.head.uri.scheme, "file");

  harness.setContext({ ...baseContext, headSha: "new-head" });
  harness.emitStoreChange();
  await harness.editor.openFile(harness.file.path);

  const secondSession = [...(harness.editor as any).sessions.values()]
    .find((candidate: any) => candidate.context.headSha === "new-head");
  assert.ok(secondSession);
  assert.equal(secondSession.head.uri.scheme, "gitlab-review-diff");
  assert.equal(firstSession.stale, true);
  harness.editor.dispose();
});

test("a closed local document keeps its stale composer bound to the old context", async () => {
  const harness = makeHarness();
  harness.localGit.getState = () => ({
    phase: "ready",
    remoteMatch: "matched",
    repositoryRoot: "C:\\repo"
  });
  harness.state.fsReadFile = async () => new TextEncoder().encode("new\n");

  await harness.editor.openFile(harness.file.path);
  const firstSession = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(firstSession.head.uri, new MockRange(4, 0, 4, 0), []);
  harness.closeDocument(firstSession.head);
  harness.setContext({ ...baseContext, headSha: "new-head" });
  harness.emitStoreChange();
  await harness.editor.openFile(harness.file.path);

  const secondSession = [...(harness.editor as any).sessions.values()]
    .find((candidate: any) => candidate.context.headSha === "new-head");
  assert.ok(secondSession);
  assert.equal(secondSession.head.uri.scheme, "gitlab-review-diff");
  await (harness.editor as any).submitText(composer, "must stay on old MR");
  assert.equal(harness.addThreadCalls.length, 0);
  assert.equal(composer.disposed, false);
  harness.editor.dispose();
});

test("a modified open local buffer falls back to a virtual head document", async () => {
  const harness = makeHarness();
  harness.localGit.getState = () => ({
    phase: "ready",
    remoteMatch: "matched",
    repositoryRoot: "C:\\repo"
  });
  harness.state.fsReadFile = async () => new TextEncoder().encode("new\n");
  const localUri = MockUri.file("C:\\repo\\src\\example.ts");
  const localDocument: any = {
    uri: localUri,
    lineCount: 1,
    getText: () => "modified\n"
  };
  harness.state.activeTextEditor = { document: localDocument };
  harness.state.visibleTextEditors = [{ document: localDocument }];
  harness.state.activeTab = { input: new MockTabInputText(localUri) };

  await harness.editor.openFile(harness.file.path);

  const session = [...(harness.editor as any).sessions.values()][0];
  assert.equal(session.head.uri.scheme, "gitlab-review-diff");
  harness.editor.dispose();
});

test("a changed editor buffer cannot submit a fresh comment", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), []);
  const activeDocument = harness.state.activeTextEditor!.document as any;
  activeDocument.getText = () => "changed\n";

  await (harness.editor as any).submitText(composer, "keep this draft");

  assert.equal(harness.addThreadCalls.length, 0);
  assert.equal(composer.disposed, false);
  assert.equal(harness.state.errors.some((message: string) => message.includes("changed locally")), true);
  harness.editor.dispose();
});

test("paste is disabled when retained sessions have mixed review contexts", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  harness.setContext({ ...baseContext, headSha: "new-head" });
  harness.emitStoreChange();

  await harness.editor.openFile(harness.file.path);

  assert.equal((harness.editor as any).contextForPaste(), undefined);
  harness.editor.dispose();
});

test("a successful mutation remains successful if refresh changes context", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(4, 0, 4, 0), []);
  harness.store.addThread = async (...args: unknown[]) => {
    harness.setContext({ ...baseContext, headSha: "new-head" });
    harness.emitStoreChange();
    return { ok: true };
  };

  await (harness.editor as any).submitText(composer, "comment");

  assert.equal(composer.disposed, true);
  assert.equal(harness.state.errors.length, 0);
  harness.editor.dispose();
});

test("latest-push comments map old lines from the current MR model", async () => {
  const harness = makeHarness({
    currentLines: [{ id: "mr-line-10", kind: "context", text: "current", oldLine: 7, mrLine: 10, threadIds: [] }]
  });
  await harness.editor.openNewChangesFile(harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  const composer = harness.controller.createCommentThread(session.head.uri, new MockRange(9, 0, 9, 0), []);
  await (harness.editor as any).submitText(composer, "comment");
  assert.equal(harness.addThreadCalls[0]?.[1], 10);
  assert.equal(harness.addThreadCalls[0]?.[2], 7);
  assert.equal(composer.disposed, true);
  harness.editor.dispose();
});

test("active file follows the actual editor and clears when its document closes", async () => {
  const harness = makeHarness();
  await harness.editor.openFile(harness.file.path);
  assert.equal(harness.editor.getActiveFilePath(), harness.file.path);
  const session = [...(harness.editor as any).sessions.values()][0];
  harness.state.activeTextEditor = undefined;
  harness.state.activeTab = { input: new MockTabInputTerminal() };
  harness.state.tabsChanged.fire(undefined);
  assert.equal(harness.editor.getActiveFilePath(), undefined);
  harness.state.visibleTextEditors = [];
  harness.state.activeTab = undefined;
  harness.closeDocument(session.head);
  assert.equal(harness.editor.getActiveFilePath(), undefined);
  harness.editor.dispose();
});
