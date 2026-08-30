export const commonEmojiReactions = [
  { name: "thumbsup", emoji: "👍", label: "Thumbs up" },
  { name: "thumbsdown", emoji: "👎", label: "Thumbs down" },
  { name: "smile", emoji: "😄", label: "Smile" },
  { name: "tada", emoji: "🎉", label: "Celebrate" },
  { name: "heart", emoji: "❤️", label: "Heart" },
  { name: "rocket", emoji: "🚀", label: "Rocket" },
  { name: "eyes", emoji: "👀", label: "Eyes" }
] as const;

const emojiByName = new Map<string, string>(commonEmojiReactions.map((item) => [item.name, item.emoji]));

export function emojiReactionText(name: string): string {
  return emojiByName.get(name) ?? `:${name}:`;
}
