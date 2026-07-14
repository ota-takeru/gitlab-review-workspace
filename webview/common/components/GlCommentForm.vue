<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from "vue";
import { maxCommentImageBytes } from "../../../src/commentImageTypes";
import { renderMarkdown } from "../../../src/markdownRenderer";
import { commentImageState, isPrivateCommentImagePath, rememberCommentImage, resolveCommentImage, uploadCommentImage } from "../commentImages";
import GlButton from "./GlButton.vue";
import GlIconButton from "./GlIconButton.vue";

const model = defineModel<string>({ required: true });
const props = withDefaults(defineProps<{
  placeholder?: string;
  ariaLabel?: string;
  "aria-label"?: string;
  submitLabel?: string;
  cancelLabel?: string;
  compact?: boolean;
  projectId?: string;
}>(), { submitLabel: "Comment" });
const emit = defineEmits<{ submit: []; cancel: [] }>();
const form = ref<HTMLFormElement>();
const editor = ref<HTMLDivElement>();
const focused = ref(false);
const activeFormats = ref<Record<string, boolean>>({});
const imagePicker = ref<HTMLInputElement>();
interface PendingImage {
  id: string;
  file: File;
  preview?: string;
  progress: number;
  status: "preparing" | "uploading" | "uploaded" | "failed";
  error?: string;
  imagePath?: string;
  range?: Range;
}
const pendingImages = ref<PendingImage[]>([]);
let editorValue: string | undefined;
let pickerRange: Range | undefined;
let plainTextPasteRequested = false;
const active = computed(() => focused.value || (model.value?.length ?? 0) > 0);
const uploadBlocked = computed(() => pendingImages.value.some((item) => item.status !== "uploaded"));

function resizeEditor(): void {
  void nextTick(() => {
    const element = editor.value;
    if (!element) return;
    element.style.height = "auto";
    if (!active.value) {
      element.style.height = "";
      return;
    }
    const activeMinimum = props.compact ? 64 : 80;
    const borderHeight = element.offsetHeight - element.clientHeight;
    element.style.height = `${Math.max(element.scrollHeight + borderHeight, activeMinimum)}px`;
  });
}

function hydrateEditor(): void {
  const element = editor.value;
  if (!element) return;
  const html = renderMarkdown(model.value ?? "");
  if (element.innerHTML !== html) element.innerHTML = html;
  resizeEditor();
}

function refreshPrivateEditorImages(): void {
  const element = editor.value;
  if (!element) return;
  element.querySelectorAll<HTMLImageElement>("img[data-comment-image-path]").forEach((image) => {
    const imagePath = image.dataset.commentImagePath;
    if (!imagePath || !isPrivateCommentImagePath(imagePath)) return;
    const state = commentImageState(props.projectId, imagePath);
    if (state?.status === "idle") resolveCommentImage(props.projectId, imagePath);
    if (state?.status === "ready" && state.displayUri) image.src = state.displayUri;
    else if (!image.getAttribute("src")) image.alt = "Loading uploaded image";
  });
}

function onFocusIn(): void {
  focused.value = true;
  updateActiveFormats();
  resizeEditor();
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && form.value?.contains(next)) return;
  focused.value = false;
  resizeEditor();
}

function syncFromEditor(): void {
  const element = editor.value;
  if (!element) return;
  const markdown = editorHtmlToMarkdown(element);
  editorValue = markdown;
  if (model.value !== markdown) model.value = markdown;
  updateActiveFormats();
  resizeEditor();
}

function fileAsDataUrl(file: File, onProgress?: (progress: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the pasted image."));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read the pasted image.")));
    reader.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    reader.readAsDataURL(file);
  });
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  if (plainTextPasteRequested) {
    plainTextPasteRequested = false;
    event.preventDefault();
    insertPlainText(event.clipboardData?.getData("text/plain") ?? "");
    return;
  }
  const imageItem = Array.from(event.clipboardData?.items ?? [])
    .find((item) => item.kind === "file" && /^image\/(?:png|jpe?g|gif|webp)$/i.test(item.type));
  const image = imageItem?.getAsFile();
  if (!image) return;
  event.preventDefault();
  await addImage(image);
}

function insertPlainText(text: string): void {
  const element = editor.value;
  if (!element) return;
  element.focus();
  if (!document.execCommand("insertText", false, text)) {
    const selection = document.getSelection();
    const range = selection?.rangeCount && element.contains(selection.anchorNode)
      ? selection.getRangeAt(0)
      : endRange(element);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  syncFromEditor();
}

function captureRange(): Range | undefined {
  const selection = document.getSelection();
  if (!selection?.rangeCount || !editor.value) return undefined;
  const range = selection.getRangeAt(0);
  return editor.value.contains(range.commonAncestorContainer) ? range.cloneRange() : undefined;
}

async function addImage(file: File, range = captureRange()): Promise<void> {
  if (!/^image\/(?:png|jpe?g|gif|webp)$/i.test(file.type)) {
    pendingImages.value.push({ id: crypto.randomUUID(), file, progress: 0, status: "failed", error: "Only PNG, JPEG, WebP, and GIF images are supported." });
    return;
  }
  if (file.size > maxCommentImageBytes) {
    pendingImages.value.push({ id: crypto.randomUUID(), file, progress: 0, status: "failed", error: "Images must be 10 MiB or smaller." });
    return;
  }
  // Keep the same object for the async upload lifecycle, but make mutations
  // observable even though this local reference is not read back through the array.
  const item = reactive<PendingImage>({ id: crypto.randomUUID(), file, progress: 0, status: "preparing", range });
  pendingImages.value.push(item);

  try {
    const dataUrl = await fileAsDataUrl(file, (progress) => { item.progress = progress; });
    item.preview = dataUrl;
    item.progress = 100;
    item.status = "uploading";
    const result = await uploadCommentImage(props.projectId, file.name || "image", file.type, dataUrl.split(",", 2)[1] ?? "");
    // The user may remove an in-flight attachment. The Host request cannot be
    // cancelled, but its eventual response must not alter the editor.
    if (!pendingImages.value.includes(item)) return;
    rememberCommentImage(props.projectId, result.imagePath, result.displayUri);
    insertUploadedImage(result.markdown, result.imagePath, result.displayUri, item.id, item.range);
    item.imagePath = result.imagePath;
    item.status = "uploaded";
  } catch (error) {
    item.status = "failed";
    item.error = error instanceof Error ? error.message : "Could not upload the image.";
  }
}

function insertUploadedImage(
  markdown: string,
  imagePath: string,
  displayUri: string | undefined,
  attachmentId: string,
  savedRange?: Range
): void {
  const element = editor.value;
  if (!element) return;
  const range = restoreRange(savedRange) ?? endRange(element);
  if (!range) return;
  element.focus();
  range.deleteContents();
  const image = document.createElement("img");
  image.dataset.commentImagePath = imagePath;
  image.dataset.commentAttachmentId = attachmentId;
  image.src = displayUri ?? "";
  image.alt = markdown.match(/^!\[([^\]]*)\]/)?.[1] || "uploaded image";
  image.className = "pasted-comment-image";
  range.insertNode(image);
  range.setStartAfter(image);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  syncFromEditor();
}

function restoreRange(range: Range | undefined): Range | undefined {
  const element = editor.value;
  if (!element || !range || !element.contains(range.commonAncestorContainer)) return undefined;
  return range.cloneRange();
}

function endRange(element: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  return range;
}

function rangeAtDrop(event: DragEvent): Range | undefined {
  const selection = document.getSelection();
  const documentWithCaret = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const range = documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range && editor.value?.contains(range.commonAncestorContainer)) return range;
  return selection?.rangeCount ? captureRange() : undefined;
}

function openImagePicker(): void {
  pickerRange = captureRange();
  imagePicker.value?.click();
}
function selectImage(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void addImage(file, pickerRange);
  pickerRange = undefined;
}
function dropImage(event: DragEvent): void {
  event.preventDefault();
  const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) => candidate.type.startsWith("image/"));
  if (file) void addImage(file, rangeAtDrop(event));
}
function retryImage(item: PendingImage): void {
  void addImage(item.file, item.range);
  removeImage(item.id);
}
function removeImage(id: string): void {
  const item = pendingImages.value.find((candidate) => candidate.id === id);
  if (item?.status === "uploaded") {
    editor.value?.querySelector<HTMLImageElement>(`img[data-comment-attachment-id="${id}"]`)?.remove();
    syncFromEditor();
  }
  pendingImages.value = pendingImages.value.filter((item) => item.id !== id);
}

function runCommand(command: string, value?: string): void {
  editor.value?.focus();
  document.execCommand(command, false, value);
  syncFromEditor();
}

function formatBlockName(): string {
  return document.queryCommandValue("formatBlock").toLowerCase().replace(/[<>]/g, "");
}

function updateActiveFormats(): void {
  const element = editor.value;
  const selection = document.getSelection();
  if (!element || !selection?.rangeCount || !element.contains(selection.anchorNode)) {
    activeFormats.value = {};
    return;
  }
  const block = formatBlockName();
  activeFormats.value = {
    bold: document.queryCommandState("bold"),
    italic: document.queryCommandState("italic"),
    strikethrough: document.queryCommandState("strikeThrough"),
    "inline-code": block === "pre",
    quote: block === "blockquote",
    "bulleted-list": document.queryCommandState("insertUnorderedList"),
    "numbered-list": document.queryCommandState("insertOrderedList"),
    link: Boolean((selection.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection.anchorNode?.parentElement)?.closest("a"))
  };
}

function isFormatActive(format: string): boolean {
  return Boolean(activeFormats.value[format]);
}

function formatSelection(format: string): void {
  if (format === "link") {
    if (isFormatActive(format)) {
      runCommand("unlink");
      return;
    }
    const url = window.prompt("リンクURL", "https://");
    if (url) runCommand("createLink", url);
    return;
  }
  if (format === "bold" || format === "italic" || format === "strikethrough") {
    runCommand({ bold: "bold", italic: "italic", strikethrough: "strikeThrough" }[format]);
  } else if (format === "inline-code") {
    runCommand("formatBlock", isFormatActive(format) ? "div" : "pre");
  } else if (format === "quote") {
    runCommand("formatBlock", isFormatActive(format) ? "div" : "blockquote");
  } else if (format === "bulleted-list") {
    runCommand("insertUnorderedList");
  } else if (format === "numbered-list") {
    runCommand("insertOrderedList");
  }
}

function keydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
    plainTextPasteRequested = true;
  } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    if (!uploadBlocked.value) emit("submit");
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    formatSelection("bold");
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
    event.preventDefault();
    formatSelection("italic");
  } else if (event.key === "Escape" && props.cancelLabel) {
    event.preventDefault();
    emit("cancel");
  }
}

function keyup(event: KeyboardEvent): void {
  if (event.key.toLowerCase() === "v") plainTextPasteRequested = false;
}

watch(model, (value) => {
  if (!(value ?? "").trim() && pendingImages.value.every((item) => item.status === "uploaded")) {
    pendingImages.value = [];
  }
  if (editorValue === value) {
    editorValue = undefined;
    resizeEditor();
    return;
  }
  hydrateEditor();
}, { flush: "post" });

watchEffect(() => {
  // Track resolver state before scheduling the DOM update, so Host replies
  // repaint already-hydrated /uploads images in the rich editor.
  const paths = [...(model.value ?? "").matchAll(/!\[(?:\\.|[^\]\\\n])*\]\(((?:\/uploads\/|https:\/\/[^\s/]+(?:\/[^\s]*)?\/uploads\/)[^\s)]+)\)/gi)].map((match) => match[1]);
  for (const path of paths) {
    const state = commentImageState(props.projectId, path);
    if (state?.status === "idle") resolveCommentImage(props.projectId, path);
    void state?.status;
    void state?.displayUri;
  }
  void nextTick(refreshPrivateEditorImages);
});

onMounted(() => {
  window.addEventListener("resize", resizeEditor);
  document.addEventListener("selectionchange", updateActiveFormats);
  hydrateEditor();
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeEditor);
  document.removeEventListener("selectionchange", updateActiveFormats);
});

function editorHtmlToMarkdown(element: HTMLElement): string {
  return serializeNodes(Array.from(element.childNodes)).replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function serializeNodes(nodes: readonly Node[]): string {
  return nodes.map(serializeNode).join("");
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return serializeNodes(Array.from(node.childNodes));
  const content = serializeNodes(Array.from(node.childNodes));
  switch (node.tagName.toLowerCase()) {
    case "br": return "\n";
    case "strong":
    case "b": return `**${content.trim()}**`;
    case "em":
    case "i": return `_${content.trim()}_`;
    case "del":
    case "s": return `~~${content.trim()}~~`;
    case "code": return `\`${content.trim()}\``;
    case "pre": return `\`${content.trim()}\`\n`;
    case "a": {
      const href = node.getAttribute("href") ?? "";
      return /^(?:https?:\/\/|mailto:)/i.test(href) ? `[${content.trim()}](${href})` : content;
    }
    case "img": {
      // A resolved private image has a vscode-webview URI in src; serialize its
      // stable GitLab path instead so edit/save round-trips remain Markdown.
      const src = node.dataset.commentImagePath ?? node.getAttribute("src") ?? "";
      const alt = node.getAttribute("alt") ?? "pasted image";
      return /^(?:https:\/\/|\/uploads\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(src)
        ? `![${escapeMarkdownImageAlt(alt)}](${src})`
        : "";
    }
    case "blockquote": return `${content.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n`;
    case "ul": return `${serializeList(node, "-")}\n`;
    case "ol": return `${serializeList(node, "number")}\n`;
    case "li": return content.trim();
    case "p":
    case "div": return `${content.trim()}\n`;
    default: return content;
  }
}

function serializeList(list: HTMLElement, prefix: "-" | "number"): string {
  return Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li")
    .map((item, index) => `${prefix === "-" ? "-" : `${index + 1}.`} ${serializeNode(item)}`)
    .join("\n");
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/[\\\[\]]/g, "\\$&");
}
</script>

<template>
  <form
    ref="form"
    class="gl-comment-form"
    :class="{ 'is-compact': compact, 'is-active': active }"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @dragover.prevent
    @drop="dropImage"
    @submit.prevent="!uploadBlocked && emit('submit')"
  >
    <div v-if="active" class="markdown-toolbar" role="toolbar" aria-label="Markdown書式">
      <span class="toolbar-group">
        <GlIconButton icon="bold" label="太字" size="small" :class="{ active: isFormatActive('bold') }" :aria-pressed="isFormatActive('bold')" @mousedown.prevent @click="formatSelection('bold')" />
        <GlIconButton icon="italic" label="斜体" size="small" :class="{ active: isFormatActive('italic') }" :aria-pressed="isFormatActive('italic')" @mousedown.prevent @click="formatSelection('italic')" />
        <GlIconButton icon="strikethrough" label="取り消し線" size="small" :class="{ active: isFormatActive('strikethrough') }" :aria-pressed="isFormatActive('strikethrough')" @mousedown.prevent @click="formatSelection('strikethrough')" />
      </span>
      <span class="toolbar-group">
        <GlIconButton icon="code" label="コード" size="small" :class="{ active: isFormatActive('inline-code') }" :aria-pressed="isFormatActive('inline-code')" @mousedown.prevent @click="formatSelection('inline-code')" />
        <GlIconButton icon="link" label="リンク" size="small" :class="{ active: isFormatActive('link') }" :aria-pressed="isFormatActive('link')" @mousedown.prevent @click="formatSelection('link')" />
      </span>
      <span class="toolbar-group">
        <GlIconButton icon="quote" label="引用" size="small" :class="{ active: isFormatActive('quote') }" :aria-pressed="isFormatActive('quote')" @mousedown.prevent @click="formatSelection('quote')" />
        <GlIconButton icon="list" label="箇条書き" size="small" :class="{ active: isFormatActive('bulleted-list') }" :aria-pressed="isFormatActive('bulleted-list')" @mousedown.prevent @click="formatSelection('bulleted-list')" />
        <GlIconButton icon="list-numbered" label="番号付きリスト" size="small" :class="{ active: isFormatActive('numbered-list') }" :aria-pressed="isFormatActive('numbered-list')" @mousedown.prevent @click="formatSelection('numbered-list')" />
      </span>
      <span class="toolbar-group">
        <GlIconButton icon="upload" label="画像をアップロード" size="small" @mousedown.prevent @click="openImagePicker" />
      </span>
    </div>
    <div
      ref="editor"
      class="gl-input rich-comment-editor"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      :aria-label="props.ariaLabel ?? props['aria-label'] ?? 'Comment'"
      :data-placeholder="placeholder"
      @input="syncFromEditor"
      @paste="onPaste"
      @keydown="keydown"
      @keyup="keyup"
    />
    <input ref="imagePicker" class="image-picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="selectImage">
    <div v-if="pendingImages.length" class="image-upload-list" aria-live="polite">
      <div v-for="item in pendingImages" :key="item.id" class="image-upload-item" :class="`is-${item.status}`">
        <img v-if="item.preview" :src="item.preview" alt="Image upload preview">
        <span class="image-upload-status">
          <template v-if="item.status === 'failed'">{{ item.error }}</template>
          <template v-else-if="item.status === 'uploaded'">Attached: {{ item.file.name || 'image' }}</template>
          <template v-else>{{ item.status === 'preparing' ? `Preparing image… ${item.progress}%` : 'Uploading image…' }}</template>
        </span>
        <GlButton v-if="item.status === 'failed'" size="small" @click="retryImage(item)">Retry</GlButton>
        <GlIconButton icon="remove" label="Remove image" size="small" @click="removeImage(item.id)" />
      </div>
    </div>
    <footer v-if="active">
      <span class="hint">Ctrl/Cmd + Enter</span>
      <GlButton v-if="cancelLabel" size="small" @click="emit('cancel')">{{ cancelLabel }}</GlButton>
      <GlButton type="submit" variant="confirm" size="small" icon="paper-airplane" :disabled="uploadBlocked">{{ submitLabel }}</GlButton>
    </footer>
  </form>
</template>

<style scoped>
.gl-comment-form { display: grid; gap: 0; padding: var(--gl-spacing-12); background: var(--gl-surface-raised); }
.gl-comment-form.is-active { gap: var(--gl-spacing-8); }
.markdown-toolbar { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); overflow-x: auto; overflow-y: hidden; padding: var(--gl-spacing-2); border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); background: var(--gl-surface-subtle); scrollbar-width: thin; white-space: nowrap; }
.toolbar-group { display: inline-flex; flex: none; align-items: center; gap: var(--gl-spacing-2); }
.toolbar-group + .toolbar-group { padding-left: var(--gl-spacing-4); border-left: 1px solid var(--gl-border-subtle); }
:deep(.markdown-toolbar .gl-icon-button.active) { color: var(--gl-text-strong); background: var(--gl-selected-surface); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gl-feedback-brand) 55%, transparent); }
.rich-comment-editor { min-height: 30px; max-height: none; overflow: hidden; outline: none; line-height: 1.4; white-space: pre-wrap; }
.rich-comment-editor:empty::before { content: attr(data-placeholder); color: var(--vscode-input-placeholderForeground, var(--gl-text-subtle)); pointer-events: none; }
.rich-comment-editor :deep(p) { margin: 0; }
.rich-comment-editor :deep(ul), .rich-comment-editor :deep(ol) { margin: var(--gl-spacing-4) 0; padding-left: var(--gl-spacing-24); }
.rich-comment-editor :deep(blockquote) { margin: var(--gl-spacing-8) 0; padding: var(--gl-spacing-4) 0 var(--gl-spacing-4) var(--gl-spacing-16); border-left: 4px solid var(--vscode-textBlockQuote-border, var(--gl-border-strong)); color: var(--gl-text-subtle); background: transparent; }
.rich-comment-editor :deep(pre) { margin: var(--gl-spacing-4) 0; padding: var(--gl-spacing-4) var(--gl-spacing-8); border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); background: color-mix(in srgb, var(--gl-accent-purple) 10%, var(--gl-surface-subtle)); font: .92em var(--vscode-editor-font-family); white-space: pre-wrap; }
.rich-comment-editor :deep(a) { color: var(--gl-text-link); text-decoration: underline; }
.rich-comment-editor :deep(img) { display: block; max-width: 100%; height: auto; margin: var(--gl-spacing-8) 0; border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); }
.image-picker { display: none; }
.image-upload-list { display: grid; gap: var(--gl-spacing-4); }
.image-upload-item { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto auto; align-items: center; gap: var(--gl-spacing-8); padding: var(--gl-spacing-4); border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); color: var(--gl-text-subtle); font-size: 11px; }
.image-upload-item.is-failed { color: var(--gl-feedback-danger); border-color: color-mix(in srgb, var(--gl-feedback-danger) 55%, var(--gl-border-subtle)); }
.image-upload-item.is-uploaded { color: var(--gl-text-default); background: var(--gl-surface-subtle); }
.image-upload-item img { width: 32px; height: 26px; object-fit: cover; border-radius: var(--gl-radius-sm); }
.image-upload-status { min-width: 0; overflow-wrap: anywhere; }
.gl-comment-form textarea { min-height: 30px; }
.gl-comment-form footer { display: flex; justify-content: flex-end; align-items: center; gap: var(--gl-spacing-8); }
.hint { margin-right: auto; color: var(--gl-text-subtle); font-size: 10px; }
.is-compact { padding: var(--gl-spacing-8); }
.is-compact .rich-comment-editor { min-height: 30px; }
</style>
