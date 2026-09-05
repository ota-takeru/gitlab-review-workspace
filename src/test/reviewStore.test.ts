import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewContext } from "../reviewContext";
import type {
  BranchFileContent,
  ReviewComment,
  ReviewFile,
  ReviewReaction,
  ReviewState,
  ReviewThread
} from "../reviewTypes";

const INSTANCE_A = "https://gitlab.example.test";
const INSTANCE_B = "https://other.gitlab.example.test";

test("ReviewStore rejects mutations when the rendered review instance changed", async () => {
  const { ReviewStore, GitLabReviewClient } = await loadReviewModules();
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalLoadMergeRequest = clientPrototype.loadMergeRequest;
  const originalAddReply = clientPrototype.addReply;
  const originalCreateThread = clientPrototype.createThread;
  let mutationCalls = 0;
  clientPrototype.loadMergeRequest = () => Promise.resolve(cloneReview(baseReview()));
  clientPrototype.addReply = () => {
    mutationCalls += 1;
    return Promise.resolve(confirmedReply());
  };
  clientPrototype.createThread = () => {
    mutationCalls += 1;
    return Promise.resolve(confirmedThread());
  };

  try {
    let currentInstance = INSTANCE_A;
    const store = new ReviewStore(createTestContext(baseReview(), INSTANCE_A) as never, () => currentInstance);
    await store.refresh();
    const renderedContext = store.getReviewContext();
    assert.ok(renderedContext);

    currentInstance = INSTANCE_B;
    const replyResult = await store.addComment("thread-1", "Reply from an old view", renderedContext);
    const threadResult = await store.addThread("src/file.ts", 1, 1, "Thread from an old view", "comment", renderedContext);

    assert.equal(replyResult.ok, false);
    assert.equal(threadResult.ok, false);
    assert.equal(mutationCalls, 0);
  } finally {
    clientPrototype.loadMergeRequest = originalLoadMergeRequest;
    clientPrototype.addReply = originalAddReply;
    clientPrototype.createThread = originalCreateThread;
  }
});

test("ReviewStore rolls back an optimistic reply when the API fails", async () => {
  const { ReviewStore, GitLabReviewClient } = await loadReviewModules();
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalLoadMergeRequest = clientPrototype.loadMergeRequest;
  const originalAddReply = clientPrototype.addReply;
  let addReplyCalls = 0;
  clientPrototype.loadMergeRequest = () => Promise.resolve(cloneReview(baseReview()));
  clientPrototype.addReply = () => {
    addReplyCalls += 1;
    return Promise.reject(new Error("reply failed"));
  };

  try {
    const store = new ReviewStore(createTestContext(baseReview(), INSTANCE_A) as never, () => INSTANCE_A);
    await store.refresh();
    const renderedContext = store.getReviewContext();
    assert.ok(renderedContext);
    let sawOptimisticReply = false;
    store.onDidChange(() => {
      const thread = store.getThreadDetails(["thread-1"])[0];
      if (thread?.comments.some((comment) => comment.pending && comment.body === "Reply")) sawOptimisticReply = true;
    });

    const result = await store.addComment("thread-1", " Reply ", renderedContext);
    const thread = store.getThreadDetails(["thread-1"])[0];

    assert.equal(result.ok, false);
    assert.equal(addReplyCalls, 1);
    assert.equal(sawOptimisticReply, true);
    assert.ok(thread);
    assert.deepEqual(thread.comments.map((comment) => comment.body), ["Original comment"]);
    assert.equal(thread.pending, false);
    assert.equal(thread.comments.some((comment) => comment.pending), false);
  } finally {
    clientPrototype.loadMergeRequest = originalLoadMergeRequest;
    clientPrototype.addReply = originalAddReply;
  }
});

test("ReviewStore queues refresh behind an in-flight reply and keeps the confirmed reply", async () => {
  const { ReviewStore, GitLabReviewClient } = await loadReviewModules();
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalLoadMergeRequest = clientPrototype.loadMergeRequest;
  const originalAddReply = clientPrototype.addReply;
  const reply = deferred<ReviewComment>();
  let replyStarted = false;
  let replyConfirmed = false;
  let loadCount = 0;
  clientPrototype.loadMergeRequest = () => {
    loadCount += 1;
    const review = cloneReview(baseReview());
    if (replyConfirmed) review.threads[0]?.comments.push(confirmedReply());
    return Promise.resolve(review);
  };
  clientPrototype.addReply = () => {
    replyStarted = true;
    return reply.promise;
  };

  try {
    const store = new ReviewStore(createTestContext(baseReview(), INSTANCE_A) as never, () => INSTANCE_A);
    await store.refresh();
    await flushMicrotasks();
    const renderedContext = store.getReviewContext();
    assert.ok(renderedContext);

    const replyPromise = store.addComment("thread-1", "Reply", renderedContext);
    await flushMicrotasks();
    assert.equal(replyStarted, true);

    const refreshPromise = store.refresh();
    assert.equal(loadCount, 1);

    replyConfirmed = true;
    reply.resolve(confirmedReply());
    assert.equal((await replyPromise).ok, true);
    await refreshPromise;

    assert.equal(loadCount, 2);
    const thread = store.getThreadDetails(["thread-1"])[0];
    assert.deepEqual(thread?.comments.map((comment) => comment.body), ["Original comment", "Reply"]);
  } finally {
    clientPrototype.loadMergeRequest = originalLoadMergeRequest;
    clientPrototype.addReply = originalAddReply;
  }
});

test("ReviewStore rejects a queued mutation after refresh advances the diff head", async () => {
  const { ReviewStore, GitLabReviewClient } = await loadReviewModules();
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalLoadMergeRequest = clientPrototype.loadMergeRequest;
  const originalAddReply = clientPrototype.addReply;
  const refreshedReview = deferred<ReviewState>();
  let loadCount = 0;
  let addReplyCalls = 0;
  clientPrototype.loadMergeRequest = () => {
    loadCount += 1;
    return loadCount === 1 ? Promise.resolve(cloneReview(baseReview())) : refreshedReview.promise;
  };
  clientPrototype.addReply = () => {
    addReplyCalls += 1;
    return Promise.resolve(confirmedReply());
  };

  try {
    const store = new ReviewStore(createTestContext(baseReview(), INSTANCE_A) as never, () => INSTANCE_A);
    await store.refresh();
    await flushMicrotasks();
    const oldContext = store.getReviewContext();
    assert.ok(oldContext);

    const refreshPromise = store.refresh();
    const mutationPromise = store.addComment("thread-1", "Queued reply", oldContext);
    refreshedReview.resolve(cloneReview({
      ...baseReview(),
      diffRefs: { baseSha: "base-b", startSha: "start-b", headSha: "head-b" }
    }));

    await refreshPromise;
    const result = await mutationPromise;
    const currentContext = store.getReviewContext();
    assert.equal(result.ok, false);
    assert.equal(addReplyCalls, 0);
    assert.equal(currentContext?.headSha, "head-b");
  } finally {
    clientPrototype.loadMergeRequest = originalLoadMergeRequest;
    clientPrototype.addReply = originalAddReply;
  }
});

test("ReviewStore invalidates branch file cache after refresh", async () => {
  const { ReviewStore, GitLabReviewClient } = await loadReviewModules();
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalLoadMergeRequest = clientPrototype.loadMergeRequest;
  const originalReadRepositoryFile = clientPrototype.readRepositoryFile;
  let readCalls = 0;
  clientPrototype.loadMergeRequest = () => Promise.resolve(cloneReview(baseReview()));
  clientPrototype.readRepositoryFile = (): Promise<BranchFileContent> => {
    readCalls += 1;
    return Promise.resolve({
      projectId: "group/project",
      branch: "main",
      path: "README.md",
      language: "markdown",
      content: `branch-read-${readCalls}`
    });
  };

  try {
    const store = new ReviewStore(createTestContext(baseReview(), INSTANCE_A) as never, () => INSTANCE_A);
    await store.refresh();
    assert.equal((await store.loadBranchFile("main", "README.md")).content, "branch-read-1");
    assert.equal((await store.loadBranchFile("main", "README.md")).content, "branch-read-1");
    assert.equal(readCalls, 1);

    await store.refresh();
    assert.equal((await store.loadBranchFile("main", "README.md")).content, "branch-read-2");
    assert.equal(readCalls, 2);
  } finally {
    clientPrototype.loadMergeRequest = originalLoadMergeRequest;
    clientPrototype.readRepositoryFile = originalReadRepositoryFile;
  }
});

test("ReviewStore restores scoped cache after an instance switch without restoring a live context", async () => {
  const { ReviewStore, GitLabReviewClient } = await loadReviewModules();
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalLoadMergeRequest = clientPrototype.loadMergeRequest;
  const originalAddReply = clientPrototype.addReply;
  let addReplyCalls = 0;
  clientPrototype.loadMergeRequest = () => Promise.resolve(cloneReview(baseReview()));
  clientPrototype.addReply = () => {
    addReplyCalls += 1;
    return Promise.resolve(confirmedReply());
  };

  try {
    let currentInstance = INSTANCE_A;
    const context = createTestContext(baseReview(), INSTANCE_A);
    const store = new ReviewStore(context as never, () => currentInstance);
    await store.refresh();
    const renderedContext = store.getReviewContext();
    assert.ok(renderedContext);

    currentInstance = INSTANCE_B;
    const otherInstanceOverview = store.getOverview();
    assert.equal(otherInstanceOverview.selectedMergeRequest, undefined);
    assert.equal(otherInstanceOverview.files.length, 0);

    currentInstance = INSTANCE_A;
    const cachedOverview = store.getOverview();
    assert.equal(cachedOverview.selectedMergeRequest?.projectId, "group/project");
    assert.equal(cachedOverview.files.length, 1);
    assert.equal(store.getReviewContext(), undefined);

    const rejected = await store.addComment("thread-1", "Reply while using cached state", renderedContext);
    assert.equal(rejected.ok, false);
    assert.equal(addReplyCalls, 0);

    await store.refresh();
    const refreshedContext = store.getReviewContext();
    assert.ok(refreshedContext);
    assert.equal(refreshedContext.headSha, "head-a");
    const accepted = await store.addComment("thread-1", "Reply after refresh", refreshedContext);
    assert.equal(accepted.ok, true);
    assert.equal(addReplyCalls, 1);
  } finally {
    clientPrototype.loadMergeRequest = originalLoadMergeRequest;
    clientPrototype.addReply = originalAddReply;
  }
});

test("ReviewStore queues reaction toggle behind the initial reaction read", async () => {
  const { ReviewStore, GitLabReviewClient } = await loadReviewModules();
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalLoadMergeRequest = clientPrototype.loadMergeRequest;
  const originalListCommentReactions = clientPrototype.listCommentReactions;
  const originalAddCommentReaction = clientPrototype.addCommentReaction;
  const read = deferred<ReviewReaction[]>();
  const order: string[] = [];
  let addCalls = 0;
  clientPrototype.loadMergeRequest = () => Promise.resolve(cloneReview(baseReview()));
  clientPrototype.listCommentReactions = () => {
    order.push("read-start");
    return read.promise;
  };
  clientPrototype.addCommentReaction = () => {
    order.push("toggle-add");
    addCalls += 1;
    return Promise.resolve({
      name: "thumbsup",
      count: 1,
      users: [{ id: "user-1", name: "you" }],
      currentUserAwardId: "award-1"
    });
  };

  try {
    const store = new ReviewStore(createTestContext(baseReview(), INSTANCE_A) as never, () => INSTANCE_A);
    await store.refresh();
    const renderedContext = store.getReviewContext();
    assert.ok(renderedContext);

    const readPromise = store.loadCommentReactions("thread-1", "comment-1");
    await flushMicrotasks();
    assert.deepEqual(order, ["read-start"]);
    const togglePromise = store.toggleCommentReaction("thread-1", "comment-1", ":thumbsup:", renderedContext);
    await flushMicrotasks();
    assert.equal(addCalls, 0);

    order.push("read-resolve");
    read.resolve([{ name: "thumbsup", count: 0, users: [] }]);
    await readPromise;
    const result = await togglePromise;
    const comment = store.getThreadDetails(["thread-1"])[0]?.comments[0];

    assert.equal(result.ok, true);
    assert.equal(addCalls, 1);
    assert.deepEqual(order, ["read-start", "read-resolve", "toggle-add"]);
    assert.equal(comment?.reactions?.[0]?.name, "thumbsup");
    assert.equal(comment?.reactions?.[0]?.count, 1);
    assert.equal(comment?.reactions?.[0]?.currentUserAwardId, "award-1");
    assert.equal(comment?.reactions?.[0]?.pending, false);
  } finally {
    clientPrototype.loadMergeRequest = originalLoadMergeRequest;
    clientPrototype.listCommentReactions = originalListCommentReactions;
    clientPrototype.addCommentReaction = originalAddCommentReaction;
  }
});

async function loadReviewModules(): Promise<{
  ReviewStore: typeof import("../reviewStore").ReviewStore;
  GitLabReviewClient: typeof import("../gitlabApi").GitLabReviewClient;
}> {
  const vscodeStub = {
    EventEmitter: TestEventEmitter,
    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback })
    },
    window: {
      showInformationMessage: async () => undefined
    }
  };
  const moduleLoader = require("node:module") as {
    _load: (request: string, parent: unknown, isMain?: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = (request, parent, isMain) => request === "vscode"
    ? vscodeStub
    : originalLoad(request, parent, isMain);
  try {
    const storeModule = await import("../reviewStore.js");
    const apiModule = await import("../gitlabApi.js");
    return { ReviewStore: storeModule.ReviewStore, GitLabReviewClient: apiModule.GitLabReviewClient };
  } finally {
    moduleLoader._load = originalLoad;
  }
}

function createTestContext(review: ReviewState, instanceUrl: string): {
  workspaceState: {
    get<T>(key: string, fallback?: T): T | undefined;
    update(key: string, value: unknown): Promise<void>;
  };
} {
  const values = new Map<string, unknown>([
    [storageKey(instanceUrl, "gitlabReview.selectedMergeRequest"), { projectId: review.projectId, iid: review.mergeRequestIid }],
    [storageKey(instanceUrl, "gitlabReview.cache.reviewState.v2"), review]
  ]);
  return {
    workspaceState: {
      get<T>(key: string, fallback?: T): T | undefined {
        return values.has(key) ? values.get(key) as T : fallback;
      },
      async update(key: string, value: unknown): Promise<void> {
        values.set(key, value);
      }
    }
  };
}

function storageKey(instanceUrl: string, key: string): string {
  return `gitlabReview.instance.${encodeURIComponent(instanceUrl)}.${key}`;
}

function baseReview(): ReviewState {
  return {
    id: "group/project!1",
    instanceUrl: INSTANCE_A,
    projectPath: "group/project",
    projectId: "group/project",
    mergeRequestIid: 1,
    currentUserId: "user-1",
    title: "Test merge request",
    state: "opened",
    sourceBranch: "feature/test",
    targetBranch: "main",
    author: "author",
    reviewers: [],
    commits: [],
    diffRefs: { baseSha: "base-a", startSha: "start-a", headSha: "head-a" },
    files: [reviewFile()],
    threads: [reviewThread()],
    draftNotes: []
  };
}

function reviewFile(): ReviewFile {
  return {
    path: "src/file.ts",
    language: "typescript",
    oldPath: "src/file.ts",
    newPath: "src/file.ts",
    patch: "@@ -1 +1 @@\n-old\n+new",
    status: "modified",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    collapsed: false,
    tooLarge: false,
    generatedFile: false,
    additions: 1,
    deletions: 1
  };
}

function reviewThread(): ReviewThread {
  return {
    id: "thread-1",
    filePath: "src/file.ts",
    line: 1,
    oldLine: 1,
    newLine: 1,
    positionHeadSha: "head-a",
    resolved: false,
    resolvable: true,
    pending: false,
    comments: [{
      id: "comment-1",
      author: "reviewer",
      authorId: "reviewer-1",
      body: "Original comment",
      createdAt: "2026-09-05T00:00:00.000Z",
      canEdit: false,
      pending: false
    }]
  };
}

function confirmedReply(): ReviewComment {
  return {
    id: "comment-2",
    author: "you",
    authorId: "user-1",
    body: "Reply",
    createdAt: "2026-09-05T00:01:00.000Z",
    canEdit: true,
    pending: false
  };
}

function confirmedThread(): ReviewThread {
  return {
    ...reviewThread(),
    id: "thread-2",
    comments: [{
      id: "comment-3",
      author: "you",
      authorId: "user-1",
      body: "Thread from an old view",
      createdAt: "2026-09-05T00:02:00.000Z",
      canEdit: true,
      pending: false
    }]
  };
}

function cloneReview(review: ReviewState): ReviewState {
  return JSON.parse(JSON.stringify(review)) as ReviewState;
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

class TestEventEmitter<T = void> {
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
