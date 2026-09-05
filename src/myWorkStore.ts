import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { GitLabReviewClient } from "./gitlabApi";
import { getGitLabHostname } from "./glabAuthUtils";
import { normalizeGitLabRemoteUrl } from "./localGitUtils";
import { applyMyWorkSourceResults, bucketMyWorkItems, comparisonHasChanges, dedupeMyWorkItems, selectCandidateBranches, type MyWorkSourceCache } from "./myWorkService";
import { emptyMyWorkState, type MyWorkItem, type MyWorkMergeRequestCandidate, type MyWorkSource, type MyWorkSourceItem, type MyWorkState } from "./myWorkTypes";
import { normalizeInstanceUrl } from "./reviewContext";

const execFileAsync = promisify(execFile);
const SOURCES: readonly Exclude<MyWorkSource, "candidates">[] = ["todo", "assigned_to_me", "reviews_for_me", "created_by_me"];
const ALL_SOURCES: readonly MyWorkSource[] = [...SOURCES, "candidates"];
const CACHE_PREFIX = "gitlabReview.cache.myWork.";

export class MyWorkStore implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private sourceCache: MyWorkSourceCache = emptySourceCache();
  private candidateCache: MyWorkMergeRequestCandidate[] = [];
  private state: MyWorkState;
  private disposed = false;
  private connection?: MyWorkConnection;
  private connectionGeneration = 0;
  private refreshPromise?: {
    instanceUrl: string;
    generation: number;
    promise: Promise<void>;
  };

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly baseUrlProvider: () => string = () =>
      vscode.workspace.getConfiguration("gitlabReview").get<string>("gitlabBaseUrl", "https://gitlab.com")
  ) {
    this.state = emptyMyWorkState;
    this.resetConnection();
  }

  getState(): MyWorkState {
    this.ensureConnectionScope();
    return {
      ...this.state,
      buckets: {
        attention: this.state.buckets.attention.map(cloneItem),
        active: this.state.buckets.active.map(cloneItem),
        waiting: this.state.buckets.waiting.map(cloneItem)
      },
      failedSources: [...this.state.failedSources]
    };
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const instanceUrl = this.ensureConnectionScope();
    if (!instanceUrl) return Promise.resolve();

    if (this.refreshPromise
      && this.refreshPromise.instanceUrl === instanceUrl
      && this.refreshPromise.generation === this.connectionGeneration) {
      return this.refreshPromise.promise;
    }

    const generation = this.connectionGeneration;
    const promise = this.performRefresh(instanceUrl, generation).finally(() => {
      if (this.refreshPromise?.promise === promise) this.refreshPromise = undefined;
    });
    this.refreshPromise = { instanceUrl, generation, promise };
    return promise;
  }

  /** Rebind My Work to the currently configured GitLab instance, if it changed. */
  resetConnection(): void {
    this.ensureConnectionScope();
  }

  private async performRefresh(instanceUrl: string, generation: number): Promise<void> {
    if (!this.isCurrentRefresh(instanceUrl, generation)) return;
    this.state = toState("loading", allCachedItems(this.sourceCache, this.candidateCache), [], this.state.lastSuccessfulAt);
    this.onDidChangeEmitter.fire();
    if (!this.isCurrentRefresh(instanceUrl, generation)) return;
    const client = this.getClient(instanceUrl);
    const requests: Record<Exclude<MyWorkSource, "candidates">, Promise<MyWorkSourceItem[]>> = {
      todo: client.listMyWorkTodos(),
      assigned_to_me: client.listMyWorkMergeRequests("assigned_to_me"),
      reviews_for_me: client.listMyWorkMergeRequests("reviews_for_me"),
      created_by_me: client.listMyWorkMergeRequests("created_by_me")
    };
    const candidateRequest = settle(this.refreshCandidates(client));
    const results = await Promise.all(SOURCES.map(async (source) => ({ source, result: await settle(requests[source]) })));
    if (!this.isCurrentRefresh(instanceUrl, generation)) return;
    const sourceUpdate = applyMyWorkSourceResults(this.sourceCache, results);
    await Promise.all(sourceUpdate.updatedSources.map((source) =>
      this.persistScoped(instanceUrl, generation, source, this.sourceCache[source])
    ));
    if (!this.isCurrentRefresh(instanceUrl, generation)) return;

    // Primary work is useful as soon as the four source requests finish. Keep
    // candidate discovery inside this refresh, but do not make the first
    // usable My Work state wait for the comparatively expensive fork scan.
    this.state = toState("loading", allCachedItems(this.sourceCache, this.candidateCache), [], this.state.lastSuccessfulAt);
    if (!this.disposed) this.onDidChangeEmitter.fire();

    const candidateResult = await candidateRequest;
    if (!this.isCurrentRefresh(instanceUrl, generation)) return;
    if (candidateResult.ok) {
      this.candidateCache = candidateResult.value;
      await this.persistScoped(instanceUrl, generation, "candidates", this.candidateCache);
    }
    if (!this.isCurrentRefresh(instanceUrl, generation)) return;
    const failedSources: MyWorkSource[] = [...sourceUpdate.failures, ...(candidateResult.ok ? [] : ["candidates" as const])];
    const items = allCachedItems(this.sourceCache, this.candidateCache);
    const allPrimarySourcesFailed = sourceUpdate.failures.length === SOURCES.length;
    const phase = failedSources.length
      ? (allPrimarySourcesFailed && items.length === 0 ? "error" : "partial")
      : "ready";
    const lastSuccessfulAt = failedSources.length === 0 ? new Date().toISOString() : this.state.lastSuccessfulAt;
    if (lastSuccessfulAt && failedSources.length === 0) {
      await this.persistScoped(instanceUrl, generation, "lastSuccessfulAt", lastSuccessfulAt);
    }
    if (!this.isCurrentRefresh(instanceUrl, generation)) return;
    this.state = toState(phase, items, failedSources, lastSuccessfulAt);
    if (!this.disposed) this.onDidChangeEmitter.fire();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connectionGeneration += 1;
    this.refreshPromise = undefined;
    this.onDidChangeEmitter.dispose();
  }

  private ensureConnectionScope(): string | undefined {
    const next = resolveConnection(this.baseUrlProvider);
    if (this.connection?.signature === next.signature) return this.connection.instanceUrl;

    this.connection = next;
    this.connectionGeneration += 1;
    this.refreshPromise = undefined;
    this.sourceCache = emptySourceCache();
    this.candidateCache = [];

    if (next.instanceUrl) {
      this.sourceCache = loadSourceCache(this.context, next.instanceUrl);
      this.candidateCache = readCache(this.context, cacheKey(next.instanceUrl, "candidates"), [] as MyWorkMergeRequestCandidate[]);
      const items = allCachedItems(this.sourceCache, this.candidateCache);
      const lastSuccessfulAt = readCache(this.context, cacheKey(next.instanceUrl, "lastSuccessfulAt"), undefined as string | undefined);
      this.state = items.length ? toState("ready", items, [], lastSuccessfulAt) : emptyMyWorkState;
    } else {
      this.state = unavailableState();
    }
    this.onDidChangeEmitter.fire();
    return next.instanceUrl;
  }

  private isCurrentRefresh(instanceUrl: string, generation: number): boolean {
    return !this.disposed
      && this.ensureConnectionScope() === instanceUrl
      && this.connectionGeneration === generation;
  }

  private getClient(instanceUrl: string): GitLabReviewClient {
    const hostname = getGitLabHostname(instanceUrl);
    if (!hostname) throw new Error("Invalid GitLab instance URL.");
    return new GitLabReviewClient(hostname);
  }

  private async refreshCandidates(client: GitLabReviewClient): Promise<MyWorkMergeRequestCandidate[]> {
    const root = vscode.workspace.workspaceFolders?.length === 1 ? vscode.workspace.workspaceFolders[0]?.uri.fsPath : undefined;
    if (!root) return [];
    let originUrl: string;
    try {
      originUrl = await runGit(["remote", "get-url", "origin"], root);
    } catch {
      return [];
    }
    const originRemote = normalizeGitLabRemoteUrl(originUrl.trim());
    if (!originRemote || originRemote.hostname !== client.getHostname()) return [];

    const sourceProject = await client.getProject(originRemote.projectPath);
    const fork = sourceProject.forked_from_project;
    if (!fork?.id) return [];
    const targetProjectId = String(fork.id);
    const targetProject = await client.getProject(targetProjectId);
    if (!targetProject.default_branch) return [];
    const sourceProjectId = String(sourceProject.id);
    const [branches, openMergeRequests] = await Promise.all([
      client.listProjectBranches(sourceProjectId),
      client.listProjectOpenMergeRequests(targetProjectId)
    ]);
    const selected = selectCandidateBranches(
      branches.flatMap((branch) => branch.name ? [{ name: branch.name, updatedAt: branch.commit?.committed_date ?? branch.commit?.created_at }] : []),
      sourceProject.default_branch,
      openMergeRequests.map((mergeRequest) => ({
        sourceProjectId: mergeRequest.source_project_id === undefined ? undefined : String(mergeRequest.source_project_id),
        sourceBranch: mergeRequest.source_branch,
        targetProjectId: mergeRequest.target_project_id === undefined ? undefined : String(mergeRequest.target_project_id)
      })),
      sourceProjectId,
      targetProjectId
    );
    const compared = await mapWithConcurrency(selected, 4, async (branch) => ({
      branch,
      comparison: await client.compareProjectBranches(sourceProjectId, targetProject.default_branch!, branch.name, targetProjectId)
    }));
    return compared.filter(({ comparison }) => comparisonHasChanges(comparison)).map(({ branch, comparison }) => ({
      kind: "mr-candidate" as const,
      key: `${sourceProjectId}:${branch.name}->${targetProjectId}:${targetProject.default_branch}`,
      sourceProjectId,
      sourceProjectPath: sourceProject.path_with_namespace ?? originRemote.projectPath,
      targetProjectId,
      targetProjectPath: targetProject.path_with_namespace ?? String(targetProjectId),
      sourceBranch: branch.name,
      targetBranch: targetProject.default_branch!,
      commitCount: comparison.commits?.length ?? 0,
      updatedAt: branch.updatedAt,
      bucket: "active" as const
    }));
  }

  private async persistScoped(instanceUrl: string, generation: number, suffix: MyWorkCacheSuffix, value: unknown): Promise<void> {
    if (!this.isCurrentRefresh(instanceUrl, generation)) return;
    await Promise.resolve(this.context.workspaceState.update(cacheKey(instanceUrl, suffix), value)).catch(() => undefined);
  }
}

type MyWorkCacheSuffix = MyWorkSource | "lastSuccessfulAt";

interface MyWorkConnection {
  signature: string;
  instanceUrl?: string;
}

function resolveConnection(baseUrlProvider: () => string): MyWorkConnection {
  let rawBaseUrl = "";
  try {
    rawBaseUrl = baseUrlProvider().trim();
    const instanceUrl = normalizeInstanceUrl(rawBaseUrl);
    if (!getGitLabHostname(instanceUrl)) throw new Error("Invalid GitLab instance URL.");
    return { signature: `valid:${instanceUrl}`, instanceUrl };
  } catch {
    return { signature: `invalid:${rawBaseUrl}` };
  }
}

function cacheKey(instanceUrl: string, suffix: MyWorkCacheSuffix): string {
  return `${CACHE_PREFIX}${encodeURIComponent(instanceUrl)}.${suffix}`;
}

function loadSourceCache(context: vscode.ExtensionContext, instanceUrl: string): MyWorkSourceCache {
  return Object.fromEntries(SOURCES.map((source) => [source,
    readCache(context, cacheKey(instanceUrl, source), [] as MyWorkSourceItem[])
  ])) as MyWorkSourceCache;
}

function emptySourceCache(): MyWorkSourceCache {
  return Object.fromEntries(SOURCES.map((source) => [source, []])) as unknown as MyWorkSourceCache;
}

function readCache<T>(context: vscode.ExtensionContext, key: string, fallback: T): T {
  return context.workspaceState.get<T>(key) ?? fallback;
}

function unavailableState(): MyWorkState {
  return { ...emptyMyWorkState, phase: "error", failedSources: [...ALL_SOURCES] };
}

function allCachedItems(sourceCache: MyWorkSourceCache, candidates: readonly MyWorkMergeRequestCandidate[]): MyWorkItem[] {
  return [...dedupeMyWorkItems(Object.values(sourceCache).flat()), ...candidates];
}

function toState(phase: MyWorkState["phase"], items: readonly MyWorkItem[], failedSources: MyWorkSource[], lastSuccessfulAt?: string): MyWorkState {
  const mergeRequests = items.filter((item): item is Extract<MyWorkItem, { kind: "merge-request" }> => item.kind === "merge-request");
  const candidates = items.filter((item): item is Extract<MyWorkItem, { kind: "mr-candidate" }> => item.kind === "mr-candidate");
  const buckets = bucketMyWorkItems(mergeRequests, candidates);
  return { phase, buckets, attentionCount: buckets.attention.length, ...(lastSuccessfulAt ? { lastSuccessfulAt } : {}), failedSources };
}

function cloneItem(item: MyWorkItem): MyWorkItem {
  return item.kind === "merge-request"
    ? { ...item, reviewers: [...(item.reviewers ?? [])], roles: [...item.roles], attentionReasons: [...item.attentionReasons] }
    : { ...item };
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return (await execFileAsync("git", args, { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 })).stdout;
}

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try { return { ok: true, value: await promise }; } catch { return { ok: false }; }
}

async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}
