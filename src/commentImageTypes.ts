export const commentImageMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type CommentImageMimeType = typeof commentImageMimeTypes[number];

export const maxCommentImageBytes = 10 * 1024 * 1024;

export interface UploadCommentImageMessage {
  type: "uploadCommentImage";
  requestId: string;
  projectId: string;
  filename: string;
  mimeType: CommentImageMimeType;
  dataBase64: string;
}

export interface ResolveCommentImageMessage {
  type: "resolveCommentImage";
  requestId: string;
  projectId: string;
  imagePath: string;
}

export type CommentImageWebviewMessage = UploadCommentImageMessage | ResolveCommentImageMessage;

export type CommentImageHostMessage =
  | {
      type: "commentImageUploaded";
      requestId: string;
      markdown: string;
      imagePath: string;
      displayUri?: string;
    }
  | {
      type: "commentImageUploadFailed";
      requestId: string;
      message: string;
    }
  | {
      type: "commentImageResolved";
      requestId: string;
      imagePath: string;
      displayUri: string;
      fallbackUrl?: string;
    }
  | {
      type: "commentImageResolveFailed";
      requestId: string;
      imagePath: string;
      message: string;
      fallbackUrl?: string;
    };

export function isCommentImageMimeType(value: string): value is CommentImageMimeType {
  return (commentImageMimeTypes as readonly string[]).includes(value.toLowerCase());
}
