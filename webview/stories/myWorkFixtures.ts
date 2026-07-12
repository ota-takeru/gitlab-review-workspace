import type {
  MyWorkMergeRequest,
  MyWorkMergeRequestCandidate,
  MyWorkState
} from "../../src/myWorkTypes";

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

export function mergeRequest(overrides: Partial<MyWorkMergeRequest> = {}): MyWorkMergeRequest {
  const iid = overrides.iid ?? 42;
  const projectId = overrides.projectId ?? "101";
  return {
    kind: "merge-request",
    key: `${projectId}:${iid}`,
    projectId,
    projectPath: "platform/review-workspace",
    iid,
    title: "Refine the GitLab review workspace navigation",
    state: "opened",
    sourceBranch: "feature/review-workspace",
    targetBranch: "main",
    author: "otataker",
    updatedAt: minutesAgo(18),
    draft: false,
    roles: ["reviewer"],
    attentionReasons: ["review-requested"],
    hasPendingTodo: true,
    bucket: "attention",
    ...overrides
  };
}

export function candidate(overrides: Partial<MyWorkMergeRequestCandidate> = {}): MyWorkMergeRequestCandidate {
  return {
    kind: "mr-candidate",
    key: "candidate:feature/sidebar",
    sourceProjectId: "202",
    sourceProjectPath: "otataker/review-workspace",
    targetProjectId: "101",
    targetProjectPath: "platform/review-workspace",
    sourceBranch: "feature/sidebar",
    targetBranch: "main",
    commitCount: 3,
    updatedAt: minutesAgo(75),
    bucket: "active",
    ...overrides
  };
}

export function populatedMyWorkState(overrides: Partial<MyWorkState> = {}): MyWorkState {
  const attention = [
    mergeRequest(),
    mergeRequest({
      iid: 51,
      key: "101:51",
      title: "Fix pipeline failures in comment image uploads",
      sourceBranch: "fix/comment-image-upload",
      roles: ["author"],
      attentionReasons: ["pipeline-failed"],
      updatedAt: minutesAgo(35)
    })
  ];
  return {
    phase: "ready",
    buckets: {
      attention,
      active: [
        mergeRequest({
          iid: 45,
          key: "101:45",
          title: "Draft: compact local workspace status",
          sourceBranch: "feature/compact-local-state",
          draft: true,
          roles: ["author"],
          attentionReasons: [],
          hasPendingTodo: false,
          bucket: "active",
          updatedAt: minutesAgo(52)
        }),
        candidate()
      ],
      waiting: [
        mergeRequest({
          iid: 39,
          key: "101:39",
          title: "Improve collapsed discussion summaries",
          sourceBranch: "feature/thread-summary",
          roles: ["author"],
          attentionReasons: [],
          hasPendingTodo: false,
          bucket: "waiting",
          updatedAt: minutesAgo(180)
        })
      ]
    },
    attentionCount: attention.length,
    lastSuccessfulAt: minutesAgo(2),
    failedSources: [],
    ...overrides
  };
}
