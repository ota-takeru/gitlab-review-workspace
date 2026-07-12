export type MarkdownFormat =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline-code"
  | "link"
  | "quote"
  | "bulleted-list"
  | "numbered-list";

export interface MarkdownTransformation {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface InlineFormat {
  before: string;
  after: string;
  placeholder: string;
}

const inlineFormats: Partial<Record<MarkdownFormat, InlineFormat>> = {
  bold: { before: "**", after: "**", placeholder: "text" },
  italic: { before: "_", after: "_", placeholder: "text" },
  strikethrough: { before: "~~", after: "~~", placeholder: "text" },
  "inline-code": { before: "`", after: "`", placeholder: "code" }
};

export function applyMarkdownFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  format: MarkdownFormat
): MarkdownTransformation {
  const start = clamp(Math.min(selectionStart, selectionEnd), 0, value.length);
  const end = clamp(Math.max(selectionStart, selectionEnd), 0, value.length);

  if (format === "link") return applyLink(value, start, end);
  const inline = inlineFormats[format];
  if (inline) return applyInline(value, start, end, inline);
  return applyBlock(value, start, end, format);
}

function applyInline(
  value: string,
  start: number,
  end: number,
  format: InlineFormat
): MarkdownTransformation {
  const selected = value.slice(start, end);
  const content = selected || format.placeholder;
  const replacement = `${format.before}${content}${format.after}`;
  const contentStart = start + format.before.length;
  return {
    value: replaceRange(value, start, end, replacement),
    selectionStart: contentStart,
    selectionEnd: contentStart + content.length
  };
}

function applyLink(value: string, start: number, end: number): MarkdownTransformation {
  const selected = value.slice(start, end);
  const text = selected || "link text";
  const replacement = `[${text}](url)`;
  const selectionOffset = selected ? replacement.lastIndexOf("url") : 1;
  const selectionLength = selected ? 3 : text.length;
  return {
    value: replaceRange(value, start, end, replacement),
    selectionStart: start + selectionOffset,
    selectionEnd: start + selectionOffset + selectionLength
  };
}

function applyBlock(
  value: string,
  start: number,
  end: number,
  format: MarkdownFormat
): MarkdownTransformation {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lastSelectedIndex = end > start ? end - 1 : end;
  const followingBreak = value.indexOf("\n", lastSelectedIndex);
  const lineEnd = followingBreak === -1 ? value.length : followingBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const formatted = lines.map((line, index) => `${blockPrefix(format, index)}${line}`).join("\n");
  return {
    value: replaceRange(value, lineStart, lineEnd, formatted),
    selectionStart: lineStart,
    selectionEnd: lineStart + formatted.length
  };
}

function blockPrefix(format: MarkdownFormat, index: number): string {
  if (format === "quote") return "> ";
  if (format === "bulleted-list") return "- ";
  if (format === "numbered-list") return `${index + 1}. `;
  return "";
}

function replaceRange(value: string, start: number, end: number, replacement: string): string {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
