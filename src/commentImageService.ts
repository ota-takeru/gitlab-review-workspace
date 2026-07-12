import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  isCommentImageMimeType,
  maxCommentImageBytes,
  type CommentImageMimeType,
  type ResolveCommentImageMessage,
  type UploadCommentImageMessage
} from "./commentImageTypes";
import { getGitLabHostname } from "./glabAuthUtils";
import { runGlab, runGlabBinary } from "./glabCommand";

const maxCacheFiles = 100;
const maxCacheBytes = 150 * 1024 * 1024;
const maxCacheAgeMs = 7 * 24 * 60 * 60 * 1000;
const uploadPathPattern = /^\/uploads\/([0-9a-fA-F]{32})\/([^/]+)$/;
const canonicalCacheExtensions = [".png", ".jpg", ".webp", ".gif"] as const;

export interface CommentImageUploadResult {
  markdown: string;
  imagePath: string;
  cachePath: string;
}

export interface CommentImageResolveResult {
  imagePath: string;
  cachePath: string;
  fallbackUrl?: string;
}

export class CommentImageServiceError extends Error {
  constructor(message: string, readonly fallbackUrl?: string) {
    super(message);
  }
}

export interface ConfiguredCommentImageHost {
  hostname: string;
  host: string;
  origin: string;
}

interface ParsedImagePath {
  secret: string;
  filename: string;
  imagePath: string;
  fallbackUrl?: string;
}

export class CommentImageService {
  readonly cacheRootPath: string;
  private readonly pendingResolves = new Map<string, Promise<CommentImageResolveResult>>();

  constructor(globalStoragePath: string, private readonly baseUrlProvider: () => string) {
    this.cacheRootPath = path.join(globalStoragePath, "image-cache");
  }

  async clearCache(): Promise<void> {
    this.pendingResolves.clear();
    await rm(this.cacheRootPath, { recursive: true, force: true });
  }

  async upload(message: UploadCommentImageMessage): Promise<CommentImageUploadResult> {
    const host = this.getConfiguredHost();
    const bytes = decodeCommentImageBase64(message.dataBase64);
    validateCommentImageBytes(bytes, message.mimeType);
    const filename = sanitizeCommentImageUploadFilename(message.filename, message.mimeType);
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "gitlab-review-image-"));
    const temporaryFile = path.join(temporaryDirectory, filename);
    try {
      await writeFile(temporaryFile, bytes, { flag: "wx" });
      const result = await runGlab([
        "api", "--hostname", host.hostname, "--method", "POST",
        `projects/${encodeURIComponent(message.projectId)}/uploads`,
        "--form", `file=@${temporaryFile}`, "--output", "json"
      ], 30_000);
      if (!result.ok) throw new CommentImageServiceError("GitLab image upload failed.");
      const response = parseUploadResponse(result.stdout);
      const parsed = parseCommentImagePath(response.imagePath, host);
      const cachePath = await this.writeCache(host, message.projectId, parsed, bytes, message.mimeType);
      return {
        markdown: `![${escapeCommentImageMarkdownAlt(filename)}](${parsed.imagePath})`,
        imagePath: parsed.imagePath,
        cachePath
      };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async resolve(message: ResolveCommentImageMessage): Promise<CommentImageResolveResult> {
    const host = this.getConfiguredHost();
    const parsed = parseCommentImagePath(message.imagePath, host);
    const key = `${host.host}:${message.projectId}:${parsed.secret}:${parsed.filename}`;
    const existing = this.pendingResolves.get(key);
    if (existing) return existing;
    const pending = this.resolveOnce(message.projectId, parsed, host)
      .catch((error) => {
        if (error instanceof CommentImageServiceError) throw error;
        throw new CommentImageServiceError("GitLab image download failed.", parsed.fallbackUrl);
      })
      .finally(() => {
        if (this.pendingResolves.get(key) === pending) this.pendingResolves.delete(key);
      });
    this.pendingResolves.set(key, pending);
    return pending;
  }

  private async resolveOnce(
    projectId: string,
    parsed: ParsedImagePath,
    host: ConfiguredCommentImageHost
  ): Promise<CommentImageResolveResult> {
    const fallbackUrl = parsed.fallbackUrl ?? await this.getProjectImageUrl(projectId, parsed, host);
    const cached = await this.readCache(host, projectId, parsed);
    if (cached) return { imagePath: parsed.imagePath, cachePath: cached, fallbackUrl };
    const result = await runGlabBinary([
      "api", "--hostname", host.hostname,
      `projects/${encodeURIComponent(projectId)}/uploads/${parsed.secret}/${encodeURIComponent(parsed.filename)}`
    ], 30_000, maxCommentImageBytes + 1);
    if (!result.ok) throw new CommentImageServiceError("GitLab image download failed.", fallbackUrl);
    const mimeType = detectCommentImageMimeType(result.stdout);
    if (!mimeType) throw new CommentImageServiceError("GitLab returned an unsupported image.", fallbackUrl);
    try {
      validateCommentImageBytes(result.stdout, mimeType);
    } catch {
      throw new CommentImageServiceError("GitLab returned an invalid image.", fallbackUrl);
    }
    const cachePath = await this.writeCache(host, projectId, parsed, result.stdout, mimeType);
    return { imagePath: parsed.imagePath, cachePath, fallbackUrl };
  }

  private getConfiguredHost(): ConfiguredCommentImageHost {
    const configured = this.baseUrlProvider().trim();
    const hostname = getGitLabHostname(configured);
    if (!hostname) throw new CommentImageServiceError("The configured GitLab host is invalid.");
    try {
      const url = new URL(configured.includes("://") ? configured : `https://${configured}`);
      return { hostname, host: url.host.toLowerCase(), origin: url.origin };
    } catch {
      throw new CommentImageServiceError("The configured GitLab host is invalid.");
    }
  }

  private async readCache(host: ConfiguredCommentImageHost, projectId: string, parsed: ParsedImagePath): Promise<string | undefined> {
    for (const cachePath of this.cachePaths(host, projectId, parsed)) {
      try {
        const details = await stat(cachePath);
        if (!details.isFile() || details.size < 1 || details.size > maxCommentImageBytes || Date.now() - details.mtimeMs > maxCacheAgeMs) {
          await rm(cachePath, { force: true });
          continue;
        }
        const bytes = await readFile(cachePath);
        if (!detectCommentImageMimeType(bytes)) {
          await rm(cachePath, { force: true });
          continue;
        }
        const now = new Date();
        await utimes(cachePath, now, now).catch(() => undefined);
        return cachePath;
      } catch {
        // Try the next canonical extension.
      }
    }
    return undefined;
  }

  private async writeCache(
    host: ConfiguredCommentImageHost,
    projectId: string,
    parsed: ParsedImagePath,
    bytes: Buffer,
    mimeType: CommentImageMimeType
  ): Promise<string> {
    await mkdir(this.cacheRootPath, { recursive: true });
    await this.pruneCache();
    const cachePath = this.cachePath(host, projectId, parsed, mimeType);
    const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    try {
      await rename(temporaryPath, cachePath).catch(async () => {
        await rm(cachePath, { force: true });
        await rename(temporaryPath, cachePath);
      });
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    await this.pruneCache();
    return cachePath;
  }

  private cachePath(host: ConfiguredCommentImageHost, projectId: string, parsed: ParsedImagePath, mimeType: CommentImageMimeType): string {
    const extension = extensionForMimeType(mimeType);
    const key = commentImageCacheKey(host.host, projectId, parsed.secret, parsed.filename);
    return path.join(this.cacheRootPath, `${key}${extension}`);
  }

  private cachePaths(host: ConfiguredCommentImageHost, projectId: string, parsed: ParsedImagePath): string[] {
    return commentImageCachePaths(this.cacheRootPath, host.host, projectId, parsed.secret, parsed.filename);
  }

  private async getProjectImageUrl(
    projectId: string,
    parsed: ParsedImagePath,
    host: ConfiguredCommentImageHost
  ): Promise<string | undefined> {
    const result = await runGlab([
      "api", "--hostname", host.hostname, `projects/${encodeURIComponent(projectId)}`, "--output", "json"
    ]);
    if (!result.ok) return undefined;
    try {
      const value = JSON.parse(result.stdout) as { web_url?: unknown };
      if (typeof value.web_url !== "string") return undefined;
      const projectUrl = new URL(value.web_url);
      if (projectUrl.host.toLowerCase() !== host.host) return undefined;
      return `${projectUrl.toString().replace(/\/$/, "")}${parsed.imagePath}`;
    } catch {
      return undefined;
    }
  }

  private async pruneCache(): Promise<void> {
    await mkdir(this.cacheRootPath, { recursive: true });
    const now = Date.now();
    const entries = await readdir(this.cacheRootPath, { withFileTypes: true });
    const files = (await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return undefined;
      const filePath = path.join(this.cacheRootPath, entry.name);
      try {
        const details = await stat(filePath);
        if (now - details.mtimeMs > maxCacheAgeMs || entry.name.endsWith(".tmp")) {
          await rm(filePath, { force: true });
          return undefined;
        }
        return { filePath, size: details.size, mtimeMs: details.mtimeMs };
      } catch {
        return undefined;
      }
    }))).filter((entry): entry is { filePath: string; size: number; mtimeMs: number } => Boolean(entry));
    files.sort((left, right) => right.mtimeMs - left.mtimeMs);
    let total = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      if (index >= maxCacheFiles || total + file.size > maxCacheBytes) {
        await rm(file.filePath, { force: true });
      } else {
        total += file.size;
      }
    }
  }
}

export function validateCommentImageFilename(filename: string, mimeType?: CommentImageMimeType): string {
  const utf8Length = Buffer.byteLength(filename, "utf8");
  const stem = path.parse(filename).name.toUpperCase();
  if (!filename || filename !== filename.trim() || utf8Length > 240 || /[\/\\<>:"|?*\u0000-\u001f\u007f]/u.test(filename)
    || filename.startsWith(".") || filename.includes("..") || /[. ]$/u.test(filename)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem)) {
    throw new CommentImageServiceError("The image filename is invalid.");
  }
  if (mimeType) {
    const extension = path.extname(filename).toLowerCase();
    const allowed = extensionsForMimeType(mimeType);
    if (!allowed.includes(extension)) throw new CommentImageServiceError("The image filename does not match its MIME type.");
  }
  return filename;
}

export function sanitizeCommentImageUploadFilename(filename: string, mimeType: CommentImageMimeType): string {
  try {
    return validateCommentImageFilename(filename, mimeType);
  } catch {
    const digest = createHash("sha256").update(filename).digest("hex").slice(0, 12);
    return `image-${digest}${extensionForMimeType(mimeType)}`;
  }
}

export function decodeCommentImageBase64(value: string): Buffer {
  if (!value || value.length > Math.ceil(maxCommentImageBytes / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CommentImageServiceError("The image data is not valid base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maxCommentImageBytes) throw new CommentImageServiceError("The image is too large.");
  return bytes;
}

export function detectCommentImageMimeType(bytes: Uint8Array): CommentImageMimeType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return undefined;
}

export function validateCommentImageBytes(bytes: Uint8Array, mimeType: string): CommentImageMimeType {
  if (!isCommentImageMimeType(mimeType) || bytes.length < 1 || bytes.length > maxCommentImageBytes || detectCommentImageMimeType(bytes) !== mimeType) {
    throw new CommentImageServiceError("The image content does not match its MIME type.");
  }
  return mimeType;
}

export function parseCommentImagePath(imagePath: string, host: ConfiguredCommentImageHost): ParsedImagePath {
  let uploadPath: string;
  let fallbackUrl: string | undefined;
  if (/^https?:\/\//i.test(imagePath)) {
    let url: URL;
    try { url = new URL(imagePath); } catch { throw new CommentImageServiceError("The image URL is invalid."); }
    if (url.username || url.password || url.host.toLowerCase() !== host.host || url.search || url.hash) {
      throw new CommentImageServiceError("The image URL is not on the configured GitLab host.");
    }
    const match = /\/uploads\/([0-9a-fA-F]{32})\/([^/]+)$/.exec(url.pathname);
    if (!match) throw new CommentImageServiceError("The GitLab image path is invalid.");
    uploadPath = `/uploads/${match[1]}/${match[2]}`;
    fallbackUrl = url.toString();
  } else {
    uploadPath = imagePath;
  }
  const match = uploadPathPattern.exec(uploadPath);
  if (!match) throw new CommentImageServiceError("The GitLab image path is invalid.");
  let filename: string;
  try { filename = decodeURIComponent(match[2]!); } catch { throw new CommentImageServiceError("The image filename is invalid."); }
  validateCommentImageFilename(filename);
  const secret = match[1]!.toLowerCase();
  return {
    secret,
    filename,
    imagePath: `/uploads/${secret}/${encodeURIComponent(filename)}`,
    fallbackUrl
  };
}

function parseUploadResponse(stdout: string): { imagePath: string } {
  try {
    const value = JSON.parse(stdout) as { url?: unknown; full_path?: unknown };
    const imagePath = typeof value.url === "string" ? value.url : typeof value.full_path === "string" ? value.full_path : undefined;
    if (!imagePath) throw new Error();
    return { imagePath };
  } catch {
    throw new CommentImageServiceError("GitLab returned an invalid upload response.");
  }
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function extensionForMimeType(mimeType: CommentImageMimeType): string {
  return mimeType === "image/png" ? ".png" : mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/webp" ? ".webp" : ".gif";
}

function extensionsForMimeType(mimeType: CommentImageMimeType): readonly string[] {
  return mimeType === "image/jpeg" ? [".jpg", ".jpeg"] : [extensionForMimeType(mimeType)];
}

export function escapeCommentImageMarkdownAlt(value: string): string {
  return value.replace(/[\\\[\]]/g, "\\$&");
}

export function commentImageCacheKey(host: string, projectId: string, secret: string, filename: string): string {
  return createHash("sha256").update(`${host.toLowerCase()}:${projectId}:${secret.toLowerCase()}:${filename}`).digest("hex");
}

export function commentImageCachePaths(
  cacheRoot: string,
  host: string,
  projectId: string,
  secret: string,
  filename: string
): string[] {
  const key = commentImageCacheKey(host, projectId, secret, filename);
  return canonicalCacheExtensions.map((extension) => path.join(cacheRoot, `${key}${extension}`));
}
