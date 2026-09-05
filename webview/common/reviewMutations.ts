import type { ReviewContext, ReviewMutationResult } from "../../src/reviewContext";
import type {
  ReviewFileMessage,
  SidebarMessage,
  ReviewMutationHostMessage,
  ReviewMutationMessage,
  ReviewMutationRequest
} from "../../src/webviewProtocol";

let requestSequence = 0;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ReviewFileMutationMessage = Extract<ReviewFileMessage, ReviewMutationRequest>;
export type ReviewFileMutationPayload = DistributiveOmit<ReviewFileMutationMessage, keyof ReviewMutationRequest>;
export type SidebarMutationMessage = Extract<SidebarMessage, ReviewMutationRequest>;
export type SidebarMutationPayload = DistributiveOmit<SidebarMutationMessage, keyof ReviewMutationRequest>;

/**
 * Create a request carrying the exact review revision that was rendered in a
 * Webview. Callers should keep the returned request id until the Host replies.
 * An absent context is a local state error, so no request is emitted.
 */
export function createReviewMutationRequest<T extends object>(
  payload: T,
  reviewContext: ReviewContext | undefined
): ReviewMutationMessage<T> | undefined {
  if (!reviewContext) return undefined;
  return {
    ...payload,
    requestId: createReviewMutationRequestId(),
    reviewContext
  } as ReviewMutationMessage<T>;
}

export function createReviewMutationRequestId(prefix = "review-mutation"): string {
  requestSequence += 1;
  const randomUuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${requestSequence}`;
  return `${prefix}-${randomUuid}`;
}

export function isReviewMutationResult(message: unknown): message is ReviewMutationHostMessage {
  if (!message || typeof message !== "object") return false;
  const value = message as Partial<ReviewMutationHostMessage>;
  return value.type === "reviewMutationResult"
    && typeof value.requestId === "string"
    && (value.ok === true || (value.ok === false && typeof value.errorMessage === "string"));
}

export function mutationError(result: ReviewMutationResult): string | undefined {
  return result.ok ? undefined : result.errorMessage;
}
