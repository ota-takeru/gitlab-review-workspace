import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { GitLabReviewClient } from "./gitlabApi";
import { getGitLabHostname } from "./glabAuthUtils";
import { normalizeGitLabRemoteUrl } from "./localGitUtils";
import { applyMyWorkSourceResults, bucketMyWorkItems, comparisonHasChanges, dedupeMyWorkItems, selectCandidateBranches, type MyWorkSourceCache } from "./myWorkService";
import { emptyMyWorkState, type MyWorkItem, type MyWorkMergeRequestCandidate, type MyWorkSource, type MyWorkSourceItem, type MyWorkState } from "./myWorkTypes";

const execFileAsync = promisify(execFile);
const SOURCES: readonly Exclude<MyWorkSource, "candidates">[] = ["todo", "assigned_to_me", "reviews_for_me", "created_by_me"];
const CACHE_PREFIX = "gitlabReview.cache.myWork.";

export class MyWorkStore implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly sourceCache: MyWorkSourceCache;
  private candidateCache: MyWorkMergeRequestCandidate[];
  private state: MyWorkState;
  private disposed = false;
  private refreshPromise?: Promise<void>;

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly baseUrlProvider: () => string = () =>
      vscode.workspace.getConfiguration("gitlabReview").get<string>("gitlabBaseUrl", "https://gitlab.com")
  ) {
    this.sourceCache = Object.fromEntries(SOURCES.map((source) => [source,
      this.context.workspaceState.get<MyWorkSourceItem[]>(`${CACHE_PREFIX}${source}`) ?? []
    ])) as MyWorkSourceCache;
    this.candidateCache = this.context.workspaceState.get<MyWorkMergeRequestCandidate[]>(`${CACHE_PREFIX}candidates`) ?? [];
    const items = [...dedupeMyWorkItems(Object.values(this.sourceCache).flat()), ...this.candidateCache];
    this.state = items.length ? toState("ready", items, [], this.context.workspaceState.get<string>(`${CACHE_PREFIX}lastSuccessfulAt`)) : emptyMyWorkState;
  }

  getState(): MyWorkState {
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
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<void> {
    this.state = toState("loading", allCachedItems(this.sourceCache, this.candidateCache), [], this.state.lastSuccessfulAt);
    this.onDidChangeEmitter.fire();
    const client = this.getClient();
    const requests: Record<Exclude<MyWorkSource, "candidates">, Promise<MyWorkSourceItem[]>> = {
      todo: client.listMyWorkTodos(),
      assigned_to_me: client.listMyWorkMergeRequests("assigned_to_me"),
      reviews_for_me: client.listMyWorkMergeRequests("reviews_for_me"),
      created_by_me: client.listMyWorkMergeRequests("created_by_me")
    };
    const candidateRequest = settle(this.refreshCandidates(client));
    const results = await Promise.all(SOURCES.map(async (source) => ({ source, result: await settle(requests[source]) })));
    const sourceUpdate = applyMyWorkSourceResults(this.sourceCache, results);
    await Promise.all(sourceUpdate.updatedSources.map((source) => this.persist(`${CACHE_PREFIX}${source}`, this.sourceCache[source])));

    const candidateResult = await candidateRequest;
    if (candidateResult.ok) {
      this.candidateCache = candidateResult.value;
      await this.persist(`${CACHE_PREFIX}candidates`, this.candidateCache);
    }
    const failedSources: MyWorkSource[] = [...sourceUpdate.failures, ...(candidateResult.ok ? [] : ["candidates" as const])];
    const items = allCachedItems(this.sourceCache, this.candidateCache);
    const allPrimarySourcesFailed = sourceUpdate.failures.length === SOURCES.length;
    const phase = failedSources.length
      ? (allPrimarySourcesFailed && items.length === 0 ? "error" : "partial")
      : "ready";
    const lastSuccessfulAt = failedSources.length === 0 ? new Date().toISOString() : this.state.lastSuccessfulAt;
    if (lastSuccessfulAt && failedSources.length === 0) await this.persist(`${CACHE_PREFIX}lastSuccessfulAt`, lastSuccessfulAt);
    this.state = toState(phase, items, failedSources, lastSuccessfulAt);
    if (!this.disposed) this.onDidChangeEmitter.fire();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDidChangeEmitter.dispose();
  }

  private getClient(): GitLabReviewClient {
    const baseUrl = this.baseUrlProvider();
    return new GitLabReviewClient(getGitLabHostname(baseUrl) ?? "gitlab.com");
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

  private async persist(key: string, value: unknown): Promise<void> {
    await Promise.resolve(this.context.workspaceState.update(key, value)).catch(() => undefined);
  }
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
