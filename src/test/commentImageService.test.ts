import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import * as glabCommand from "../glabCommand";
import {
  CommentImageService,
  commentImageCacheKey,
  commentImageCachePaths,
  decodeCommentImageBase64,
  detectCommentImageMimeType,
  escapeCommentImageMarkdownAlt,
  parseCommentImagePath,
  sanitizeCommentImageUploadFilename,
  validateCommentImageBytes,
  validateCommentImageFilename,
  type ConfiguredCommentImageHost
} from "../commentImageService";

const host: ConfiguredCommentImageHost = {
  hostname: "gitlab.example.com",
  host: "gitlab.example.com",
  origin: "https://gitlab.example.com"
};
const secret = "0123456789abcdef0123456789abcdef";

test("comment image validation accepts supported magic and rejects MIME mismatches", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectCommentImageMimeType(png), "image/png");
  assert.equal(validateCommentImageBytes(png, "image/png"), "image/png");
  assert.throws(() => validateCommentImageBytes(png, "image/jpeg"));
  assert.equal(detectCommentImageMimeType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(detectCommentImageMimeType(Buffer.from("RIFFxxxxWEBP")), "image/webp");
});

test("base64 decoder is strict", () => {
  assert.deepEqual(decodeCommentImageBase64("R0lGODlh"), Buffer.from("GIF89a"));
  assert.throws(() => decodeCommentImageBase64("not base64"));
  assert.throws(() => decodeCommentImageBase64(""));
});

test("filenames support safe Unicode and sanitize unsafe upload names", () => {
  assert.equal(validateCommentImageFilename("レビュー画像.png", "image/png"), "レビュー画像.png");
  assert.throws(() => validateCommentImageFilename("../secret.png", "image/png"));
  assert.throws(() => validateCommentImageFilename("folder/image.png", "image/png"));
  assert.throws(() => validateCommentImageFilename("invalid*.png", "image/png"));
  assert.match(sanitizeCommentImageUploadFilename("../secret.png", "image/png"), /^image-[0-9a-f]{12}\.png$/);
  assert.equal(sanitizeCommentImageUploadFilename("レビュー画像.jpeg", "image/jpeg"), "レビュー画像.jpeg");
});

test("same-host absolute project upload URLs and relative upload paths are accepted", () => {
  const absolute = parseCommentImagePath(
    `https://gitlab.example.com/group/project/uploads/${secret}/%E7%94%BB%E5%83%8F.png`,
    host
  );
  assert.equal(absolute.filename, "画像.png");
  assert.equal(absolute.imagePath, `/uploads/${secret}/%E7%94%BB%E5%83%8F.png`);
  assert.equal(absolute.fallbackUrl, `https://gitlab.example.com/group/project/uploads/${secret}/%E7%94%BB%E5%83%8F.png`);
  assert.equal(parseCommentImagePath(`/uploads/${secret}/image.jpg`, host).filename, "image.jpg");
  assert.throws(() => parseCommentImagePath(`https://evil.example.com/uploads/${secret}/image.png`, host));
  assert.throws(() => parseCommentImagePath(`/uploads/${secret}/..%2Fsecret.png`, host));
});

test("cache keys are host scoped and canonical extension candidates cover JPEG and extensionless sources", () => {
  const first = commentImageCacheKey("gitlab.example.com", "4", secret, "image.jpeg");
  const second = commentImageCacheKey("other.example.com", "4", secret, "image.jpeg");
  const extensionless = commentImageCacheKey("gitlab.example.com", "4", secret, "no-extension");
  assert.notEqual(first, second);
  assert.deepEqual(
    commentImageCachePaths("cache", "gitlab.example.com", "4", secret, "no-extension").map((value) => value.replace(/\\/g, "/")),
    [`cache/${extensionless}.png`, `cache/${extensionless}.jpg`, `cache/${extensionless}.webp`, `cache/${extensionless}.gif`]
  );
});

test("Markdown alt text escapes structural characters", () => {
  assert.equal(escapeCommentImageMarkdownAlt("image[1]\\draft.png"), "image\\[1\\]\\\\draft.png");
});

test("upload uses glab multipart form with a temporary file and caches the validated image", async () => {
  const original = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  const storage = await mkdtemp(path.join(tmpdir(), "comment-image-upload-test-"));
  let argsSeen: string[] | undefined;
  let temporaryFile: string | undefined;
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async (args: string[]) => {
      argsSeen = args;
      temporaryFile = args.at(-3)?.slice("file=@".length);
      assert.ok(temporaryFile);
      await access(temporaryFile);
      return { ok: true, stdout: JSON.stringify({ url: `/uploads/${secret}/%E7%94%BB%E5%83%8F.png` }) };
    }
  });
  try {
    const service = new CommentImageService(storage, () => "https://gitlab.example.com");
    const result = await service.upload({
      type: "uploadCommentImage",
      requestId: "upload-1",
      projectId: "group/project",
      filename: "画像.png",
      mimeType: "image/png",
      dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")
    });
    assert.equal(argsSeen?.[0], "api");
    assert.equal(argsSeen?.[4], "POST");
    assert.equal(argsSeen?.[5], "projects/group%2Fproject/uploads");
    assert.equal(argsSeen?.[6], "--form");
    assert.match(argsSeen?.[7] ?? "", /^file=@/);
    assert.equal(result.markdown, `![画像.png](/uploads/${secret}/%E7%94%BB%E5%83%8F.png)`);
    await access(result.cachePath);
    await assert.rejects(access(temporaryFile!));
  } finally {
    if (original) Object.defineProperty(glabCommand, "runGlab", original);
    await rm(storage, { recursive: true, force: true });
  }
});

test("duplicate resolves share one authenticated binary download and return a project fallback URL", async () => {
  const originalText = Object.getOwnPropertyDescriptor(glabCommand, "runGlab");
  const originalBinary = Object.getOwnPropertyDescriptor(glabCommand, "runGlabBinary");
  const storage = await mkdtemp(path.join(tmpdir(), "comment-image-resolve-test-"));
  let binaryCalls = 0;
  let binaryArgs: string[] | undefined;
  Object.defineProperty(glabCommand, "runGlab", {
    configurable: true,
    value: async () => ({ ok: true, stdout: JSON.stringify({ web_url: "https://gitlab.example.com/group/project" }) })
  });
  Object.defineProperty(glabCommand, "runGlabBinary", {
    configurable: true,
    value: async (args: string[]) => {
      binaryCalls += 1;
      binaryArgs = args;
      return { ok: true, stdout: Buffer.from("GIF89a") };
    }
  });
  try {
    const service = new CommentImageService(storage, () => "https://gitlab.example.com");
    const message = {
      type: "resolveCommentImage" as const,
      requestId: "resolve-1",
      projectId: "4",
      imagePath: `/uploads/${secret}/no-extension`
    };
    const [first, second] = await Promise.all([service.resolve(message), service.resolve({ ...message, requestId: "resolve-2" })]);
    assert.equal(binaryCalls, 1);
    assert.equal(binaryArgs?.[3], `projects/4/uploads/${secret}/no-extension`);
    assert.equal(first.cachePath, second.cachePath);
    assert.match(first.cachePath, /\.gif$/);
    assert.equal(first.fallbackUrl, `https://gitlab.example.com/group/project/uploads/${secret}/no-extension`);
  } finally {
    if (originalText) Object.defineProperty(glabCommand, "runGlab", originalText);
    if (originalBinary) Object.defineProperty(glabCommand, "runGlabBinary", originalBinary);
    await rm(storage, { recursive: true, force: true });
  }
});
