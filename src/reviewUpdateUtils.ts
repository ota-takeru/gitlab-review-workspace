import type { ReviewState, ReviewUpdateRange } from "./reviewTypes";

export function detectReviewUpdateRange(
  previous: ReviewState | undefined,
  current: ReviewState
): ReviewUpdateRange | undefined {
  const fromSha = previous?.diffRefs?.headSha;
  const toSha = current.diffRefs?.headSha;
  if (!previous || previous.projectId !== current.projectId
      || previous.mergeRequestIid !== current.mergeRequestIid
      || !fromSha || !toSha || fromSha === toSha) {
    return undefined;
  }
  const previousHeadIndex = current.commits.findIndex((commit) => commit.id === fromSha);
  const commitCount = previousHeadIndex >= 0
    ? Math.max(1, current.commits.length - previousHeadIndex - 1)
    : 1;
  return {
    projectId: current.projectId,
    mergeRequestIid: current.mergeRequestIid,
    fromSha,
    toSha,
    commitCount
  };
}
