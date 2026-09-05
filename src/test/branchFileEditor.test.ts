import assert from "node:assert/strict";
import test from "node:test";
import { reviewContextKey, type ReviewContext } from "../reviewContext";
import type { BranchFileContent } from "../reviewTypes";

const INSTANCE_A = "https://gitlab.example.test";
const INSTANCE_B = "https://other.gitlab.example.test";

interface MockUriInit {
  scheme: string;
  authority?: string;
  path?: string;
  query?: string;
}

class MockUri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;

  constructor(value: MockUriInit) {
    this.scheme = value.scheme;
    this.authority = value.authority ?? "";
    this.path = value.path ?? "";
    this.query = value.query ?? "";
  }

  static from(value: MockUriInit): MockUri {
    return new MockUri(value);
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}${this.query ? `?${this.query}` : ""}`;
  }
}

class MockEventEmitter<T = unknown> {
  private readonly listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value?: T): void {
    for (const listener of [...this.listeners]) listener(value as T);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

class MockDisposable {
  dispose(): void {}
}

const mockState = {
  openedUris: [] as MockUri[],
  shownUris: [] as MockUri[],
  errors: [] as string[],
  openDocumentGate: undefined as { promise: Promise<void>; resolve(value: void): void } | undefined,
};

const vscodeMock = {
  Uri: MockUri,
  EventEmitter: MockEventEmitter,
  Disposable: MockDisposable,
  FileChangeType: { Changed: 1 },
  FileType: { File: 1 },
  FileSystemError: {
    FileNotFound: (uri: MockUri) => new Error(`File not found: ${uri.toString()}`),
    NoPermissions: (message: string) => new Error(message)
  },
  ViewColumn: { One: 1 },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }),
    openTextDocument: async (uri: MockUri): Promise<{ uri: MockUri }> => {
      mockState.openedUris.push(uri);
      if (mockState.openedUris.length === 1 && mockState.openDocumentGate) {
        await mockState.openDocumentGate.promise;
      }
      return { uri };
    }
  },
  languages: {
    setTextDocumentLanguage: async (document: { uri: MockUri }): Promise<{ uri: MockUri }> => document
  },
  window: {
    showTextDocument: async (document: { uri: MockUri }): Promise<void> => {
      mockState.shownUris.push(document.uri);
    },
    showErrorMessage: async (message: string): Promise<void> => {
      mockState.errors.push(message);
    }
  }
};

const moduleLoader = require("node:module") as {
  _load: (request: string, parent: unknown, isMain?: boolean) => unknown;
};
const originalModuleLoad = moduleLoader._load;
moduleLoader._load = (request, parent, isMain) => request === "vscode"
  ? vscodeMock
  : originalModuleLoad(request, parent, isMain);

test("BranchFileEditor includes review context in otherwise-colliding branch file URIs", async () => {
  const { BranchFileEditor } = await loadBranchFileEditor();
  resetMockState();
  const contextA = reviewContext(INSTANCE_A, "head-a");
  const contextB = reviewContext(INSTANCE_B, "head-a");
  const editorA = new BranchFileEditor(createStore(contextA, branchFile("content-a")) as never);
  const editorB = new BranchFileEditor(createStore(contextB, branchFile("content-b")) as never);

  await editorA.open("main", "src/file.ts");
  await editorB.open("main", "src/file.ts");

  const uriA = mockState.shownUris[0];
  const uriB = mockState.shownUris[1];
  assert.ok(uriA);
  assert.ok(uriB);
  assert.equal(uriA.authority, "123");
  assert.equal(uriA.path, uriB.path);
  assert.equal(uriA.authority, uriB.authority);
  assert.notEqual(uriA.query, uriB.query);
  assert.equal(uriA.query.includes(encodeURIComponent(reviewContextKey(contextA))), true);
  assert.equal(uriB.query.includes(encodeURIComponent(reviewContextKey(contextB))), true);
  assert.notEqual(uriA.toString(), uriB.toString());
  editorA.dispose();
  editorB.dispose();
});

test("BranchFileEditor refuses to load a branch file without a rendered review context", async () => {
  const { BranchFileEditor } = await loadBranchFileEditor();
  resetMockState();
  let loadCalls = 0;
  const editor = new BranchFileEditor({
    getReviewContext: () => undefined,
    loadBranchFile: async () => {
      loadCalls += 1;
      return branchFile("must not load");
    },
    assertReviewContext: () => undefined
  } as never);

  await editor.open("main", "src/file.ts");

  assert.equal(loadCalls, 0);
  assert.equal(mockState.openedUris.length, 0);
  assert.equal(mockState.shownUris.length, 0);
  assert.equal(mockState.errors.length, 1);
  editor.dispose();
});

test("BranchFileEditor drops an old async load when the review context changes", async () => {
  const { BranchFileEditor } = await loadBranchFileEditor();
  resetMockState();
  const contextA = reviewContext(INSTANCE_A, "head-a");
  const contextB = reviewContext(INSTANCE_B, "head-a");
  let currentContext: ReviewContext | undefined = contextA;
  const load = deferred<BranchFileContent>();
  const editor = new BranchFileEditor({
    getReviewContext: () => currentContext,
    loadBranchFile: () => load.promise,
    assertReviewContext: (expected: ReviewContext) => {
      if (!currentContext || reviewContextKey(expected) !== reviewContextKey(currentContext)) {
        throw new Error("stale review context");
      }
    }
  } as never);

  const opening = editor.open("main", "src/file.ts");
  await flushMicrotasks();
  currentContext = contextB;
  load.resolve(branchFile("stale content"));
  await opening;

  assert.equal(mockState.openedUris.length, 0);
  assert.equal(mockState.shownUris.length, 0);
  assert.equal(mockState.errors.length, 1);
  editor.dispose();
});

test("BranchFileEditor refreshes the content for a same-context manual reopen", async () => {
  const { BranchFileEditor } = await loadBranchFileEditor();
  resetMockState();
  const context = reviewContext(INSTANCE_A, "head-a");
  let content = "version-1";
  const editor = new BranchFileEditor({
    getReviewContext: () => context,
    loadBranchFile: async () => branchFile(content),
    assertReviewContext: () => undefined
  } as never);

  await editor.open("main", "src/file.ts");
  const firstUri = mockState.shownUris[0];
  content = "version-2";
  await editor.open("main", "src/file.ts");
  const secondUri = mockState.shownUris[1];

  assert.ok(firstUri);
  assert.ok(secondUri);
  assert.equal(firstUri.toString(), secondUri.toString());
  assert.equal(new TextDecoder().decode(editor.readFile(secondUri as never)), "version-2");
  editor.dispose();
});

test("BranchFileEditor keeps the newer same-URI entry when an older open finishes later", async () => {
  const { BranchFileEditor } = await loadBranchFileEditor();
  resetMockState();
  const context = reviewContext(INSTANCE_A, "head-a");
  const firstOpenGate = deferred<void>();
  mockState.openDocumentGate = firstOpenGate;
  let loadCount = 0;
  const editor = new BranchFileEditor({
    getReviewContext: () => context,
    loadBranchFile: async () => branchFile(`content-${++loadCount}`),
    assertReviewContext: () => undefined
  } as never);

  const firstOpen = editor.open("main", "src/file.ts");
  await flushMicrotasks();
  assert.equal(mockState.openedUris.length, 1);

  const secondOpen = editor.open("main", "src/file.ts");
  await secondOpen;
  const secondUri = mockState.shownUris[0];
  assert.ok(secondUri);
  assert.equal(new TextDecoder().decode(editor.readFile(secondUri as never)), "content-2");

  firstOpenGate.resolve(undefined);
  await firstOpen;

  assert.equal(new TextDecoder().decode(editor.readFile(secondUri as never)), "content-2");
  assert.equal(mockState.errors.length, 0);
  editor.dispose();
});

async function loadBranchFileEditor(): Promise<typeof import("../branchFileEditor")> {
  const module = await import("../branchFileEditor.js");
  return module;
}

function createStore(context: ReviewContext, file: BranchFileContent): {
  getReviewContext(): ReviewContext;
  loadBranchFile(): Promise<BranchFileContent>;
  assertReviewContext(expected: ReviewContext): void;
} {
  return {
    getReviewContext: () => context,
    loadBranchFile: async () => file,
    assertReviewContext: (expected) => {
      if (reviewContextKey(expected) !== reviewContextKey(context)) throw new Error("stale review context");
    }
  };
}

function reviewContext(instanceUrl: string, headSha: string): ReviewContext {
  return {
    instanceUrl,
    projectId: "123",
    mergeRequestIid: 7,
    baseSha: "base-sha",
    startSha: "start-sha",
    headSha
  };
}

function branchFile(content: string): BranchFileContent {
  return {
    projectId: "123",
    branch: "main",
    path: "src/file.ts",
    language: "typescript",
    content
  };
}

function resetMockState(): void {
  mockState.openedUris = [];
  mockState.shownUris = [];
  mockState.errors = [];
  mockState.openDocumentGate = undefined;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
