import type {
  CommentImageHostMessage,
  ResolveCommentImageMessage,
  UploadCommentImageMessage
} from "../../src/commentImageTypes";
import { handleCommentImageMessage } from "../common/commentImages";

export const storyImageDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8fPAAAAAElFTkSuQmCC";

export type UploadOutcome =
  | { ok: true; markdown?: string; imagePath?: string; displayUri?: string }
  | { ok: false; message: string };
export type ResolveOutcome =
  | { ok: true; displayUri?: string; fallbackUrl?: string }
  | { ok: false; message: string; fallbackUrl?: string };

interface CommentImageHostMockOptions {
  upload?: (message: UploadCommentImageMessage, attempt: number) => UploadOutcome;
  resolve?: (message: ResolveCommentImageMessage, attempt: number) => ResolveOutcome;
}

/** Install a story-scoped Extension Host simulation. The returned cleanup is
 * consumed by Storybook's beforeEach lifecycle. */
export function installCommentImageHostMock(options: CommentImageHostMockOptions): () => void {
  let uploadAttempts = 0;
  let resolveAttempts = 0;
  let active = true;

  const respond = (message: CommentImageHostMessage): void => {
    queueMicrotask(() => {
      if (active) handleCommentImageMessage(message);
    });
  };

  const onMessage = (event: Event): void => {
    const message = (event as CustomEvent<unknown>).detail;
    if (!message || typeof message !== "object" || !("type" in message)) return;
    if (message.type === "uploadCommentImage" && options.upload) {
      const request = message as UploadCommentImageMessage;
      const outcome = options.upload(request, ++uploadAttempts);
      respond(outcome.ok
        ? {
            type: "commentImageUploaded",
            requestId: request.requestId,
            markdown: outcome.markdown ?? `![${request.filename}](${outcome.imagePath ?? "/uploads/story/upload.png"})`,
            imagePath: outcome.imagePath ?? "/uploads/story/upload.png",
            displayUri: outcome.displayUri ?? storyImageDataUri
          }
        : { type: "commentImageUploadFailed", requestId: request.requestId, message: outcome.message });
      return;
    }
    if (message.type === "resolveCommentImage" && options.resolve) {
      const request = message as ResolveCommentImageMessage;
      const outcome = options.resolve(request, ++resolveAttempts);
      respond(outcome.ok
        ? {
            type: "commentImageResolved",
            requestId: request.requestId,
            imagePath: request.imagePath,
            displayUri: outcome.displayUri ?? storyImageDataUri,
            fallbackUrl: outcome.fallbackUrl
          }
        : {
            type: "commentImageResolveFailed",
            requestId: request.requestId,
            imagePath: request.imagePath,
            message: outcome.message,
            fallbackUrl: outcome.fallbackUrl
          });
    }
  };

  window.addEventListener("storybook-vscode-message", onMessage);
  return () => {
    active = false;
    window.removeEventListener("storybook-vscode-message", onMessage);
  };
}
