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
    "gitlabReview.cache.myWork.candidates": [cachedCandidate]
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
  workspaceState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void>;
  };
} {
  const values = new Map(Object.entries(initial));
  return {
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
