<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watchEffect } from "vue";
import { renderMarkdown } from "../../../src/markdownRenderer";
import { commentImageState, isPrivateCommentImagePath, resolveCommentImage } from "../commentImages";

const props = defineProps<{ source: string; projectId?: string }>();
const container = ref<HTMLElement>();
const lightboxUri = ref<string>();
const lightboxAlt = ref("Comment image");
const shouldResolveImages = ref(false);
let lightboxTrigger: HTMLImageElement | undefined;
let visibilityObserver: IntersectionObserver | undefined;
const privatePaths = computed(() => [...props.source.matchAll(/!\[(?:\\.|[^\]\\\n])*\]\(((?:\/uploads\/|https:\/\/[^\s/]+(?:\/[^\s]*)?\/uploads\/)[^\s)]+)\)/gi)].map((match) => match[1]));
const rendered = computed(() => renderMarkdown(props.source));

watchEffect(() => {
  if (!shouldResolveImages.value) return;
  for (const path of privatePaths.value) {
    const state = commentImageState(props.projectId, path);
    if (state?.status === "idle") resolveCommentImage(props.projectId, path);
    // Access state fields so DOM updates when a Host response arrives.
    void state?.status;
    void state?.displayUri;
    void state?.message;
  }
  void nextTick(updateImages);
});
onUpdated(() => { updateImages(); });

function updateImages(): void {
  const root = container.value;
  if (!root) return;
  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const path = image.dataset.commentImagePath;
    if (!path) {
      image.tabIndex = 0;
      image.setAttribute("role", "button");
    image.setAttribute("aria-label", `View ${image.alt || "comment image"} at full size`);
      image.dataset.lightboxImage = "true";
      return;
    }
    const state = commentImageState(props.projectId, path);
    const existing = image.nextElementSibling;
    if (existing?.classList.contains("image-state")) existing.remove();
    if (state?.status === "ready" && state.displayUri) {
      image.src = state.displayUri;
      image.tabIndex = 0;
      image.setAttribute("role", "button");
    image.setAttribute("aria-label", `View ${image.alt || "comment image"} at full size`);
      image.dataset.lightboxImage = "true";
      image.removeAttribute("aria-busy");
      return;
    }
    image.removeAttribute("src");
    image.removeAttribute("data-lightbox-image");
    image.tabIndex = -1;
    const fallback = document.createElement("span");
    fallback.className = "image-state";
    if (state?.status === "error") {
      fallback.textContent = `${state.message ?? "Could not load image."} `;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.dataset.commentImageRetry = path;
      retry.textContent = "Retry";
      fallback.append(retry);
      if (state.fallbackUrl && /^https:\/\/[^\s]+$/i.test(state.fallbackUrl)) {
        const link = document.createElement("a");
        link.href = state.fallbackUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open in GitLab";
        fallback.append(link);
      }
    } else {
      image.setAttribute("aria-busy", "true");
      fallback.textContent = "Loading image…";
    }
    image.after(fallback);
  });
}

function onClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const retry = target.closest<HTMLButtonElement>("button[data-comment-image-retry]");
  if (retry) {
    resolveCommentImage(props.projectId, retry.dataset.commentImageRetry ?? "", true);
    return;
  }
  const image = target.closest<HTMLImageElement>("img[data-lightbox-image]");
  if (image?.src) openLightbox(image);
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target;
  if ((event.key === "Enter" || event.key === " ") && target instanceof HTMLImageElement && target.dataset.lightboxImage) {
    event.preventDefault();
    openLightbox(target);
  }
}

function onCopy(event: ClipboardEvent): void {
  const root = container.value;
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount || !selection.toString()) return;
  if (!selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  event.preventDefault();
  clipboard.clearData();
  clipboard.setData("text/plain", selection.toString());
}

function openLightbox(image: HTMLImageElement): void {
  lightboxTrigger = image;
  lightboxUri.value = image.src;
  lightboxAlt.value = image.alt || "Comment image";
  void nextTick(() => document.querySelector<HTMLButtonElement>(".lightbox-close")?.focus());
}

function closeLightbox(): void {
  lightboxUri.value = undefined;
  void nextTick(() => lightboxTrigger?.focus());
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && lightboxUri.value) closeLightbox();
}

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown);
  if (typeof IntersectionObserver === "undefined" || !container.value) {
    shouldResolveImages.value = true;
    return;
  }
  visibilityObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      shouldResolveImages.value = true;
      visibilityObserver?.disconnect();
      visibilityObserver = undefined;
    }
  }, { rootMargin: "200px" });
  visibilityObserver.observe(container.value);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown);
  visibilityObserver?.disconnect();
});
</script>

<template>
  <!-- renderMarkdown escapes untrusted text before adding this small tag subset. -->
  <div ref="container" class="gl-markdown" v-html="rendered" @click="onClick" @keydown="onKeydown" @copy="onCopy" />
  <div v-if="lightboxUri" class="image-lightbox" role="dialog" aria-modal="true" :aria-label="`View ${lightboxAlt} at full size`" @click.self="closeLightbox">
    <button type="button" class="lightbox-close" aria-label="Close image" @click="closeLightbox">×</button>
    <img :src="lightboxUri" :alt="lightboxAlt">
  </div>
</template>

<style scoped>
.gl-markdown { line-height: 1.5; overflow-wrap: anywhere; }
.gl-markdown :deep(p) { margin: 0; }
.gl-markdown :deep(p + p) { margin-top: var(--gl-spacing-8); }
.gl-markdown :deep(blockquote) { margin: var(--gl-spacing-8) 0; padding: var(--gl-spacing-4) 0 var(--gl-spacing-4) var(--gl-spacing-16); border-left: 4px solid var(--vscode-textBlockQuote-border, var(--gl-border-strong)); color: var(--gl-text-subtle); background: transparent; }
.gl-markdown :deep(ul), .gl-markdown :deep(ol) { margin: var(--gl-spacing-8) 0; padding-left: var(--gl-spacing-24); }
.gl-markdown :deep(li + li) { margin-top: var(--gl-spacing-2); }
.gl-markdown :deep(pre) { max-width: 100%; margin: var(--gl-spacing-8) 0; padding: var(--gl-spacing-8) var(--gl-spacing-12); overflow: auto; border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); color: var(--vscode-textPreformat-foreground, var(--gl-text-default)); background: var(--vscode-textPreformat-background, var(--gl-surface-subtle)); }
.gl-markdown :deep(pre code) { display: block; padding: 0; overflow-wrap: normal; border: 0; border-radius: 0; color: inherit; background: transparent; font: var(--vscode-editor-font-size)/1.45 var(--vscode-editor-font-family); white-space: pre; }
.gl-markdown :deep(code) { padding: 1px var(--gl-spacing-4); border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); color: var(--gl-text-strong); background: color-mix(in srgb, var(--gl-accent-purple) 10%, var(--gl-surface-subtle)); font: .92em var(--vscode-editor-font-family); }
.gl-markdown :deep(a) { color: var(--gl-text-link); text-decoration: underline; text-underline-offset: 2px; }
.gl-markdown :deep(a:hover) { color: var(--gl-hover-text); }
.gl-markdown :deep(img) { display: block; max-width: 100%; height: auto; margin: var(--gl-spacing-8) 0; border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); cursor: zoom-in; }
.gl-markdown :deep(img:not([src])) { display: none; }
.gl-markdown :deep(.image-state) { display: inline-flex; gap: var(--gl-spacing-4); align-items: center; margin: var(--gl-spacing-8) 0; color: var(--gl-text-subtle); font-size: 11px; }
.gl-markdown :deep(.image-state button) { color: var(--gl-text-link); text-decoration: underline; background: transparent; cursor: pointer; }
.image-lightbox { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: var(--gl-spacing-24); background: color-mix(in srgb, black 78%, transparent); }
.image-lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; }
.lightbox-close { position: fixed; top: var(--gl-spacing-12); right: var(--gl-spacing-12); width: 32px; height: 32px; color: white; background: color-mix(in srgb, black 45%, transparent); font-size: 24px; cursor: pointer; }
</style>
