import type { ReviewState } from "./reviewTypes";

/** A rendered review is bound to an instance, MR, and immutable diff revision. */
export interface ReviewContext {
  instanceUrl: string;
  projectId: string;
  mergeRequestIid: number;
  baseSha: string;
  startSha: string;
  headSha: string;
  currentUserId?: string;
}

export function normalizeInstanceUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Invalid GitLab instance URL.");
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid GitLab instance URL.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function reviewIdentityKey(context: Pick<ReviewContext, "instanceUrl" | "projectId" | "mergeRequestIid">): string {
  return JSON.stringify([context.instanceUrl, context.projectId, context.mergeRequestIid]);
}

export function reviewContextKey(context: ReviewContext): string {
  return JSON.stringify([context.instanceUrl, context.projectId, context.mergeRequestIid, context.baseSha, context.startSha, context.headSha, context.currentUserId]);
}

export function contextForReview(review: ReviewState | undefined): ReviewContext | undefined {
  if (!review?.instanceUrl || !review.diffRefs) return undefined;
  return { instanceUrl: review.instanceUrl, projectId: review.projectId, mergeRequestIid: review.mergeRequestIid, ...review.diffRefs, currentUserId: review.currentUserId };
}

export function sameReviewContext(left: ReviewContext | undefined, right: ReviewContext | undefined): boolean {
  return Boolean(left && right && reviewContextKey(left) === reviewContextKey(right));
}

export type ReviewMutationResult = { ok: true } | { ok: false; errorMessage: string };
