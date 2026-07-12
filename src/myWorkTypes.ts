import type { MergeRequestState } from "./reviewTypes";

export type MyWorkSource = "todo" | "assigned_to_me" | "reviews_for_me" | "created_by_me" | "candidates";
export type MyWorkRole = "author" | "assignee" | "reviewer";
export type MyWorkAttentionReason =
  | "conflict"
  | "pipeline-failed"
  | "approval-required"
  | "review-requested"
  | "mentioned"
  | "assigned"
  | "todo";
export type MyWorkBucket = "attention" | "active" | "waiting";

export interface MyWorkSourceItem {
  projectId: string;
  iid: number;
  title: string;
  state: MergeRequestState;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  webUrl?: string;
  updatedAt?: string;
  projectPath: string;
  draft: boolean;
  roles: MyWorkRole[];
  attentionReasons: MyWorkAttentionReason[];
  hasPendingTodo: boolean;
}

export interface MyWorkMergeRequest extends MyWorkSourceItem {
  kind: "merge-request";
  key: string;
  bucket: MyWorkBucket;
}

export interface MyWorkMergeRequestCandidate {
  kind: "mr-candidate";
  key: string;
  sourceProjectId: string;
  sourceProjectPath: string;
  targetProjectId: string;
  targetProjectPath: string;
  sourceBranch: string;
  targetBranch: string;
  commitCount: number;
  updatedAt?: string;
  bucket: "active";
}

export type MyWorkItem = MyWorkMergeRequest | MyWorkMergeRequestCandidate;

export interface MyWorkState {
  phase: "idle" | "loading" | "ready" | "partial" | "error";
  buckets: {
    attention: MyWorkItem[];
    active: MyWorkItem[];
    waiting: MyWorkItem[];
  };
  attentionCount: number;
  lastSuccessfulAt?: string;
  failedSources: MyWorkSource[];
}

export const emptyMyWorkState: MyWorkState = {
  phase: "idle",
  buckets: { attention: [], active: [], waiting: [] },
  attentionCount: 0,
  failedSources: []
};
