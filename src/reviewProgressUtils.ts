import type {
  FileSummary,
  ReviewProgress,
  ReviewProgressRecord,
  ReviewThread,
  ReviewUpdateRange
} from "./reviewTypes";

export function calculateReviewProgress(
  files: readonly FileSummary[],
  threads: readonly ReviewThread[],
  record: ReviewProgressRecord,
  currentHeadSha: string | undefined,
  newChanges: ReviewUpdateRange | undefined,
  pendingDraftCount: number
): ReviewProgress {
  const viewedFiles = files.filter((file) => isReviewFileViewed(
    file.path,
    record,
    currentHeadSha,
    newChanges
  )).length;
  const unviewedFiles = Math.max(0, files.length - viewedFiles);
  const discussions = threads.filter((thread) => thread.resolvable !== false);
  const resolvedDiscussions = discussions.filter((thread) => thread.resolved).length;
  const unresolvedDiscussions = discussions.length - resolvedDiscussions;
  const filePercent = files.length === 0 ? 100 : (viewedFiles / files.length) * 100;
  const discussionPercent = discussions.length === 0 ? 100 : (resolvedDiscussions / discussions.length) * 100;
  const completionPercent = Math.round((filePercent + discussionPercent) / 2);
  const completeView = unviewedFiles === 0 && unresolvedDiscussions === 0;
  const completionState = completeView && pendingDraftCount > 0
    ? "ready-to-submit"
    : completeView
      ? "complete"
      : viewedFiles > 0 || resolvedDiscussions > 0
        ? "in-progress"
        : "not-started";
  const nextThread = discussions.find((thread) => !thread.resolved);
  const newSinceLastReview = Boolean(
    newChanges
      && newChanges.toSha === currentHeadSha
      && record.lastReviewedSha !== currentHeadSha
  );

  return {
    totalFiles: files.length,
    viewedFiles,
    unviewedFiles,
    totalDiscussions: discussions.length,
    resolvedDiscussions,
    unresolvedDiscussions,
    completionPercent,
    completionState,
    nextUnresolvedThread: nextThread
      ? { id: nextThread.id, filePath: nextThread.filePath, line: nextThread.line ?? nextThread.newLine }
      : undefined,
    lastReviewedSha: record.lastReviewedSha,
    lastReviewedAt: record.lastReviewedAt,
    newSinceLastReview,
    newCommitCount: newSinceLastReview ? newChanges?.commitCount ?? 0 : 0
  };
}

export function isReviewFileViewed(
  filePath: string,
  record: ReviewProgressRecord,
  currentHeadSha: string | undefined,
  newChanges: ReviewUpdateRange | undefined
): boolean {
  if (currentHeadSha && record.viewedFileHeads?.[filePath] === currentHeadSha) return true;
  if (!record.viewedFiles.includes(filePath)) return false;
  return !isReviewFileNewSinceLastReview(filePath, record, currentHeadSha, newChanges);
}

export function isReviewFileNewSinceLastReview(
  filePath: string,
  record: ReviewProgressRecord,
  currentHeadSha: string | undefined,
  newChanges: ReviewUpdateRange | undefined
): boolean {
  if (!newChanges || newChanges.toSha !== currentHeadSha || record.lastReviewedSha === currentHeadSha) {
    return false;
  }
  return newChanges.changedPaths?.includes(filePath) ?? true;
}

export function normalizeReviewProgressRecords(value: unknown): Record<string, ReviewProgressRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const records: Record<string, ReviewProgressRecord> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    const viewedFiles = Array.isArray(candidate.viewedFiles)
      ? candidate.viewedFiles.filter((file): file is string => typeof file === "string")
      : [];
    const viewedFileHeads = candidate.viewedFileHeads
      && typeof candidate.viewedFileHeads === "object"
      && !Array.isArray(candidate.viewedFileHeads)
      ? Object.fromEntries(Object.entries(candidate.viewedFileHeads).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        ))
      : undefined;
    const record: ReviewProgressRecord = {
      viewedFiles: [...new Set(viewedFiles)],
      lastReviewedSha: typeof candidate.lastReviewedSha === "string" ? candidate.lastReviewedSha : undefined,
      lastReviewedAt: typeof candidate.lastReviewedAt === "string" ? candidate.lastReviewedAt : undefined
    };
    if (viewedFileHeads && Object.keys(viewedFileHeads).length > 0) record.viewedFileHeads = viewedFileHeads;
    records[key] = record;
  }
  return records;
}
