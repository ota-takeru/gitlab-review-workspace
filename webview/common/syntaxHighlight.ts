export type SyntaxTokenKind =
  | "comment"
  | "keyword"
  | "number"
  | "property"
  | "string"
  | "tag"
  | "type";

export interface SyntaxToken {
  text: string;
  kind?: SyntaxTokenKind;
}

const JAVASCRIPT_KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "finally", "for", "from", "function",
  "get", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "of", "private",
  "protected", "public", "readonly", "return", "satisfies", "set", "static", "super", "switch", "throw",
  "try", "type", "typeof", "var", "void", "while", "with", "yield"
]);
const JAVASCRIPT_TYPES = new Set([
  "any", "bigint", "boolean", "never", "number", "object", "string", "symbol", "unknown", "undefined"
]);
const GENERAL_KEYWORDS = new Set([
  "abstract", "and", "as", "async", "await", "begin", "break", "case", "catch", "class", "const", "continue",
  "def", "default", "defer", "do", "elif", "else", "end", "enum", "except", "export", "extends", "false",
  "final", "finally", "fn", "for", "foreach", "from", "func", "function", "go", "if", "implements", "import",
  "in", "interface", "lambda", "let", "match", "module", "namespace", "new", "nil", "none", "not", "null",
  "or", "package", "private", "protected", "public", "raise", "readonly", "return", "self", "static", "struct",
  "super", "switch", "this", "throw", "trait", "true", "try", "type", "typeof", "unless", "use", "using",
  "var", "void", "when", "where", "while", "with", "yield"
]);
const GENERAL_TYPES = new Set([
  "bool", "boolean", "byte", "char", "decimal", "double", "float", "i8", "i16", "i32", "i64", "int",
  "long", "number", "object", "short", "str", "string", "u8", "u16", "u32", "u64", "usize"
]);

const SCRIPT_LANGUAGES = new Set([
  "c", "cpp", "csharp", "go", "java", "javascript", "javascriptreact", "kotlin", "php", "python", "ruby",
  "rust", "shellscript", "sql", "swift", "typescript", "typescriptreact", "vue"
]);

const EXTENSION_LANGUAGES: Record<string, string> = {
  c: "c", cc: "cpp", cpp: "cpp", cs: "csharp", css: "css", go: "go", h: "c", hpp: "cpp",
  html: "html", java: "java", js: "javascript", json: "json", jsonc: "json", jsx: "javascriptreact",
  kt: "kotlin", kts: "kotlin", less: "less", md: "markdown", php: "php", py: "python", rb: "ruby",
  rs: "rust", scss: "scss", sh: "shellscript", sql: "sql", swift: "swift", ts: "typescript",
  tsx: "typescriptreact", vue: "vue", xml: "xml", yml: "yaml", yaml: "yaml"
};

export function inferSyntaxLanguage(filePath: string): string {
  const extension = filePath.split(".").at(-1)?.toLowerCase();
  return extension ? EXTENSION_LANGUAGES[extension] ?? "plaintext" : "plaintext";
}

export function resolveSyntaxLanguage(language?: string, filePath?: string): string {
  const normalized = language?.trim().toLowerCase();
  if (normalized && normalized !== "text" && normalized !== "plaintext") return normalized;
  return filePath ? inferSyntaxLanguage(filePath) : normalized || "plaintext";
}

export function highlightCodeLine(code: string, language: string): SyntaxToken[] {
  if (!code) return [{ text: " " }];
  if (["html", "xml", "vue"].includes(language)) return highlightMarkup(code);
  if (["css", "less", "scss"].includes(language)) return highlightCss(code);
  if (["json", "jsonc"].includes(language)) return highlightJson(code);
  if (["yaml", "yml"].includes(language)) return highlightYaml(code);
  if (["markdown", "md"].includes(language)) return highlightMarkdown(code);
  if (SCRIPT_LANGUAGES.has(language)) return highlightScript(code, language);
  return [{ text: code }];
}

function highlightScript(code: string, language: string): SyntaxToken[] {
  const keywords = ["javascript", "javascriptreact", "typescript", "typescriptreact", "vue"].includes(language)
    ? JAVASCRIPT_KEYWORDS
    : GENERAL_KEYWORDS;
  const types = ["javascript", "javascriptreact", "typescript", "typescriptreact", "vue"].includes(language)
    ? JAVASCRIPT_TYPES
    : GENERAL_TYPES;
  const pattern = ["python", "ruby", "shellscript"].includes(language)
    ? /\/\/.*|#.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:0[xob][\da-f]+|\d(?:[\d_]*(?:\.\d[\d_]*)?)(?:e[+-]?\d+)?)\b|\b[A-Za-z_$][\w$]*\b/gi
    : language === "sql"
      ? /--.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:0[xob][\da-f]+|\d(?:[\d_]*(?:\.\d[\d_]*)?)(?:e[+-]?\d+)?)\b|\b[A-Za-z_$][\w$]*\b/gi
      : /\/\/.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:0[xob][\da-f]+|\d(?:[\d_]*(?:\.\d[\d_]*)?)(?:e[+-]?\d+)?)\b|\b[A-Za-z_$][\w$]*\b/gi;
  return tokenize(code, pattern, (value) => {
    if (value.startsWith("//") || value.startsWith("#") || value.startsWith("--") || value.startsWith("/*")) return "comment";
    if (/^["'`]/.test(value)) return "string";
    if (/^(?:0[xob]|\d)/i.test(value)) return "number";
    const normalized = value.toLowerCase();
    if (["true", "false", "null", "nil", "none", "undefined"].includes(normalized)) return "keyword";
    if (keywords.has(normalized)) return "keyword";
    if (types.has(normalized) || /^[A-Z][\w$]*$/.test(value)) return "type";
    return undefined;
  });
}

function highlightJson(code: string): SyntaxToken[] {
  const pattern = /\/\/.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|-?\b\d(?:\d*(?:\.\d+)?)(?:e[+-]?\d+)?\b|\b(?:true|false|null)\b/gi;
  return tokenize(code, pattern, (value, _start, end) => {
    if (value.startsWith("//") || value.startsWith("/*")) return "comment";
    if (value.startsWith('"')) return /^\s*:/.test(code.slice(end)) ? "property" : "string";
    if (/^-?\d/.test(value)) return "number";
    return "keyword";
  });
}

function highlightYaml(code: string): SyntaxToken[] {
  const pattern = /#.*|"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|^[\t ]*[A-Za-z_][\w.-]*(?=\s*:)|[&*!][\w.-]+|-?\b\d(?:\d*(?:\.\d+)?)\b|\b(?:true|false|null|yes|no)\b/gi;
  return tokenize(code, pattern, (value) => {
    if (value.startsWith("#")) return "comment";
    if (/^["']/.test(value)) return "string";
    if (/^[\t ]*[A-Za-z_]/.test(value) && /:\s*/.test(code.slice(code.indexOf(value) + value.length))) return "property";
    if (/^-?\d/.test(value)) return "number";
    if (/^[&*!]/.test(value)) return "type";
    return "keyword";
  });
}

function highlightCss(code: string): SyntaxToken[] {
  const pattern = /\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@[\w-]+|(?:--)?[\w-]+(?=\s*:)|#[\da-f]{3,8}\b|-?(?:\d*\.)?\d+(?:%|[a-z]+)?\b|[.#][\w-]+/gi;
  return tokenize(code, pattern, (value) => {
    if (value.startsWith("/*")) return "comment";
    if (/^["']/.test(value)) return "string";
    if (value.startsWith("@")) return "keyword";
    if (/^(?:--)?[\w-]+$/.test(value)) return "property";
    if (/^-?(?:\d|\.\d)/.test(value) || /^#[\da-f]{3,8}$/i.test(value)) return "number";
    return "type";
  });
}

function highlightMarkup(code: string): SyntaxToken[] {
  const pattern = /<!--.*?-->|<!doctype[^>]*>|<\/?[A-Za-z][^>]*>/gi;
  return tokenize(code, pattern, (value) => {
    if (value.startsWith("<!--")) return "comment";
    return "tag";
  }, (value, kind) => kind === "tag" ? highlightTag(value) : [{ text: value, kind }]);
}

function highlightTag(tag: string): SyntaxToken[] {
  const pattern = /^(?:<\/?|<!)(?:[\w:-]+)|[\w:-]+(?=\s*=)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
  return tokenize(tag, pattern, (value) => {
    if (/^["']/.test(value)) return "string";
    if (value.startsWith("<")) return "tag";
    return "property";
  });
}

function highlightMarkdown(code: string): SyntaxToken[] {
  const pattern = /^\s{0,3}#{1,6}(?=\s)|^\s*>|`+[^`]*`+|!?\[[^\]]*\]\([^)]*\)|\bhttps?:\/\/\S+/g;
  return tokenize(code, pattern, (value) => {
    if (/^\s*(?:#|>)/.test(value)) return "keyword";
    if (value.startsWith("`")) return "string";
    return "property";
  });
}

function tokenize(
  code: string,
  pattern: RegExp,
  classify: (value: string, start: number, end: number) => SyntaxTokenKind | undefined,
  expand: (value: string, kind: SyntaxTokenKind | undefined) => SyntaxToken[] = (value, kind) => [{ text: value, kind }]
): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let offset = 0;
  pattern.lastIndex = 0;
  for (const match of code.matchAll(pattern)) {
    const start = match.index;
    if (start > offset) tokens.push({ text: code.slice(offset, start) });
    const value = match[0];
    tokens.push(...expand(value, classify(value, start, start + value.length)));
    offset = start + value.length;
  }
  if (offset < code.length) tokens.push({ text: code.slice(offset) });
  return tokens.length > 0 ? tokens : [{ text: code }];
}
