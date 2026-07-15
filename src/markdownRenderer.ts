/**
 * Render the small, intentionally supported Markdown subset used by review
 * comments. Input is escaped before any markup is added, so the returned HTML
 * is safe to pass to the dedicated GlMarkdown component.
 */
type MarkdownCodeBlock =
  | { kind: "fenced"; marker: "`" | "~"; markerLength: number; language?: string; lines: string[] }
  | { kind: "indented"; lines: string[] };

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | undefined;
  let listItems: string[] = [];
  let quoteLines: string[] = [];
  let codeBlock: MarkdownCodeBlock | undefined;

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (!listType) return;
    output.push(`<${listType}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${listType}>`);
    listType = undefined;
    listItems = [];
  };
  const flushQuote = (): void => {
    if (!quoteLines.length) return;
    output.push(`<blockquote>${quoteLines.map(renderInline).join("<br>")}</blockquote>`);
    quoteLines = [];
  };
  const flushCodeBlock = (): void => {
    if (!codeBlock) return;
    const lines = [...codeBlock.lines];
    while (lines.at(-1) === "") lines.pop();
    const language = codeBlock.kind === "fenced" ? codeBlock.language : undefined;
    const className = language ? ` class="language-${escapeHtml(language)}"` : "";
    const contents = lines.length ? `${escapeHtml(lines.join("\n"))}\n` : "";
    output.push(`<pre><code${className}>${contents}</code></pre>`);
    codeBlock = undefined;
  };
  const flushBlocks = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (codeBlock?.kind === "fenced") {
      const closingFence = new RegExp(`^\\s*${codeBlock.marker}{${codeBlock.markerLength},}\\s*$`);
      if (closingFence.test(line)) {
        flushCodeBlock();
      } else {
        codeBlock.lines.push(line);
      }
      continue;
    }

    if (codeBlock?.kind === "indented") {
      if (!line.trim()) {
        codeBlock.lines.push("");
        continue;
      }
      const indentedLine = stripIndentedCode(line);
      if (indentedLine !== undefined) {
        codeBlock.lines.push(indentedLine);
        continue;
      }
      flushCodeBlock();
    }

    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flushBlocks();
      codeBlock = {
        kind: "fenced",
        marker: fence[1][0] as "`" | "~",
        markerLength: fence[1].length,
        language: normalizeCodeLanguage(fence[2]),
        lines: []
      };
      continue;
    }

    const indentedLine = stripIndentedCode(line);
    if (indentedLine !== undefined) {
      flushBlocks();
      codeBlock = { kind: "indented", lines: [indentedLine] };
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const nextListType = unordered ? "ul" : "ol";
      if (listType && listType !== nextListType) flushList();
      listType = nextListType;
      listItems.push((unordered ?? ordered)![1]);
      continue;
    }

    if (!line.trim()) {
      flushBlocks();
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
  }
  flushBlocks();
  flushCodeBlock();
  return output.join("");
}

function stripIndentedCode(line: string): string | undefined {
  if (line.startsWith("\t")) return line.slice(1);
  if (line.startsWith("    ")) return line.slice(4);
  return undefined;
}

function normalizeCodeLanguage(info: string): string | undefined {
  const language = info.trim().split(/\s+/, 1)[0] ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9+_.-]*$/.test(language) ? language : undefined;
}

function renderInline(source: string): string {
  const codeTokens: string[] = [];
  const escapeTokens: string[] = [];
  const imageTokens: string[] = [];
  const withCodeTokens = source.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  const withEscapeTokens = withCodeTokens.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    (_match, character: string) => {
      const token = `\u0000ESCAPE${escapeTokens.length}\u0000`;
      escapeTokens.push(escapeHtml(character));
      return token;
    }
  );
  const withImages = escapeHtml(withEscapeTokens).replace(
    /!\[((?:\\.|[^\]\\\n])*)\]\(((?:(?:https:\/\/|\/uploads\/)[^\s)]+|data:image\/(?:png|jpe?g|gif|webp);base64,[^\s)]+))\)/gi,
    (_match, alt: string, src: string) => {
      if (!isSafeImageUrl(src)) return unescapeMarkdownAlt(alt);
      const safeSrc = escapeHtml(src);
      const safeAlt = unescapeMarkdownAlt(alt);
      // Upload URLs are resolved by the webview through the Extension Host. Keeping
      // them out of src prevents the browser from making an unauthenticated request.
      const html = isPrivateUploadPath(src)
        ? `<img data-comment-image-path="${safeSrc}" alt="${safeAlt}" loading="lazy">`
        : `<img src="${safeSrc}" alt="${safeAlt}" loading="lazy">`;
      const token = `\u0000IMAGE${imageTokens.length}\u0000`;
      imageTokens.push(html);
      return token;
    }
  );
  const withLinks = withImages.replace(
    /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    (_match, label: string, href: string) => isSafeEscapedUrl(href)
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label
  );
  const formatted = withLinks
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<em>$1</em>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  return formatted
    .replace(/\u0000CODE(\d+)\u0000/g, (_match, index: string) => codeTokens[Number(index)] ?? "")
    .replace(/\u0000IMAGE(\d+)\u0000/g, (_match, index: string) => imageTokens[Number(index)] ?? "")
    .replace(/\u0000ESCAPE(\d+)\u0000/g, (_match, index: string) => escapeTokens[Number(index)] ?? "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function isSafeEscapedUrl(value: string): boolean {
  return !/(?:&quot;|&#39;|&lt;|&gt;)/i.test(value);
}

function isSafeImageUrl(value: string): boolean {
  return /^(?:https:\/\/|\/uploads\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(value)
    && !/(?:&quot;|&#39;|&lt;|&gt;|\s)/i.test(value);
}

function isPrivateUploadPath(value: string): boolean {
  return /^(?:\/uploads\/|https:\/\/[^\s/]+(?:\/[^\s]*)?\/uploads\/)[^\s]+$/i.test(value);
}

function unescapeMarkdownAlt(value: string): string {
  return value.replace(/\\([\\\[\]])/g, "$1");
}
