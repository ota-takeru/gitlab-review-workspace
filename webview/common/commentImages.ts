import { reactive } from "vue";
import {
  isCommentImageMimeType,
  type CommentImageHostMessage,
  type CommentImageMimeType
} from "../../src/commentImageTypes";
import { vscode } from "./vscode";

export type CommentImageStatus = "idle" | "loading" | "ready" | "error";
export interface CommentImageState {
  status: CommentImageStatus;
  displayUri?: string;
  message?: string;
  fallbackUrl?: string;
}

const resolutions = reactive(new Map<string, CommentImageState>());
const resolveRequests = new Map<string, string>();
const uploadRequests = new Map<string, { resolve: (value: UploadResult) => void; reject: (reason: Error) => void }>();
let sequence = 0;

interface UploadResult { markdown: string; imagePath: string; displayUri?: string; }

function requestId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function imageKey(projectId: string, imagePath: string): string {
  return `${projectId}:${imagePath}`;
}

export function isPrivateCommentImagePath(imagePath: string): boolean {
  return /^(?:\/uploads\/|https:\/\/[^\s/]+(?:\/[^\s]*)?\/uploads\/)[^\s]+$/i.test(imagePath);
}

export function commentImageState(projectId: string | undefined, imagePath: string): CommentImageState | undefined {
  if (!projectId || !isPrivateCommentImagePath(imagePath)) return undefined;
  const key = imageKey(projectId, imagePath);
  let state = resolutions.get(key);
  if (!state) {
    state = reactive({ status: "idle" as const });
    resolutions.set(key, state);
  }
  return state;
}

export function resolveCommentImage(projectId: string | undefined, imagePath: string, retry = false): void {
  const state = commentImageState(projectId, imagePath);
  if (!state || !projectId || (!retry && state.status !== "idle") || state.status === "loading") return;
  const key = imageKey(projectId, imagePath);
  const existingRequest = [...resolveRequests.entries()].find(([, value]) => value === key);
  if (existingRequest) return;
  state.status = "loading";
  state.message = undefined;
  const id = requestId("resolve-comment-image");
  resolveRequests.set(id, key);
  vscode.postMessage({ type: "resolveCommentImage", requestId: id, projectId, imagePath });
}

/** Cache a URI already supplied by the Host after a successful upload. */
export function rememberCommentImage(projectId: string | undefined, imagePath: string, displayUri?: string): void {
  if (!displayUri) return;
  const state = commentImageState(projectId, imagePath);
  if (!state) return;
  state.status = "ready";
  state.displayUri = displayUri;
  state.message = undefined;
}

export function uploadCommentImage(
  projectId: string | undefined,
  filename: string,
  mimeType: string,
  dataBase64: string
): Promise<UploadResult> {
  if (!projectId) return Promise.reject(new Error("Select a merge request before uploading an image."));
  if (!isCommentImageMimeType(mimeType)) return Promise.reject(new Error("Only PNG, JPEG, WebP, and GIF images are supported."));
  const id = requestId("upload-comment-image");
  return new Promise<UploadResult>((resolve, reject) => {
    uploadRequests.set(id, { resolve, reject });
    vscode.postMessage({ type: "uploadCommentImage", requestId: id, projectId, filename, mimeType: mimeType as CommentImageMimeType, dataBase64 });
  });
}

/** Route Host image responses once per webview application. */
export function handleCommentImageMessage(message: CommentImageHostMessage | { type: "state" }): boolean {
  switch (message.type) {
    case "commentImageUploaded": {
      const request = uploadRequests.get(message.requestId);
      if (!request) return false;
      uploadRequests.delete(message.requestId);
      request.resolve(message);
      return true;
    }
    case "commentImageUploadFailed": {
      const request = uploadRequests.get(message.requestId);
      if (!request) return false;
      uploadRequests.delete(message.requestId);
      request.reject(new Error(message.message));
      return true;
    }
    case "commentImageResolved":
    case "commentImageResolveFailed": {
      const key = resolveRequests.get(message.requestId);
      if (!key) return false;
      resolveRequests.delete(message.requestId);
      const state = resolutions.get(key);
      if (!state) return true;
      if (message.type === "commentImageResolved") {
        state.status = "ready";
        state.displayUri = message.displayUri;
        state.fallbackUrl = message.fallbackUrl;
        state.message = undefined;
      } else {
        state.status = "error";
        state.message = message.message;
        state.fallbackUrl = message.fallbackUrl;
      }
      return true;
    }
    default:
      return false;
  }
}
