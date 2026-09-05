import assert from "node:assert/strict";
import test from "node:test";
import { applyMyWorkSourceResults, type MyWorkSourceCache } from "../myWorkService";
import type { MyWorkMergeRequestCandidate, MyWorkSource, MyWorkSourceItem, MyWorkState } from "../myWorkTypes";

const item: MyWorkSourceItem = {
  projectId: "1", projectPath: "group/project", iid: 1, title: "Cached", state: "opened",
  sourceBranch: "feature", targetBranch: "main", author: "me", reviewers: [], draft: false,
  roles: [], attentionReasons: ["todo"], hasPendingTodo: true
};

test("applyMyWorkSourceResults preserves a failed source cache while updating successful sources", () => {
  const cache: MyWorkSourceCache = {
    todo: [item],
    assigned_to_me: [],
    reviews_for_me: [],
    created_by_me: []
  };
  const result = applyMyWorkSourceResults(cache, [
    { source: "todo", result: { ok: false } },
    { source: "assigned_to_me", result: { ok: true, value: [{ ...item, iid: 2, roles: ["assignee"], attentionReasons: [] }] } }
  ]);
  assert.deepEqual(cache.todo, [item]);
  assert.equal(cache.assigned_to_me[0]?.iid, 2);
  assert.deepEqual(result.failures, ["todo"]);
  assert.deepEqual(result.updatedSources, ["assigned_to_me"]);
});

test("My Work emits primary results while candidate discovery is still pending", async () => {
  const { MyWorkStore, GitLabReviewClient } = await loadMyWorkModules();
  const candidate = deferred<MyWorkMergeRequestCandidate[]>();
  let candidateFinished = false;
  void candidate.promise.then(() => { candidateFinished = true; });
  const cachedCandidate = candidateItem("cached-candidate");
  const freshCandidate = candidateItem("fresh-candidate");
  const context = createTestContext({
    [myWorkCacheKey("https://gitlab.com", "candidates")]: [cachedCandidate]
  });
  const storePrototype = MyWorkStore.prototype as unknown as Record<string, unknown>;
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalRefreshCandidates = storePrototype.refreshCandidates;
  const originalListMyWorkTodos = clientPrototype.listMyWorkTodos;
  const originalListMyWorkMergeRequests = clientPrototype.listMyWorkMergeRequests;
  storePrototype.refreshCandidates = () => candidate.promise;
  clientPrototype.listMyWorkTodos = () => Promise.resolve([sourceItem("todo")]);
  clientPrototype.listMyWorkMergeRequests = (source: MyWorkSource) => Promise.resolve([sourceItem(source)]);

  try {
    const store = new MyWorkStore(context as never, () => "https://gitlab.com");
    const states: MyWorkState[] = [];
    let resolvePrimaryState!: () => void;
    const primaryState = new Promise<void>((resolve) => { resolvePrimaryState = resolve; });
    store.onDidChange(() => {
      states.push(store.getState());
      if (states.length === 2) resolvePrimaryState();
    });

    const refreshPromise = store.refresh();
    await primaryState;

    assert.equal(candidateFinished, false);
    assert.equal(states[0]?.phase, "loading");
    assert.equal(states[1]?.phase, "loading");
    assert.equal(states[1]?.buckets.active.some((item) => item.kind === "mr-candidate" && item.key === cachedCandidate.key), true);
    assert.deepEqual(
      states[1]?.buckets.waiting
        .filter((item): item is Extract<MyWorkState["buckets"]["waiting"][number], { kind: "merge-request" }> => item.kind === "merge-request")
        .map((item) => item.title)
        .sort(),
      ["assigned_to_me", "created_by_me", "reviews_for_me", "todo"]
    );

    candidate.resolve([freshCandidate]);
    await refreshPromise;

    const finalState = store.getState();
    assert.equal(finalState.phase, "ready");
    assert.equal(finalState.buckets.active.some((item) => item.kind === "mr-candidate" && item.key === freshCandidate.key), true);
    assert.equal(finalState.buckets.active.some((item) => item.kind === "mr-candidate" && item.key === cachedCandidate.key), false);
    store.dispose();
  } finally {
    storePrototype.refreshCandidates = originalRefreshCandidates;
    clientPrototype.listMyWorkTodos = originalListMyWorkTodos;
    clientPrototype.listMyWorkMergeRequests = originalListMyWorkMergeRequests;
  }
});

test("My Work preserves the error phase when every primary source fails and no items are cached", async () => {
  const state = await runMyWorkScenario({
    primaryFailure: true,
    candidateResult: []
  });

  assert.equal(state.phase, "error");
  assert.deepEqual(state.failedSources, ["todo", "assigned_to_me", "reviews_for_me", "created_by_me"]);
  assert.deepEqual(state.buckets, { attention: [], active: [], waiting: [] });
});

test("My Work preserves a partial phase when candidate discovery fails", async () => {
  const state = await runMyWorkScenario({
    candidateFailure: true,
    primaryResult: []
  });

  assert.equal(state.phase, "partial");
  assert.deepEqual(state.failedSources, ["candidates"]);
  assert.deepEqual(state.buckets, { attention: [], active: [], waiting: [] });
});

test("My Work keeps an empty successful refresh ready", async () => {
  const state = await runMyWorkScenario({
    candidateResult: [],
    primaryResult: []
  });

  assert.equal(state.phase, "ready");
  assert.deepEqual(state.failedSources, []);
  assert.deepEqual(state.buckets, { attention: [], active: [], waiting: [] });
});

test("My Work only loads the cache for the canonical GitLab instance", async () => {
  const { MyWorkStore } = await loadMyWorkModules();
  const hostA = "https://gitlab.example.test/gitlab";
  const hostB = "https://gitlab.example.test/other";
  const cachedA = sourceItem("host-a");
  const cachedB = sourceItem("host-b");
  const context = createTestContext({
    [myWorkCacheKey(hostA, "todo")]: [cachedA],
    [myWorkCacheKey(hostB, "todo")]: [cachedB],
    [myWorkCacheKey(hostA, "lastSuccessfulAt")]: "2026-09-05T00:00:00.000Z",
    "gitlabReview.cache.myWork.todo": [sourceItem("ambiguous-old-cache")]
  });

  const storeA = new MyWorkStore(context as never, () => `${hostA}/`);
  assert.equal(storeA.getState().buckets.waiting.some((entry) => entry.kind === "merge-request" && entry.title === "host-a"), true);
  assert.equal(storeA.getState().lastSuccessfulAt, "2026-09-05T00:00:00.000Z");

  const storeB = new MyWorkStore(context as never, () => hostB);
  assert.equal(storeB.getState().buckets.waiting.some((entry) => entry.kind === "merge-request" && entry.title === "host-b"), true);
  assert.equal(storeB.getState().buckets.waiting.some((entry) => entry.kind === "merge-request" && entry.title === "host-a"), false);
  assert.equal(storeB.getState().buckets.waiting.some((entry) => entry.kind === "merge-request" && entry.title === "ambiguous-old-cache"), false);

  storeA.dispose();
  storeB.dispose();
});

test("My Work reports an invalid instance without making network requests", async () => {
  const { MyWorkStore, GitLabReviewClient } = await loadMyWorkModules();
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalListMyWorkTodos = clientPrototype.listMyWorkTodos;
  const originalListMyWorkMergeRequests = clientPrototype.listMyWorkMergeRequests;
  let requestCount = 0;
  clientPrototype.listMyWorkTodos = () => { requestCount += 1; return Promise.resolve([]); };
  clientPrototype.listMyWorkMergeRequests = () => { requestCount += 1; return Promise.resolve([]); };

  try {
    const store = new MyWorkStore(createTestContext() as never, () => "not a GitLab URL");
    await store.refresh();
    const state = store.getState();
    assert.equal(state.phase, "error");
    assert.deepEqual(state.failedSources, ["todo", "assigned_to_me", "reviews_for_me", "created_by_me", "candidates"]);
    assert.equal(requestCount, 0);
    store.dispose();
  } finally {
    clientPrototype.listMyWorkTodos = originalListMyWorkTodos;
    clientPrototype.listMyWorkMergeRequests = originalListMyWorkMergeRequests;
  }
});

test("My Work discards a refresh that belongs to a previous GitLab instance", async () => {
  const { MyWorkStore, GitLabReviewClient } = await loadMyWorkModules();
  const hostAName = "a.gitlab.example.test";
  const hostBName = "b.gitlab.example.test";
  const hostA = `https://${hostAName}`;
  const hostB = `https://${hostBName}`;
  const primaryByHost = new Map<string, ReturnType<typeof deferred<MyWorkSourceItem[]>>>();
  const candidateByHost = new Map<string, ReturnType<typeof deferred<MyWorkMergeRequestCandidate[]>>>();
  const storePrototype = MyWorkStore.prototype as unknown as Record<string, unknown>;
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalRefreshCandidates = storePrototype.refreshCandidates;
  const originalListMyWorkTodos = clientPrototype.listMyWorkTodos;
  const originalListMyWorkMergeRequests = clientPrototype.listMyWorkMergeRequests;
  const getPrimary = (host: string) => {
    let value = primaryByHost.get(host);
    if (!value) {
      value = deferred<MyWorkSourceItem[]>();
      primaryByHost.set(host, value);
    }
    return value;
  };
  const getCandidates = (host: string) => {
    let value = candidateByHost.get(host);
    if (!value) {
      value = deferred<MyWorkMergeRequestCandidate[]>();
      candidateByHost.set(host, value);
    }
    return value;
  };
  clientPrototype.listMyWorkTodos = function(this: { getHostname(): string }) { return getPrimary(this.getHostname()).promise; };
  clientPrototype.listMyWorkMergeRequests = function(this: { getHostname(): string }) { return getPrimary(this.getHostname()).promise; };
  storePrototype.refreshCandidates = function(this: { }, client: { getHostname(): string }) {
    return getCandidates(client.getHostname()).promise;
  };

  try {
    let currentHost = hostA;
    const context = createTestContext();
    const store = new MyWorkStore(context as never, () => currentHost);
    const firstRefresh = store.refresh();
    assert.strictEqual(store.refresh(), firstRefresh);

    currentHost = `${hostB}/`;
    store.resetConnection();
    assert.deepEqual(store.getState().buckets, { attention: [], active: [], waiting: [] });

    const secondRefresh = store.refresh();
    assert.notStrictEqual(secondRefresh, firstRefresh);
    getPrimary(hostBName).resolve([sourceItem("host-b-result")]);
    getCandidates(hostBName).resolve([]);
    await secondRefresh;
    assert.equal(store.getState().buckets.waiting.some((entry) => entry.kind === "merge-request" && entry.title === "host-b-result"), true);

    getPrimary(hostAName).resolve([sourceItem("stale-host-a-result")]);
    getCandidates(hostAName).resolve([]);
    await firstRefresh;
    const finalState = store.getState();
    assert.equal(finalState.buckets.waiting.some((entry) => entry.kind === "merge-request" && entry.title === "stale-host-a-result"), false);
    assert.equal(finalState.buckets.waiting.some((entry) => entry.kind === "merge-request" && entry.title === "host-b-result"), true);
    assert.equal(context.values.has(myWorkCacheKey(hostB, "todo")), true);
    assert.equal(context.values.has(myWorkCacheKey(hostB, "lastSuccessfulAt")), true);
    assert.equal([...context.values.keys()].some((key) => key.includes(encodeURIComponent(hostA))), false);
    store.dispose();
  } finally {
    storePrototype.refreshCandidates = originalRefreshCandidates;
    clientPrototype.listMyWorkTodos = originalListMyWorkTodos;
    clientPrototype.listMyWorkMergeRequests = originalListMyWorkMergeRequests;
  }
});

async function loadMyWorkModules(): Promise<{
  MyWorkStore: typeof import("../myWorkStore").MyWorkStore;
  GitLabReviewClient: typeof import("../gitlabApi").GitLabReviewClient;
}> {
  const vscodeStub = {
    EventEmitter: TestEventEmitter,
    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback })
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
    const storeModule = await import("../myWorkStore.js");
    const apiModule = await import("../gitlabApi.js");
    return { MyWorkStore: storeModule.MyWorkStore, GitLabReviewClient: apiModule.GitLabReviewClient };
  } finally {
    moduleLoader._load = originalLoad;
  }
}

async function runMyWorkScenario(options: {
  primaryFailure?: boolean;
  primaryResult?: MyWorkSourceItem[];
  candidateFailure?: boolean;
  candidateResult?: MyWorkMergeRequestCandidate[];
}): Promise<MyWorkState> {
  const { MyWorkStore, GitLabReviewClient } = await loadMyWorkModules();
  const storePrototype = MyWorkStore.prototype as unknown as Record<string, unknown>;
  const clientPrototype = GitLabReviewClient.prototype as unknown as Record<string, unknown>;
  const originalRefreshCandidates = storePrototype.refreshCandidates;
  const originalListMyWorkTodos = clientPrototype.listMyWorkTodos;
  const originalListMyWorkMergeRequests = clientPrototype.listMyWorkMergeRequests;
  const candidatePromise = options.candidateFailure
    ? Promise.reject<MyWorkMergeRequestCandidate[]>(new Error("candidate lookup failed"))
    : Promise.resolve(options.candidateResult ?? []);
  const primaryPromise = options.primaryFailure
    ? Promise.reject<MyWorkSourceItem[]>(new Error("primary lookup failed"))
    : Promise.resolve(options.primaryResult ?? []);
  storePrototype.refreshCandidates = () => candidatePromise;
  clientPrototype.listMyWorkTodos = () => primaryPromise;
  clientPrototype.listMyWorkMergeRequests = () => primaryPromise;

  try {
    const store = new MyWorkStore(createTestContext() as never, () => "https://gitlab.com");
    await store.refresh();
    const state = store.getState();
    store.dispose();
    return state;
  } finally {
    storePrototype.refreshCandidates = originalRefreshCandidates;
    clientPrototype.listMyWorkTodos = originalListMyWorkTodos;
    clientPrototype.listMyWorkMergeRequests = originalListMyWorkMergeRequests;
  }
}

function createTestContext(initial: Record<string, unknown> = {}): {
  values: Map<string, unknown>;
  workspaceState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void>;
  };
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    workspaceState: {
      get<T>(key: string): T | undefined { return values.get(key) as T | undefined; },
      async update(key: string, value: unknown): Promise<void> { values.set(key, value); }
    }
  };
}

function sourceItem(source: string): MyWorkSourceItem {
  return {
    ...item,
    projectId: `project-${source}`,
    title: source,
    roles: [],
    attentionReasons: [],
    hasPendingTodo: false
  };
}

function candidateItem(key: string): MyWorkMergeRequestCandidate {
  return {
    kind: "mr-candidate",
    key,
    sourceProjectId: "source-project",
    sourceProjectPath: "group/source-project",
    targetProjectId: "target-project",
    targetProjectPath: "group/target-project",
    sourceBranch: `feature/${key}`,
    targetBranch: "main",
    commitCount: 1,
    bucket: "active"
  };
}

function myWorkCacheKey(instanceUrl: string, suffix: string): string {
  return `gitlabReview.cache.myWork.${encodeURIComponent(instanceUrl)}.${suffix}`;
}

class TestEventEmitter {
  private readonly listeners = new Set<(value?: unknown) => void>();
  readonly event = (listener: (value?: unknown) => void): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value?: unknown): void {
    for (const listener of this.listeners) listener(value);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}
