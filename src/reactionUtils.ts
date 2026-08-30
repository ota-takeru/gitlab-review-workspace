import type { ReviewReaction, ReviewReactionUser } from "./reviewTypes";

export function cloneReactions(reactions: readonly ReviewReaction[]): ReviewReaction[] {
  return reactions.map((reaction) => ({
    ...reaction,
    users: reaction.users.map((user) => ({ ...user }))
  }));
}

export function optimisticallyToggleReaction(
  reactions: readonly ReviewReaction[],
  name: string,
  currentUserId: string | undefined,
  remove: boolean
): ReviewReaction[] {
  const next = cloneReactions(reactions);
  const index = next.findIndex((reaction) => reaction.name === name);
  if (remove) {
    if (index < 0) return next;
    const reaction = next[index];
    reaction.count = Math.max(0, reaction.count - 1);
    reaction.currentUserAwardId = undefined;
    reaction.pending = true;
    if (currentUserId) {
      reaction.users = reaction.users.filter((user) => user.id !== currentUserId);
    }
    if (reaction.count === 0) next.splice(index, 1);
    return next;
  }

  if (index >= 0) {
    next[index].count += 1;
    next[index].pending = true;
  } else {
    next.push({ name, count: 1, users: [], pending: true });
  }
  return next;
}

export function mergeReactionUsers(
  left: readonly ReviewReactionUser[],
  right: readonly ReviewReactionUser[]
): ReviewReactionUser[] {
  const users = [...left.map((user) => ({ ...user }))];
  for (const user of right) {
    const duplicate = users.some((candidate) => (
      candidate.id !== undefined && candidate.id === user.id
    ) || (
      candidate.id === undefined && candidate.username !== undefined && candidate.username === user.username
    ));
    if (!duplicate) users.push({ ...user });
  }
  return users;
}
