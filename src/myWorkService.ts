import type {
  MyWorkAttentionReason,
  MyWorkBucket,
  MyWorkItem,
  MyWorkMergeRequest,
  MyWorkRole,
  MyWorkSource,
  MyWorkSourceItem
} from "./myWorkTypes";
import type { ReviewUser } from "./reviewTypes";

export function classifyMyWorkItem(item: Pick<MyWorkSourceItem, "hasPendingTodo" | "roles" | "draft">): MyWorkBucket {
  if (item.hasPendingTodo) return "attention";
  if (item.roles.includes("assignee") || item.roles.includes("reviewer") || (item.roles.includes("author") && item.draft)) {
    return "active";
  }
  return "waiting";
}

export function dedupeMyWorkItems(items: readonly MyWorkSourceItem[]): MyWorkMergeRequest[] {
  const byId = new Map<string, MyWorkSourceItem>();
  for (const item of items) {
    const key = `${item.projectId}:${item.iid}`;
    const current = byId.get(key);
    byId.set(key, current ? mergeSourceItems(current, item) : cloneSourceItem(item));
  }

  return [...byId.entries()]
    .map(([key, item]) => ({ ...item, kind: "merge-request" as const, key, bucket: classifyMyWorkItem(item) }))
    .sort(compareMyWorkItems);
}

export interface OriginBranch {
  name: string;
  updatedAt?: string;
}

export interface OpenMergeRequestSource {
  sourceProjectId?: string;
  sourceBranch?: string;
  targetProjectId?: string;
}

export function selectCandidateBranches(
  branches: readonly OriginBranch[],
  defaultBranch: string | undefined,
  openMergeRequests: readonly OpenMergeRequestSource[],
  originProjectId: string,
  targetProjectId: string,
  now = new Date()
): OriginBranch[] {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return branches
    .filter((branch) => branch.name && branch.name !== defaultBranch)
    .filter((branch) => {
      const updated = Date.parse(branch.updatedAt ?? "");
      return Number.isFinite(updated) && updated >= cutoff;
    })
    .filter((branch) => !openMergeRequests.some((mergeRequest) =>
      String(mergeRequest.sourceProjectId) === originProjectId
      && mergeRequest.sourceBranch === branch.name
      && String(mergeRequest.targetProjectId) === targetProjectId
    ))
    .sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))
    .slice(0, 20);
}

export function comparisonCommitCount(comparison: { commits?: unknown[]; diffs?: unknown[] }): number {
  if ((comparison.diffs?.length ?? 0) === 0 && (comparison.commits?.length ?? 0) === 0) return 0;
  return comparison.commits?.length ?? 0;
}

export function comparisonHasChanges(comparison: { commits?: unknown[]; diffs?: unknown[] }): boolean {
  return comparisonCommitCount(comparison) > 0 || (comparison.diffs?.length ?? 0) > 0;
}

export type MyWorkSourceCache = Record<Exclude<MyWorkSource, "candidates">, MyWorkSourceItem[]>;

export function applyMyWorkSourceResults(
  cache: MyWorkSourceCache,
  results: readonly {
    source: Exclude<MyWorkSource, "candidates">;
    result: { ok: true; value: MyWorkSourceItem[] } | { ok: false };
  }[]
): { updatedSources: Exclude<MyWorkSource, "candidates">[]; failures: Exclude<MyWorkSource, "candidates">[] } {
  const updatedSources: Exclude<MyWorkSource, "candidates">[] = [];
  const failures: Exclude<MyWorkSource, "candidates">[] = [];
  for (const { source, result } of results) {
    if (result.ok) {
      cache[source] = result.value;
      updatedSources.push(source);
    } else {
      failures.push(source);
    }
  }
  return { updatedSources, failures };
}

export function bucketMyWorkItems(mergeRequests: readonly MyWorkMergeRequest[], candidates: readonly MyWorkItem[]): MyWorkStateBuckets {
  const buckets: MyWorkStateBuckets = { attention: [], active: [], waiting: [] };
  for (const item of [...mergeRequests, ...candidates]) buckets[item.bucket].push(item);
  for (const items of Object.values(buckets)) items.sort(compareItemsByUpdatedAt);
  return buckets;
}

export interface MyWorkStateBuckets {
  attention: MyWorkItem[];
  active: MyWorkItem[];
  waiting: MyWorkItem[];
}

function mergeSourceItems(left: MyWorkSourceItem, right: MyWorkSourceItem): MyWorkSourceItem {
  const newer = timestamp(right.updatedAt) >= timestamp(left.updatedAt) ? right : left;
  const older = newer === right ? left : right;
  return {
    ...newer,
    projectPath: newer.projectPath || older.projectPath,
    sourceBranch: newer.sourceBranch || older.sourceBranch,
    targetBranch: newer.targetBranch || older.targetBranch,
    webUrl: newer.webUrl || older.webUrl,
    reviewers: uniqueReviewers([...(left.reviewers ?? []), ...(right.reviewers ?? [])]),
    draft: left.draft || right.draft,
    roles: unique([...left.roles, ...right.roles]),
    attentionReasons: unique([...left.attentionReasons, ...right.attentionReasons]),
    hasPendingTodo: left.hasPendingTodo || right.hasPendingTodo
  };
}

function cloneSourceItem(item: MyWorkSourceItem): MyWorkSourceItem {
  return {
    ...item,
    reviewers: uniqueReviewers(item.reviewers ?? []),
    roles: unique(item.roles),
    attentionReasons: unique(item.attentionReasons)
  };
}

function uniqueReviewers(values: readonly ReviewUser[]): ReviewUser[] {
  const seen = new Set<string>();
  return values.filter((reviewer) => {
    const key = reviewer.id ?? reviewer.username ?? reviewer.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique<T extends MyWorkRole | MyWorkAttentionReason>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareMyWorkItems(left: MyWorkMergeRequest, right: MyWorkMergeRequest): number {
  return bucketOrder(left.bucket) - bucketOrder(right.bucket)
    || compareItemsByUpdatedAt(left, right)
    || left.key.localeCompare(right.key);
}

function compareItemsByUpdatedAt(left: MyWorkItem, right: MyWorkItem): number {
  return timestamp(right.updatedAt) - timestamp(left.updatedAt) || left.key.localeCompare(right.key);
}

function bucketOrder(bucket: MyWorkBucket): number {
  return bucket === "attention" ? 0 : bucket === "active" ? 1 : 2;
}
