<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { ReviewComment, ReviewLine, ReviewThread } from "../../src/reviewTypes";
import type { HostMessage, ReviewFileMessage, ReviewFileViewState } from "../../src/webviewProtocol";
import {
  formatRelativeReplyTime,
  reconcileThreadCollapsed,
  threadCollapseKey,
  threadContentId
} from "../../src/webviewViewModels";
import GlAvatar from "../common/components/GlAvatar.vue";
import GlBadge from "../common/components/GlBadge.vue";
import GlButton from "../common/components/GlButton.vue";
import GlComment from "../common/components/GlComment.vue";
import GlCommentForm from "../common/components/GlCommentForm.vue";
import GlDiffHeader from "../common/components/GlDiffHeader.vue";
import GlDiffScopeToggle, { type GlDiffScope } from "../common/components/GlDiffScopeToggle.vue";
import GlDiffTable from "../common/components/GlDiffTable.vue";
import GlEmptyState from "../common/components/GlEmptyState.vue";
import GlIcon from "../common/components/GlIcon.vue";
import GlIconButton from "../common/components/GlIconButton.vue";
import GlMarkdown from "../common/components/GlMarkdown.vue";
import GlThreadStatusAction from "../common/components/GlThreadStatusAction.vue";
import { handleCommentImageMessage } from "../common/commentImages";
import { vscode } from "../common/vscode";

interface PersistedReviewFileState {
  editDrafts?: Record<string, string>;
  editingComments?: string[];
  replyDrafts?: Record<string, string>;
  selectedRange?: { startId: string; endId: string };
  rangeComposer?: {
    anchorId: string;
    mrLine: number;
    oldLine?: number;
    body: string;
  };
  localEditDraft?: string;
  collapsedThreads?: Record<string, boolean>;
  diffScope?: GlDiffScope;
}

const restored = (vscode.getState() ?? {}) as PersistedReviewFileState;
const state = shallowRef<ReviewFileViewState>();
const editor = ref<HTMLTextAreaElement>();
const localEditText = ref(restored.localEditDraft);
const editDrafts = ref<Record<string, string>>({ ...restored.editDrafts });
const editingComments = ref<string[]>([...(restored.editingComments ?? Object.keys(editDrafts.value))]);
const replyDrafts = ref<Record<string, string>>({ ...restored.replyDrafts });
const selectedRange = ref(restored.selectedRange);
const rangeComposer = ref(restored.rangeComposer);
const collapsedThreads = ref<Record<string, boolean>>({ ...restored.collapsedThreads });
const diffScope = ref<GlDiffScope>(restored.diffScope ?? "changes");
const resolvedByThread = new Map<string, boolean>();
let dragStart = -1;
let dragEnd = -1;
let dragging = false;
let readyRetry: number | undefined;

const model = computed(() => state.value?.viewModel);
const lines = computed(() => model.value?.lines ?? []);
const displayedLines = computed(() => {
  if (diffScope.value === "file") return lines.value;
  const changed = lines.value
    .map((line, index) => line.kind !== "context" || line.threads.length > 0 ? index : -1)
    .filter((index) => index >= 0);
  if (changed.length === 0) return lines.value;
  const visible = new Set<number>();
  for (const index of changed) {
    for (let offset = -3; offset <= 3; offset += 1) {
      const candidate = index + offset;
      if (candidate >= 0 && candidate < lines.value.length) visible.add(candidate);
    }
  }
  return lines.value.filter((_, index) => visible.has(index));
});
const selectedBounds = computed(() => {
  const selection = selectedRange.value;
  if (!selection) return undefined;
  const start = displayedLines.value.findIndex((line) => line.id === selection.startId);
  const end = displayedLines.value.findIndex((line) => line.id === selection.endId);
  if (start < 0 || end < 0) return undefined;
  return { first: Math.min(start, end), last: Math.max(start, end) };
});

function post(message: ReviewFileMessage): void {
  vscode.postMessage(message);
}

function setDiffScope(next: GlDiffScope): void {
  diffScope.value = next;
  persist();
}

function persist(): void {
  const persisted: PersistedReviewFileState = {
    editDrafts: editDrafts.value,
    editingComments: editingComments.value,
    replyDrafts: replyDrafts.value,
    selectedRange: selectedRange.value,
    rangeComposer: rangeComposer.value,
    localEditDraft: localEditText.value,
    collapsedThreads: collapsedThreads.value,
    diffScope: diffScope.value
  };
  vscode.setState(persisted as Record<string, unknown>);
}

function applyState(next: ReviewFileViewState): void {
  const previousMode = state.value?.mode;
  const previousSource = state.value?.source ?? "review";
  state.value = next;
  if (next.source === "commit" && previousSource !== "commit") {
    diffScope.value = "changes";
    persist();
  }
  if ((next.targetLine !== undefined || next.targetThreadId) && diffScope.value !== "file") {
    diffScope.value = "file";
    persist();
  }
  reconcileThreads(next);
  if (next.targetThreadId) {
    const key = threadCollapseKey(next.threadScope, next.targetThreadId);
    if (collapsedThreads.value[key]) {
      collapsedThreads.value[key] = false;
      persist();
    }
  }
  if (next.mode === "edit" && previousMode !== "edit" && localEditText.value === undefined) {
    localEditText.value = next.viewModel?.editableText ?? "";
    persist();
  }
  validateSelection();
  void nextTick(() => focusTarget(next));
}

function collapseKey(thread: ReviewThread): string {
  return threadCollapseKey(state.value?.threadScope ?? "unknown-file", thread.id);
}

function isThreadCollapsed(thread: ReviewThread): boolean {
  return collapsedThreads.value[collapseKey(thread)] ?? thread.resolved;
}

function toggleThread(thread: ReviewThread): void {
  collapsedThreads.value[collapseKey(thread)] = !isThreadCollapsed(thread);
  persist();
}

function threadPanelId(thread: ReviewThread): string {
  return threadContentId("review-file", state.value?.threadScope ?? "unknown-file", thread.id);
}

function lastComment(thread: ReviewThread): ReviewComment | undefined { return thread.comments.at(-1); }
function replyCount(thread: ReviewThread): number { return Math.max(0, thread.comments.length - 1); }
function relativeReplyTime(thread: ReviewThread): string { return formatRelativeReplyTime(lastComment(thread)?.createdAt); }

function reconcileThreads(next: ReviewFileViewState): void {
  let changed = false;
  for (const thread of next.viewModel?.threads ?? []) {
    const key = threadCollapseKey(next.threadScope, thread.id);
    const collapsed = reconcileThreadCollapsed(thread.resolved, {
      collapsed: collapsedThreads.value[key],
      previousResolved: resolvedByThread.get(key)
    });
    if (collapsedThreads.value[key] !== collapsed) {
      collapsedThreads.value[key] = collapsed;
      changed = true;
    }
    resolvedByThread.set(key, thread.resolved);
  }
  if (changed) persist();
}

function validateSelection(): void {
  const ids = new Set(lines.value.map((line) => line.id));
  if (selectedRange.value &&
      (!ids.has(selectedRange.value.startId) || !ids.has(selectedRange.value.endId))) {
    selectedRange.value = undefined;
    rangeComposer.value = undefined;
    persist();
  } else if (rangeComposer.value && !ids.has(rangeComposer.value.anchorId)) {
    rangeComposer.value = undefined;
    persist();
  }
}

function focusTarget(next: ReviewFileViewState): void {
  let target: HTMLElement | undefined;
  if (next.targetThreadId) {
    target = Array.from(document.querySelectorAll<HTMLElement>("[data-thread-id]"))
      .find((element) => element.dataset.threadId === next.targetThreadId);
  }
  if (!target && next.targetLine) {
    target = Array.from(document.querySelectorAll<HTMLElement>("[data-mr-line]"))
      .find((element) => Number(element.dataset.mrLine) === next.targetLine);
  }
  if (target) flashAndScroll(target);

  if (next.mode === "edit" && next.targetLine && editor.value) {
    const textLines = editor.value.value.split("\n");
    if (next.targetLine <= textLines.length) {
      const offset = textLines.slice(0, next.targetLine - 1).join("\n").length +
        (next.targetLine > 1 ? 1 : 0);
      editor.value.focus();
      editor.value.setSelectionRange(offset, offset);
      const ratio = Math.max(0, (next.targetLine - 5) / Math.max(textLines.length, 1));
      editor.value.scrollTop = ratio * editor.value.scrollHeight;
    }
  }
}

function flashAndScroll(element: HTMLElement): void {
  element.scrollIntoView({ block: "center" });
  element.classList.remove("flash");
  void element.offsetWidth;
  element.classList.add("flash");
}

function enterEdit(): void {
  localEditText.value = model.value?.editableText ?? "";
  persist();
  post({ type: "enterEdit" });
}

function cancelEdit(): void {
  localEditText.value = undefined;
  persist();
  post({ type: "cancelEdit" });
}

function saveEdit(): void {
  const text = localEditText.value ?? model.value?.editableText ?? "";
  localEditText.value = undefined;
  persist();
  post({ type: "saveLocalEdit", text });
}

function onEditorKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveEdit();
  }
}

function clearSelection(): void {
  dragging = false;
  dragStart = -1;
  dragEnd = -1;
  selectedRange.value = undefined;
  rangeComposer.value = undefined;
  persist();
}

function startDrag(event: PointerEvent, index: number): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button, textarea, form, a")) return;
  event.preventDefault();
  clearSelection();
  dragStart = index;
  dragEnd = index;
  dragging = true;
  updateSelection();
}

function extendDrag(index: number): void {
  if (!dragging) return;
  dragEnd = index;
  updateSelection();
}

function updateSelection(): void {
  const start = displayedLines.value[dragStart];
  const end = displayedLines.value[dragEnd];
  if (!start || !end) return;
  selectedRange.value = { startId: start.id, endId: end.id };
  persist();
}

function finishDrag(): void {
  if (!dragging || dragStart < 0 || dragEnd < 0) return;
  dragging = false;
  const first = Math.min(dragStart, dragEnd);
  const last = Math.max(dragStart, dragEnd);
  const selected = displayedLines.value.slice(first, last + 1);
  const target = [...selected].reverse().find((line) => line.mrLine !== undefined && line.mrLine > 0);
  const anchor = selected.at(-1);
  if (!target || !anchor) {
    rangeComposer.value = undefined;
    persist();
    return;
  }
  rangeComposer.value = {
    anchorId: anchor.id,
    mrLine: target.mrLine as number,
    oldLine: target.oldLine,
    body: rangeComposer.value?.body ?? ""
  };
  persist();
  void nextTick(() => {
    document.querySelector<HTMLTextAreaElement>(".new-comment-form textarea")?.focus();
  });
}

function isSelected(index: number): boolean {
  const bounds = selectedBounds.value;
  return Boolean(bounds && index >= bounds.first && index <= bounds.last);
}

function submitRange(): void {
  const composer = rangeComposer.value;
  if (!composer?.body.trim()) return;
  post({
    type: "addThread",
    body: composer.body,
    mrLine: composer.mrLine,
    oldLine: composer.oldLine
  });
  clearSelection();
}

function reply(thread: ReviewThread): void {
  const body = replyDrafts.value[thread.id] ?? "";
  if (!body.trim()) return;
  post({ type: "addComment", threadId: thread.id, body });
  delete replyDrafts.value[thread.id];
  persist();
}

function commentKey(threadId: string, commentId: string): string {
  return `${threadId}:${commentId}`;
}

function isEditing(threadId: string, commentId: string): boolean {
  return editingComments.value.includes(commentKey(threadId, commentId));
}

function startCommentEdit(threadId: string, comment: ReviewComment): void {
  const key = commentKey(threadId, comment.id);
  editDrafts.value[key] ??= comment.body;
  if (!editingComments.value.includes(key)) editingComments.value.push(key);
  persist();
  void nextTick(() => {
    const form = Array.from(document.querySelectorAll<HTMLElement>("[data-edit-key]"))
      .find((element) => element.dataset.editKey === key);
    const textarea = form?.querySelector<HTMLTextAreaElement>("textarea");
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  });
}

function cancelCommentEdit(threadId: string, comment: ReviewComment): void {
  const key = commentKey(threadId, comment.id);
  editingComments.value = editingComments.value.filter((candidate) => candidate !== key);
  delete editDrafts.value[key];
  persist();
}

function submitCommentEdit(threadId: string, comment: ReviewComment): void {
  const key = commentKey(threadId, comment.id);
  const body = editDrafts.value[key] ?? "";
  if (!body.trim()) return;
  post({ type: "editComment", threadId, commentId: comment.id, body });
  editingComments.value = editingComments.value.filter((candidate) => candidate !== key);
  delete editDrafts.value[key];
  persist();
}

function edited(comment: ReviewComment): boolean {
  if (!comment.updatedAt) return false;
  const created = Date.parse(comment.createdAt);
  const updated = Date.parse(comment.updatedAt);
  return Number.isFinite(created) && Number.isFinite(updated) && updated > created;
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function rowClasses(line: ReviewLine): string[] {
  return [line.kind, line.mrAdded ? "mr-added-source" : "", line.text.startsWith("@@") ? "hunk" : ""];
}

function lineMarker(line: ReviewLine): string {
  if (line.kind === "mr-added") return "+";
  if (line.kind === "mr-removed") return "−";
  if (line.kind === "local-added") return "+L";
  if (line.kind === "local-removed") return "−L";
  return line.text.startsWith("@@") ? "@@" : "";
}

function lineStateLabel(line: ReviewLine): string {
  if (line.kind === "mr-added") return "Merge request addition";
  if (line.kind === "mr-removed") return "Merge request deletion";
  if (line.kind === "local-added") return "Local addition";
  if (line.kind === "local-removed") return "Local deletion";
  if (line.text.startsWith("@@")) return "Diff hunk";
  return "Unchanged line";
}

function lineAt(index: number): ReviewLine {
  return displayedLines.value[index] as ReviewLine;
}

function onMessage(event: MessageEvent<HostMessage<ReviewFileViewState>>): void {
  const message = event.data;
  if (handleCommentImageMessage(message)) return;
  if (message.type !== "state") return;
  stopReadyRetry();
  applyState(message.state);
}

function cancelDrag(): void {
  dragging = false;
}

function requestInitialState(): void { post({ type: "ready" }); }

function stopReadyRetry(): void {
  if (readyRetry === undefined) return;
  window.clearInterval(readyRetry);
  readyRetry = undefined;
}

onMounted(() => {
  window.addEventListener("message", onMessage);
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", cancelDrag);
  readyRetry = window.setInterval(requestInitialState, 500);
  requestInitialState();
});

onBeforeUnmount(() => {
  stopReadyRetry();
  window.removeEventListener("message", onMessage);
  window.removeEventListener("pointerup", finishDrag);
  window.removeEventListener("pointercancel", cancelDrag);
});
</script>

<template>
  <main v-if="!state" class="review-file-app" aria-live="polite">
    <GlEmptyState title="Loading changes…" icon="spinner" />
  </main>
  <main v-else-if="!model" class="review-file-app">
    <GlEmptyState
      title="File unavailable"
      :description="`${state.filePath} was not found in this merge request.`"
      icon="warning"
    />
  </main>
  <main v-else-if="state.mode === 'edit'" class="review-file-app edit-root">
    <GlDiffHeader :path="model.file.path" sticky>
      <template #meta>
        <span class="file-details">
          <span class="change-count additions">+{{ model.summary.additions }}</span>
          <span class="change-count deletions">−{{ model.summary.deletions }}</span>
          <span class="detail-item"><GlIcon name="comments" :size="12" />{{ model.summary.threadCount }} discussions</span>
          <span v-if="model.hasLocalEdit" class="detail-item local-state">
            <GlIcon name="pencil" :size="12" />Local changes · {{ formatDate(model.localEditUpdatedAt) }}
          </span>
        </span>
      </template>
      <template #actions>
        <GlButton variant="confirm" size="small" icon="check" aria-label="Save local changes" title="Save local changes (Ctrl+S)" @click="saveEdit">
          Save changes
        </GlButton>
        <GlIconButton icon="close" label="Cancel editing" @click="cancelEdit" />
      </template>
    </GlDiffHeader>
    <section class="edit-layout" aria-label="Edit local file">
      <div class="editor-pane">
        <div class="pane-heading">
          <span>Working copy</span>
          <span>Ctrl+S to save</span>
        </div>
        <textarea
          ref="editor"
          v-model="localEditText"
          class="edit-area"
          aria-label="File contents"
          spellcheck="false"
          @input="persist"
          @keydown="onEditorKeydown"
        />
      </div>
      <aside class="comment-rail" aria-label="File discussions">
        <div class="rail-head">
          <strong>Discussions</strong>
          <GlBadge>{{ model.threads.length }}</GlBadge>
        </div>
        <p v-if="!model.threads.length" class="rail-empty">No discussions on this file.</p>
        <article
          v-for="thread in model.threads"
          :key="thread.id"
          class="rail-thread"
          :class="{ resolved: thread.resolved }"
          :data-thread-id="thread.id"
        >
          <div class="rail-thread-head">
            <span>Line {{ thread.line ?? '—' }}</span>
            <span class="thread-state">
              <GlIcon :name="thread.resolved ? 'check-circle' : 'comments'" :size="12" />
              {{ thread.resolved ? 'Resolved' : 'Open' }}
            </span>
          </div>
          <div class="rail-note">
            <GlAvatar
              :name="thread.comments.at(-1)?.author || '?'"
              :avatar-url="thread.comments.at(-1)?.avatarUrl"
            />
            <p>{{ thread.comments.at(-1)?.body ?? '' }}</p>
          </div>
        </article>
      </aside>
    </section>
  </main>
  <main v-else class="review-file-app review-root">
    <GlDiffHeader :path="model.file.path" sticky>
      <template #meta>
        <span v-if="state.source === 'commit' && state.commit" class="commit-context">
          <GlIcon name="commit" :size="12" />
          <code>{{ state.commit.shortId }}</code>
          <span class="gl-truncate" :title="state.commit.title">{{ state.commit.title }}</span>
        </span>
        <span class="file-details">
          <span class="change-count additions">+{{ model.summary.additions }}</span>
          <span class="change-count deletions">−{{ model.summary.deletions }}</span>
          <span class="detail-item"><GlIcon name="comments" :size="12" />{{ model.summary.threadCount }} discussions</span>
          <span v-if="model.hasLocalEdit" class="detail-item local-state">
            <GlIcon name="pencil" :size="12" />Local changes · {{ formatDate(model.localEditUpdatedAt) }}
          </span>
        </span>
      </template>
      <template #actions>
        <GlDiffScopeToggle :model-value="diffScope" @update:model-value="setDiffScope" />
        <template v-if="state.source !== 'commit'">
          <GlButton
            size="small"
            icon="pencil"
            :disabled="!state.canEditLocally"
            :title="state.canEditLocally ? 'Edit a local working copy' : 'Open the MR source branch in this workspace to edit locally'"
            @click="enterEdit"
          >Edit locally</GlButton>
          <GlIconButton
            icon="remove"
            label="Discard local changes"
            variant="danger"
            :disabled="!model.hasLocalEdit"
            @click="post({ type: 'clearLocalEdit' })"
          />
        </template>
      </template>
    </GlDiffHeader>

    <div class="diff-context" aria-label="Diff legend">
      <span class="context-copy">Drag across lines and release to start a discussion.</span>
      <span class="legend-item mr-add"><span class="legend-swatch" />MR addition</span>
      <span class="legend-item mr-del"><span class="legend-swatch" />MR deletion</span>
      <span class="legend-item local-add"><span class="legend-swatch" />Local addition</span>
      <span class="legend-item local-del"><span class="legend-swatch" />Local deletion</span>
    </div>

    <GlDiffTable class="code-table" :lines="displayedLines" ariaLabel="File changes">
      <template #header>
        <div class="code-header" role="row">
          <span role="columnheader" title="Old line">Old</span>
          <span role="columnheader" title="Merge request line">MR</span>
          <span role="columnheader" title="Working copy line">Local</span>
          <span role="columnheader" class="sr-only">Change</span>
          <span role="columnheader">Code</span>
        </div>
      </template>
      <template #line="{ index }">
        <div
          :class="['gl-diff-row', 'code-row', ...rowClasses(lineAt(index)), { 'range-selected': isSelected(index) }]"
          role="row"
          data-review-line
          :data-mr-line="lineAt(index).mrLine"
          :data-old-line="lineAt(index).oldLine"
          :aria-selected="isSelected(index)"
          :aria-label="`${lineStateLabel(lineAt(index))}, ${lineAt(index).mrLine ? `line ${lineAt(index).mrLine}` : 'deleted line'}`"
          @pointerdown="startDrag($event, index)"
          @pointerenter="extendDrag(index)"
        >
          <span class="gl-diff-gutter line-no" role="cell">{{ lineAt(index).oldLine }}</span>
          <span class="gl-diff-gutter line-no" role="cell">{{ lineAt(index).mrLine }}</span>
          <span class="gl-diff-gutter line-no" role="cell">{{ lineAt(index).localLine }}</span>
          <span class="gl-diff-marker change-marker" role="cell" :title="lineStateLabel(lineAt(index))">{{ lineMarker(lineAt(index)) }}</span>
          <pre class="gl-diff-code code" role="cell"><code>{{ lineAt(index).text || ' ' }}</code></pre>
          <span v-if="lineAt(index).threads.length" class="line-discussions" :title="`${lineAt(index).threads.length} discussions`">
            <GlIcon name="comment" :size="12" />{{ lineAt(index).threads.length }}
          </span>
        </div>

        <div
          v-if="rangeComposer?.anchorId === lineAt(index).id"
          class="new-discussion"
          aria-label="New discussion"
        >
          <div class="composer-heading">
            <GlIcon name="comments" :size="14" />
            <strong>Start a discussion</strong>
            <span>on selected lines</span>
          </div>
          <GlCommentForm
            v-model="rangeComposer.body"
            class="new-comment-form"
            ariaLabel="New comment"
            placeholder="Write a comment…"
            cancelLabel="Cancel"
            compact
            :project-id="state?.projectId"
            @update:modelValue="persist"
            @submit="submitRange"
            @cancel="clearSelection"
          />
        </div>

        <article
          v-for="thread in lineAt(index).threads"
          :key="thread.id"
          class="discussion"
          :class="{ resolved: thread.resolved, pending: thread.pending, collapsed: isThreadCollapsed(thread) }"
          :data-thread-id="thread.id"
        >
          <header class="discussion-header">
            <button
              class="discussion-toggle"
              type="button"
              :aria-expanded="!isThreadCollapsed(thread)"
              :aria-controls="threadPanelId(thread)"
              :aria-label="`${isThreadCollapsed(thread) ? 'Expand' : 'Collapse'} discussion on line ${thread.line ?? lineAt(index).mrLine ?? 'unknown'}`"
              @click.stop="toggleThread(thread)"
            >
              <GlIcon name="chevron-right" :size="12" />
              <GlAvatar
                :name="lastComment(thread)?.author || 'GitLab user'"
                :avatar-url="lastComment(thread)?.avatarUrl"
              />
              <span class="discussion-heading">
                <span v-if="isThreadCollapsed(thread)" class="discussion-summary-line">
                  <strong class="reply-count-link">{{ replyCount(thread) }} replies</strong>
                  <span class="discussion-last-reply gl-truncate">Last reply by <b>{{ lastComment(thread)?.author || 'GitLab user' }}</b> {{ relativeReplyTime(thread) }}</span>
                </span>
                <template v-else>
                  <strong class="discussion-expanded-title">Discussion on line {{ thread.line ?? lineAt(index).mrLine ?? '—' }}</strong>
                  <span class="discussion-last-reply">{{ thread.comments.length }} comments</span>
                </template>
                <span v-if="isThreadCollapsed(thread)" class="discussion-location">Line {{ thread.line ?? lineAt(index).mrLine ?? '—' }}</span>
              </span>
            </button>
            <GlThreadStatusAction
              :resolved="thread.resolved"
              :pending="thread.pending"
              :resolvable="thread.resolvable !== false"
              @toggle="post({ type: 'toggleResolved', threadId: thread.id })"
            />
          </header>

          <div v-show="!isThreadCollapsed(thread)" :id="threadPanelId(thread)" class="discussion-content">
            <GlComment
              v-for="comment in thread.comments"
              :key="comment.id"
              class="discussion-note"
              :author="comment.author"
              :avatar-url="comment.avatarUrl"
              :date="formatDate(comment.createdAt)"
              :edited="edited(comment)"
              :pending="comment.pending"
            >
              <template #meta>
                <span v-if="comment.pending" class="pending-note" aria-live="polite">
                  {{ comment.id.includes('-pending-') ? 'Sending…' : 'Saving…' }}
                </span>
              </template>
              <template #actions>
                <GlIconButton
                  v-if="comment.canEdit && !comment.pending"
                  class="comment-edit-action"
                  icon="pencil"
                  label="Edit comment"
                  size="small"
                  @click.stop="startCommentEdit(thread.id, comment)"
                />
              </template>
              <div v-if="!isEditing(thread.id, comment.id)" class="note-body"><GlMarkdown :source="comment.body" :project-id="state?.projectId" /></div>
              <GlCommentForm
                v-else
                v-model="editDrafts[commentKey(thread.id, comment.id)]"
                class="comment-edit-form"
                ariaLabel="Edit comment"
                submitLabel="Save changes"
                cancelLabel="Cancel"
                compact
                :project-id="state?.projectId"
                :data-edit-key="commentKey(thread.id, comment.id)"
                @update:modelValue="persist"
                @submit="submitCommentEdit(thread.id, comment)"
                @cancel="cancelCommentEdit(thread.id, comment)"
              />
            </GlComment>

            <GlCommentForm
              v-if="!thread.pending"
              v-model="replyDrafts[thread.id]"
              class="reply-composer"
              ariaLabel="Reply to discussion"
              placeholder="Reply to this discussion…"
              compact
              :project-id="state?.projectId"
              @update:modelValue="persist"
              @submit="reply(thread)"
            />
          </div>
        </article>
      </template>
    </GlDiffTable>
  </main>
</template>

<style scoped>
.review-file-app {
  min-height: 100vh;
  color: var(--vscode-editor-foreground);
  background: var(--gl-surface-default);
}

.review-root { display: grid; grid-template-rows: auto auto 1fr; }
.edit-root { display: grid; grid-template-rows: auto 1fr; }

.file-details,
.detail-item,
.legend-item,
.thread-state,
.discussion-location,
.composer-heading {
  display: flex;
  align-items: center;
}

.file-details { flex-wrap: wrap; gap: var(--gl-spacing-8); color: var(--gl-text-subtle); font-size: 11px; }
.commit-context { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-commit-accent); font-size: 10px; }
.commit-context code { color: var(--gl-text-default); font-family: var(--vscode-editor-font-family); }
.detail-item { gap: var(--gl-spacing-4); }
.change-count { font-weight: 600; font-variant-numeric: tabular-nums; }
.additions { color: var(--vscode-gitDecoration-addedResourceForeground, var(--gl-feedback-success)); }
.deletions { color: var(--vscode-gitDecoration-deletedResourceForeground, var(--gl-feedback-danger)); }
.local-state { color: var(--gl-local-accent); }

.diff-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gl-spacing-12);
  padding: var(--gl-spacing-8) var(--gl-spacing-12);
  border-bottom: 1px solid var(--gl-border-default);
  color: var(--gl-text-subtle);
  background: var(--vscode-editor-background);
  font-size: 11px;
}

.context-copy { margin-right: auto; }
.scope-label { color: var(--gl-text-subtle); white-space: nowrap; }
.legend-item { gap: var(--gl-spacing-4); white-space: nowrap; }
.legend-swatch { width: 10px; height: 10px; border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-sm); }
.mr-add .legend-swatch { background: var(--vscode-diffEditor-insertedTextBackground, color-mix(in srgb, var(--gl-feedback-success) 20%, transparent)); }
.mr-del .legend-swatch { background: var(--vscode-diffEditor-removedTextBackground, color-mix(in srgb, var(--gl-feedback-danger) 20%, transparent)); }
.local-add .legend-swatch { background: color-mix(in srgb, var(--gl-local-accent) 20%, transparent); }
.local-del .legend-swatch { background: color-mix(in srgb, var(--gl-local-accent) 14%, transparent); }

.code-table { width: 100%; overflow: auto; }
.code-header,
.code-row {
  display: grid;
  grid-template-columns: repeat(3, 30px) 24px minmax(0, 1fr);
  min-width: 420px;
}

.code-header {
  border-bottom: 1px solid var(--gl-border-default);
  color: var(--gl-text-subtle);
  background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
  font-size: 9px;
  line-height: 20px;
  text-transform: uppercase;
}

.code-header span { padding-inline: var(--gl-spacing-4); text-align: center; }
.code-header span:last-child { text-align: left; }
.code-row {
  position: relative;
  min-width: 0;
  min-height: 22px;
  border-bottom: 0;
  cursor: crosshair;
  user-select: none;
}

.code-row.context { background: var(--gl-surface-default); }
.code-row.mr-added { background: var(--vscode-diffEditor-insertedLineBackground, color-mix(in srgb, var(--gl-feedback-success) 12%, transparent)); }
.code-row.mr-removed { background: var(--vscode-diffEditor-removedLineBackground, color-mix(in srgb, var(--gl-feedback-danger) 12%, transparent)); }
.code-row.local-added { background: color-mix(in srgb, var(--gl-local-accent) 11%, var(--vscode-editor-background)); }
.code-row.local-removed { background: color-mix(in srgb, var(--gl-local-accent) 12%, var(--vscode-editor-background)); }
.code-row.mr-added-source:not(.mr-added) { box-shadow: inset 2px 0 var(--vscode-gitDecoration-addedResourceForeground, var(--gl-feedback-success)); }
.code-row.hunk { color: var(--vscode-editorInfo-foreground, var(--gl-feedback-info)); background: var(--vscode-editor-lineHighlightBackground); }
.code-row.range-selected {
  z-index: 1;
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
  background: var(--gl-selected-surface);
}

.line-no,
.change-marker {
  min-height: 22px;
  padding: 3px var(--gl-spacing-4);
  border-right: 1px solid color-mix(in srgb, var(--gl-border-default) 58%, transparent);
  color: var(--vscode-editorLineNumber-foreground);
  background: color-mix(in srgb, var(--vscode-editorGutter-background, var(--vscode-editor-background)) 92%, transparent);
  font: 10px/16px var(--vscode-editor-font-family);
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: none;
}

.change-marker { padding-inline: 0; font-weight: 700; text-align: center; }
.mr-added .change-marker { color: var(--vscode-gitDecoration-addedResourceForeground, var(--gl-feedback-success)); }
.mr-removed .change-marker { color: var(--vscode-gitDecoration-deletedResourceForeground, var(--gl-feedback-danger)); }
.local-added .change-marker,
.local-removed .change-marker { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--gl-feedback-info)); font-size: 9px; }
.code {
  min-width: 0;
  min-height: 22px;
  margin: 0;
  padding: 3px 46px 3px var(--gl-spacing-8);
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 0;
  border-radius: 0;
  background: transparent;
  font: var(--vscode-editor-font-size)/1.35 var(--vscode-editor-font-family);
  tab-size: 2;
}

.line-discussions {
  position: absolute;
  top: 2px;
  right: var(--gl-spacing-8);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 18px;
  padding-inline: var(--gl-spacing-4);
  border: 1px solid var(--gl-border-default);
  border-radius: var(--gl-radius-sm);
  color: var(--vscode-textLink-foreground);
  background: var(--gl-surface-overlay);
  font-size: 10px;
}

.new-discussion,
.discussion {
  width: min(820px, calc(100vw - 150px));
  margin: var(--gl-spacing-8) var(--gl-spacing-12) var(--gl-spacing-12) 114px;
  border: 1px solid var(--gl-border-default);
  border-radius: var(--gl-radius-md);
  background: var(--gl-surface-raised);
  overflow: hidden;
}

.new-discussion { border-top: 2px solid var(--gl-thread-accent); }
.composer-heading { gap: var(--gl-spacing-4); padding: var(--gl-spacing-8) var(--gl-spacing-12) 0; color: var(--gl-text-subtle); font-size: 11px; }
.composer-heading strong { color: var(--vscode-foreground); font-size: 12px; }

.discussion { border-top: 2px solid var(--gl-thread-accent); }
.discussion.resolved {
  border-top-width: 3px;
  border-top-color: var(--gl-resolved-accent);
  background: color-mix(in srgb, var(--gl-resolved-accent) 4%, var(--gl-surface-raised));
}
.discussion.pending { opacity: .78; }
.discussion-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gl-spacing-4);
  min-height: 36px;
  padding: var(--gl-spacing-4);
  border-bottom: 1px solid var(--gl-border-default);
  color: var(--gl-text-subtle);
  background: var(--gl-surface-subtle);
  font-size: 11px;
}

.discussion.collapsed .discussion-header { border-bottom: 0; }
.discussion:not(.resolved) .discussion-header { background: color-mix(in srgb, var(--gl-thread-accent) 5%, var(--gl-surface-subtle)); }
.discussion.resolved .discussion-header {
  border-bottom-color: color-mix(in srgb, var(--gl-resolved-accent) 24%, var(--gl-border-default));
  background: color-mix(in srgb, var(--gl-resolved-accent) 12%, var(--gl-surface-subtle));
}
.discussion-toggle {
  min-width: 0;
  min-height: 28px;
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: var(--gl-spacing-4);
  padding: var(--gl-spacing-2) var(--gl-spacing-4);
  border-radius: var(--gl-radius-sm);
  color: var(--gl-text-default);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.discussion-toggle:hover { background: var(--gl-hover-surface); }
.discussion-toggle > :first-child { color: var(--gl-thread-accent); transition: transform .12s; }
.discussion.resolved .discussion-toggle > :first-child { color: var(--gl-resolved-accent); }
.discussion-toggle[aria-expanded="true"] > :first-child { transform: rotate(90deg); }
.discussion-heading { min-width: 0; flex: 1; display: grid; gap: 1px; overflow: hidden; }
.discussion-summary-line { min-width: 0; display: flex; align-items: baseline; gap: var(--gl-spacing-4); overflow: hidden; white-space: nowrap; }
.reply-count-link { flex: none; color: var(--gl-text-link); font-size: 11px; text-decoration: underline; }
.discussion-last-reply { min-width: 0; color: var(--gl-text-subtle); font-size: 10px; }
.discussion-last-reply b, .discussion-expanded-title { color: var(--gl-text-strong); font-size: 11px; }
.discussion-expanded-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.discussion-location { color: var(--gl-text-subtle); font: 9px var(--vscode-editor-font-family); }
.discussion-content { min-width: 0; }
.note-body { line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.pending-note { display: inline-flex; align-items: center; gap: var(--gl-spacing-4); font-size: 10px; }
:deep(.comment-edit-form textarea) { min-height: 72px; }
:deep(.comment-edit-action) { color: var(--gl-text-subtle); }
:deep(.comment-edit-action:hover) { color: var(--gl-thread-accent); background: color-mix(in srgb, var(--gl-thread-accent) 12%, transparent); }
.reply-composer { width: auto; margin: 0; border: 0; border-radius: 0; }

.edit-layout { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 30vw); }
.editor-pane { min-width: 0; display: grid; grid-template-rows: auto 1fr; }
.pane-heading {
  display: flex;
  justify-content: space-between;
  padding: var(--gl-spacing-4) var(--gl-spacing-12);
  border-bottom: 1px solid var(--gl-border-default);
  color: var(--gl-text-subtle);
  background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
  font-size: 10px;
  text-transform: uppercase;
}

.edit-area {
  width: 100%;
  min-width: 0;
  height: calc(100vh - 79px);
  padding: var(--gl-spacing-12);
  resize: none;
  border: 0;
  border-right: 1px solid var(--gl-border-default);
  outline: none;
  color: var(--vscode-editor-foreground);
  background: var(--vscode-editor-background);
  font: var(--vscode-editor-font-size)/1.5 var(--vscode-editor-font-family);
  tab-size: 2;
  white-space: pre;
}

.edit-area:focus { box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
.comment-rail {
  min-width: 0;
  max-height: calc(100vh - 58px);
  overflow: auto;
  padding: var(--gl-spacing-12);
  display: grid;
  align-content: start;
  gap: var(--gl-spacing-8);
  border-left: 1px solid var(--gl-border-default);
  background: var(--gl-surface-subtle);
}

.rail-head { display: flex; justify-content: space-between; align-items: center; }
.rail-empty { margin: 0; padding-block: var(--gl-spacing-12); color: var(--gl-text-subtle); font-size: 11px; }
.rail-thread { border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-md); background: var(--gl-surface-raised); overflow: hidden; }
.rail-thread.resolved { opacity: .72; }
.rail-thread-head {
  display: flex;
  justify-content: space-between;
  padding: var(--gl-spacing-8);
  border-bottom: 1px solid var(--gl-border-default);
  color: var(--gl-text-subtle);
  background: var(--gl-surface-subtle);
  font-size: 10px;
}

.rail-note { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: var(--gl-spacing-8); padding: var(--gl-spacing-8); }
.rail-note p { margin: 0; line-height: 1.45; overflow-wrap: anywhere; }

.flash { outline: 1px solid var(--gl-focus-ring); outline-offset: -1px; animation: file-flash 1.5s ease-out; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@keyframes file-flash {
  from { background-color: color-mix(in srgb, var(--gl-focus-ring) 26%, transparent); }
  to { background-color: transparent; }
}

@media (max-width: 760px) {
  .context-copy { flex-basis: 100%; }
  .code-header,
  .code-row { grid-template-columns: repeat(3, 26px) 22px minmax(0, 1fr); min-width: 0; }
  :deep(.gl-diff-row.code-row) { min-width: 0; }
  .new-discussion,
  .discussion { width: calc(100vw - 24px); margin-left: var(--gl-spacing-12); }
  .edit-layout { grid-template-columns: 1fr; }
  .edit-area { height: 62vh; border-right: 0; border-bottom: 1px solid var(--gl-border-default); }
  .comment-rail { max-height: none; border-left: 0; }
}

@media (max-width: 420px) {
  .discussion-header { gap: var(--gl-spacing-2); padding-inline: var(--gl-spacing-2); }
  .discussion-toggle { padding-inline: var(--gl-spacing-2); }
}
</style>
