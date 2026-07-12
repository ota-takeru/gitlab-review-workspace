import { ReviewComment } from "./reviewTypes";

export function isCommentEdited(comment: Pick<ReviewComment, "createdAt" | "updatedAt">): boolean {
  if (!comment.updatedAt) {
    return false;
  }

  const createdAt = Date.parse(comment.createdAt);
  const updatedAt = Date.parse(comment.updatedAt);
  return Number.isFinite(createdAt) && Number.isFinite(updatedAt) && updatedAt > createdAt;
}

export function editedTimestamp(createdAt: string, candidate?: string): string {
  const created = Date.parse(createdAt);
  const updated = candidate ? Date.parse(candidate) : Number.NaN;
  if (Number.isFinite(updated) && (!Number.isFinite(created) || updated > created)) {
    return candidate as string;
  }

  const now = Date.now();
  return new Date(Number.isFinite(created) ? Math.max(now, created + 1) : now).toISOString();
}
