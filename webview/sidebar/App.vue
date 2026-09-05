<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from "vue";
import { buildBranchTree } from "../../src/branchTreeUtils";
import { isCommentEdited } from "../../src/commentUtils";
import { buildChangedFileTree, compactChangedFileTree } from "../../src/reviewTreeUtils";
import { reviewContextKey, type ReviewContext } from "../../src/reviewContext";
import {
  formatRelativeReplyTime,
  isCommitDiffForSelection,
  normalizeCommitFilter,
  reconcileThreadCollapsed,
  threadCollapseKey,
  threadContentId
} from "../../src/webviewViewModels";
import type { MyWorkMergeRequest } from "../../src/myWorkTypes";
import type { ReviewComment, ReviewSubmissionMode, ReviewThreadSummary, ReviewThreadSortOrder } from "../../src/reviewTypes";
import type { HostMessage, ReviewMutationHostMessage, SidebarHostMessage, SidebarMessage, SidebarViewState } from "../../src/webviewProtocol";
import GlBadge from "../common/components/GlBadge.vue";
import GlAvatarGroup from "../common/components/GlAvatarGroup.vue";
import GlButton from "../common/components/GlButton.vue";
import GlComment from "../common/components/GlComment.vue";
import GlCommentForm from "../common/components/GlCommentForm.vue";
import GlEmptyState from "../common/components/GlEmptyState.vue";
import GlIcon from "../common/components/GlIcon.vue";
import GlIconButton from "../common/components/GlIconButton.vue";
import GlMarkdown from "../common/components/GlMarkdown.vue";
import GlReactionBar from "../common/components/GlReactionBar.vue";
import GlSection from "../common/components/GlSection.vue";
import GlStatusBadge from "../common/components/GlStatusBadge.vue";
import GlTechnicalIdentifier from "../common/components/GlTechnicalIdentifier.vue";
import GlThreadStatusAction from "../common/components/GlThreadStatusAction.vue";
import GlReviewerList from "../common/components/GlReviewerList.vue";
import { handleCommentImageMessage } from "../common/commentImages";
import { createReviewMutationRequest, isReviewMutationResult, type SidebarMutationMessage, type SidebarMutationPayload } from "../common/reviewMutations";
import { vscode } from "../common/vscode";
import MyWorkView from "./MyWorkView.vue";
import SidebarTabs from "./SidebarTabs.vue";
import TreeItem from "./TreeItem.vue";

interface UiState {
  changedFilesHeight?: number;
  changedFilesExpanded?: boolean;
  commitsExpanded?: boolean;
  commitSelection?: { mrKey: string; commitId: string };
  replyDrafts?: Record<string, string>;
  editDrafts?: Record<string, string>;
  editingComments?: Record<string, boolean>;
  collapsedThreads?: Record<string, boolean>;
  overviewThreadDrafts?: Record<string, string>;
  overviewThreadModes?: Record<string, ReviewSubmissionMode>;
  myWorkScrollTop?: number;
}

type DraftKind = "reply" | "edit" | "overview";
type ReviewMutationEnvelope = SidebarMutationMessage;
type ReviewMutationBuilder = (context: ReviewContext, body?: string) => ReviewMutationEnvelope;
interface ReviewMutationRecord {
  slot: string;
  requestId: string;
  context: ReviewContext;
  contextKey: string;
  build: ReviewMutationBuilder;
  body?: string;
  draftKind?: DraftKind;
  draftKey?: string;
}
interface RetainedDraft {
  key: string;
  body: string;
  kind: DraftKind;
  contextKey: string;
  context: ReviewContext;
}

const saved = (vscode.getState() ?? {}) as UiState;
const model = shallowRef<SidebarViewState>();
const changedFilesHeight = ref(saved.changedFilesHeight ?? 210);
const changedFilesExpanded = ref(saved.changedFilesExpanded ?? false);
const changedFilesContentMounted = ref(changedFilesExpanded.value);
const commitsExpanded = ref(saved.commitsExpanded ?? false);
const myWorkScrollTop = ref(saved.myWorkScrollTop ?? 0);
const commitSelection = ref(saved.commitSelection);
const replyDrafts = reactive<Record<string, string>>(saved.replyDrafts ?? {});
const editDrafts = reactive<Record<string, string>>(saved.editDrafts ?? {});
const editingComments = reactive<Record<string, boolean>>(saved.editingComments ?? {});
const collapsedThreads = reactive<Record<string, boolean>>(saved.collapsedThreads ?? {});
const overviewThreadDrafts = reactive<Record<string, string>>(saved.overviewThreadDrafts ?? {});
const overviewThreadModes = reactive<Record<string, ReviewSubmissionMode>>(saved.overviewThreadModes ?? {});
const threadSearchQuery = ref("");
const threadSearchOpen = ref(false);
const threadSearchInput = ref<HTMLInputElement>();
const changedFileSearchInput = ref<HTMLInputElement>();
const changedFileQuery = ref("");
const changedFileFilter = ref<"all" | "new" | "unresolved" | "local">("all");
const resolvedByThread = new Map<string, boolean>();
const requestedThreadDetails = new Set<string>();
const pendingMutations = reactive<Record<string, ReviewMutationRecord>>({});
const failedMutations = reactive<Record<string, ReviewMutationRecord>>({});
const mutationErrors = reactive<Record<string, string>>({});
const copiedRetainedDraftKey = ref<string>();
let loadedMrKey = "";
let readyRetry: number | undefined;
let pendingRevealThreadId: string | undefined;
let overviewComposerRevealFrame: number | undefined;
let retainedDraftCopyTimer: number | undefined;

const overview = computed(() => model.value?.overview);
const threadDetailsById = computed(() => new Map((model.value?.threadDetails ?? []).map((thread) => [thread.id, thread])));
const activeTab = computed(() => model.value?.activeTab ?? "review");
const attentionCount = computed(() => model.value?.myWork.attentionCount ?? 0);
const branchTree = computed(() => buildBranchTree(model.value?.branchTree.entries ?? []));
const reviewContext = computed(() => overview.value?.reviewContext);
const mrKey = computed(() => {
  const selected = overview.value?.selectedMergeRequest;
  return reviewContext.value
    ? reviewContextKey(reviewContext.value)
    : selected ? `selection:${selected.projectId}!${selected.iid}` : "";
});
const reviewScopeKey = computed(() => reviewContext.value ? reviewContextKey(reviewContext.value) : "");
const retainedDrafts = computed<RetainedDraft[]>(() => {
    const retained: RetainedDraft[] = [];
    const collect = (drafts: Record<string, string>, kind: DraftKind): void => {
      for (const [key, body] of Object.entries(drafts)) {
        if (typeof body !== "string" || !body.trim()) continue;
        const parsed = parseDraftContext(key);
      if (!parsed || parsed.contextKey === reviewScopeKey.value) continue;
      retained.push({ key, body, kind, ...parsed });
    }
  };
  collect(overviewThreadDrafts, "overview");
  collect(replyDrafts, "reply");
  collect(editDrafts, "edit");
  return retained;
});
const overviewThreadDraft = computed({
  get: () => {
    const key = overviewDraftKey();
    return key ? overviewThreadDrafts[key] ?? "" : "";
  },
  set: (value: string) => {
    const key = overviewDraftKey();
    if (key) overviewThreadDrafts[key] = value;
  }
});
const overviewThreadMode = computed<ReviewSubmissionMode>(() => {
  const key = overviewDraftKey();
  return (key ? overviewThreadModes[key] : undefined) ?? "comment";
});
const reviewSubmissionPending = computed(() => overview.value?.draftNotes.some((draft) => draft.pending) ?? false);
const nextUnresolvedThread = computed(() => overview.value?.threads.find((thread) => !thread.resolved && thread.resolvable !== false));
const normalizedThreadSearchQuery = computed(() => threadSearchQuery.value.trim().toLocaleLowerCase());
const filteredThreads = computed(() => {
  const threads = overview.value?.threads ?? [];
  const query = normalizedThreadSearchQuery.value;
  if (!query) return threads;
  return threads.filter((thread) => thread.searchText.toLocaleLowerCase().includes(query));
});
const selectedCommitId = computed(() => {
  const selection = commitSelection.value;
  return selection?.mrKey === mrKey.value ? selection.commitId : "all";
});
const selectedCommitDiffMatches = computed(() => {
  const commitId = selectedCommitId.value;
  return commitId !== "all" && Boolean(model.value)
    && isCommitDiffForSelection(model.value!.commitDiff, mrKey.value, commitId);
});
const changedFiles = computed(() => overview.value?.files ?? []);
const changedFileLimit = ref(200);
const normalizedChangedFileQuery = computed(() => changedFileQuery.value.trim().toLocaleLowerCase());
const filteredChangedFiles = computed(() => {
  const query = normalizedChangedFileQuery.value;
  return changedFiles.value.filter((file) => {
    if (query && !file.path.toLocaleLowerCase().includes(query)) return false;
    if (changedFileFilter.value === "new" && !file.newSinceLastReview) return false;
    if (changedFileFilter.value === "unresolved" && file.unresolvedThreadCount === 0) return false;
    if (changedFileFilter.value === "local" && !file.hasLocalEdit) return false;
    return true;
  });
});
const visibleChangedFiles = computed(() => filteredChangedFiles.value.slice(0, changedFileLimit.value));
const changedFileTree = computed(() => compactChangedFileTree(buildChangedFileTree(visibleChangedFiles.value)));
const commitFileLimit = ref(200);
const visibleCommitFiles = computed(() => (model.value?.commitDiff.files ?? []).slice(0, commitFileLimit.value));
const localWorkspace = computed(() => model.value?.localWorkspace);
const localTarget = computed(() => localWorkspace.value?.target);
const localTargetBranch = computed(() => {
  const target = localTarget.value;
  return target && "branch" in target ? target.branch : overview.value?.sourceBranch ?? "";
});
const localTargetLabel = computed(() => {
  switch (localTarget.value?.kind) {
    case "current-workspace": return "Current workspace";
    case "existing-worktree": return "Existing worktree";
    case "local-branch": return "Local branch";
    case "remote-only": return "Remote only";
    case "different-repository": return "Different repository";
    case "missing": return "Not available locally";
    default: return "Checking local state";
  }
});
const localTargetTone = computed(() => {
  switch (localTarget.value?.kind) {
    case "current-workspace": return "success" as const;
    case "existing-worktree": return "info" as const;
    case "local-branch": return "brand" as const;
    case "remote-only": return "warning" as const;
    case "different-repository": return "danger" as const;
    default: return "neutral" as const;
  }
});
const localDirtyLabel = computed(() => {
  const dirty = localWorkspace.value?.dirty.total ?? 0;
  return dirty === 0 ? "Clean" : `${dirty} uncommitted change${dirty === 1 ? "" : "s"}`;
});
const localActionLabel = computed(() => {
  switch (localTarget.value?.kind) {
    case "existing-worktree": return "Open worktree";
    case "remote-only": return "Open locally";
    case "local-branch": return (localWorkspace.value?.dirty.total ?? 0) > 0 ? "New worktree" : "Switch";
    default: return "";
  }
});

function post(message: SidebarMessage): void { vscode.postMessage(message); }

function parseDraftContext(key: string): { contextKey: string; context: ReviewContext } | undefined {
  try {
    const draftParts = JSON.parse(key) as unknown;
    if (!Array.isArray(draftParts) || typeof draftParts[0] !== "string") return undefined;
    const contextParts = JSON.parse(draftParts[0]) as unknown;
    if (!Array.isArray(contextParts)
      || typeof contextParts[0] !== "string"
      || typeof contextParts[1] !== "string"
      || typeof contextParts[2] !== "number"
      || typeof contextParts[3] !== "string"
      || typeof contextParts[4] !== "string"
      || typeof contextParts[5] !== "string") return undefined;
    return {
      contextKey: draftParts[0],
      context: {
        instanceUrl: contextParts[0],
        projectId: contextParts[1],
        mergeRequestIid: contextParts[2],
        baseSha: contextParts[3],
        startSha: contextParts[4],
        headSha: contextParts[5],
        ...(typeof contextParts[6] === "string" ? { currentUserId: contextParts[6] } : {})
      }
    };
  } catch {
    return undefined;
  }
}

function scopedKey(kind: string, ...parts: string[]): string {
  const contextKey = reviewScopeKey.value;
  return contextKey ? JSON.stringify([contextKey, kind, ...parts]) : "";
}
function overviewDraftKey(): string { return scopedKey("overview-draft"); }
function replyDraftKey(threadId: string): string { return scopedKey("reply-draft", threadId); }
function commentKey(threadId: string, commentId: string): string { return scopedKey("edit-draft", threadId, commentId); }
function mutationSlot(kind: string, ...parts: string[]): string {
  return scopedKey("mutation", kind, ...parts) || JSON.stringify(["no-review-context", kind, ...parts]);
}
function isMutationPending(slot: string): boolean { return Boolean(pendingMutations[slot]); }
function mutationError(slot: string): string | undefined { return mutationErrors[slot]; }
function mutationSlotMatches(slot: string, kind: string, parts: string[]): boolean {
  try {
    const parsed = JSON.parse(slot) as unknown[];
    return parsed[0] === reviewScopeKey.value
      && parsed[1] === "mutation"
      && parsed[2] === kind
      && parts.every((part, index) => parsed[index + 3] === part);
  } catch {
    return false;
  }
}
function isMutationPendingFor(kind: string, ...parts: string[]): boolean {
  return Object.keys(pendingMutations).some((slot) => mutationSlotMatches(slot, kind, parts));
}
function failedMutationSlotFor(kind: string, ...parts: string[]): string | undefined {
  return Object.keys(failedMutations).find((slot) => mutationSlotMatches(slot, kind, parts));
}
function mutationErrorFor(kind: string, ...parts: string[]): string | undefined {
  const slot = failedMutationSlotFor(kind, ...parts);
  return slot ? mutationErrors[slot] : undefined;
}
function retryMutationFor(kind: string, ...parts: string[]): void {
  const slot = failedMutationSlotFor(kind, ...parts);
  if (slot) retryMutation(slot);
}
function reviewRequest(payload: SidebarMutationPayload, context: ReviewContext): ReviewMutationEnvelope {
  const message = createReviewMutationRequest(payload, context);
  if (!message) throw new Error("The current review context is unavailable.");
  return message;
}
function postReviewAction(payload: SidebarMutationPayload): void {
  const context = reviewContext.value;
  if (!context) return;
  post(reviewRequest(payload, context) as SidebarMessage);
}

interface ReviewMutationOptions {
  body?: string;
  draftKind?: DraftKind;
  draftKey?: string;
}

function sendReviewMutation(slot: string, build: ReviewMutationBuilder, options: ReviewMutationOptions = {}): boolean {
  if (pendingMutations[slot]) return false;
  const context = reviewContext.value;
  const contextKey = reviewScopeKey.value;
  if (!context || !contextKey) {
    mutationErrors[slot] = "The current review is not ready yet. Open the review and try again.";
    return false;
  }
  const message = build(context, options.body);
  pendingMutations[slot] = {
    slot,
    requestId: message.requestId,
    context,
    contextKey,
    build,
    body: options.body,
    draftKind: options.draftKind,
    draftKey: options.draftKey
  };
  delete failedMutations[slot];
  delete mutationErrors[slot];
  post(message as SidebarMessage);
  return true;
}

function draftValue(record: ReviewMutationRecord): string | undefined {
  if (!record.draftKey || !record.draftKind) return record.body;
  if (record.draftKind === "reply") return replyDrafts[record.draftKey];
  if (record.draftKind === "edit") return editDrafts[record.draftKey];
  return overviewThreadDrafts[record.draftKey];
}

function clearSubmittedDraft(record: ReviewMutationRecord): void {
  if (!record.draftKey || !record.draftKind || record.body === undefined) return;
  if (record.draftKind === "reply" && replyDrafts[record.draftKey] === record.body) {
    delete replyDrafts[record.draftKey];
  } else if (record.draftKind === "edit" && editDrafts[record.draftKey] === record.body) {
    delete editDrafts[record.draftKey];
    delete editingComments[record.draftKey];
  } else if (record.draftKind === "overview" && overviewThreadDrafts[record.draftKey] === record.body) {
    delete overviewThreadDrafts[record.draftKey];
    delete overviewThreadModes[record.draftKey];
  }
}

function retryMutation(slot: string): void {
  const failed = failedMutations[slot];
  if (!failed) return;
  if (reviewScopeKey.value !== failed.contextKey) {
    mutationErrors[slot] = "The selected review changed. Return to the original review before retrying.";
    return;
  }
  const body = draftValue(failed);
  if (failed.draftKey && !body?.trim()) {
    mutationErrors[slot] = "The draft is empty. Add text before retrying.";
    return;
  }
  sendReviewMutation(slot, failed.build, {
    body,
    draftKind: failed.draftKind,
    draftKey: failed.draftKey
  });
}

function handleReviewMutationResult(message: ReviewMutationHostMessage): void {
  const entry = Object.entries(pendingMutations).find(([, record]) => record.requestId === message.requestId);
  if (!entry) return;
  const [slot, record] = entry;
  delete pendingMutations[slot];
  if (message.ok) {
    delete failedMutations[slot];
    delete mutationErrors[slot];
    clearSubmittedDraft(record);
  } else {
    failedMutations[slot] = record;
    mutationErrors[slot] = message.errorMessage || "Could not save the review change.";
  }
  persist();
}

async function copyRetainedDraft(draft: RetainedDraft): Promise<void> {
  const textarea = document.querySelector<HTMLTextAreaElement>(`[data-retained-draft-key="${CSS.escape(draft.key)}"]`);
  textarea?.focus();
  textarea?.select();
  try {
    await navigator.clipboard?.writeText(draft.body);
  } catch {
    // Selecting the read-only field still provides a recovery path when the
    // Webview clipboard API is unavailable.
  }
  copiedRetainedDraftKey.value = draft.key;
  if (retainedDraftCopyTimer !== undefined) window.clearTimeout(retainedDraftCopyTimer);
  retainedDraftCopyTimer = window.setTimeout(() => {
    copiedRetainedDraftKey.value = undefined;
    retainedDraftCopyTimer = undefined;
  }, 1600);
}

function persist(): void {
  vscode.setState({
    changedFilesHeight: changedFilesHeight.value,
    changedFilesExpanded: changedFilesExpanded.value,
    commitsExpanded: commitsExpanded.value,
    commitSelection: commitSelection.value,
    replyDrafts: { ...replyDrafts },
    editDrafts: { ...editDrafts },
    editingComments: { ...editingComments },
    collapsedThreads: { ...collapsedThreads },
    overviewThreadDrafts: { ...overviewThreadDrafts },
    overviewThreadModes: { ...overviewThreadModes },
    myWorkScrollTop: myWorkScrollTop.value
  });
}
function toggleChangedFiles(): void {
  if (!changedFilesExpanded.value) changedFilesContentMounted.value = true;
  changedFilesExpanded.value = !changedFilesExpanded.value;
  persist();
}
function clearChangedFileSearch(): void {
  changedFileQuery.value = "";
  void nextTick(() => changedFileSearchInput.value?.focus());
}
function toggleCommits(): void {
  commitsExpanded.value = !commitsExpanded.value;
  persist();
}
function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
function isEditing(threadId: string, commentId: string): boolean { return editingComments[commentKey(threadId, commentId)] === true; }
function startEdit(threadId: string, comment: ReviewComment): void {
  const key = commentKey(threadId, comment.id);
  if (!key) return;
  editDrafts[key] = comment.body;
  editingComments[key] = true;
  persist();
}
function cancelEdit(threadId: string, commentId: string): void {
  const key = commentKey(threadId, commentId);
  if (!key) return;
  delete editDrafts[key];
  delete editingComments[key];
  persist();
}
function saveEdit(threadId: string, commentId: string): void {
  const key = commentKey(threadId, commentId);
  if (!key) return;
  const body = editDrafts[key] ?? "";
  if (!body.trim()) return;
  const slot = mutationSlot("edit-comment", threadId, commentId);
  sendReviewMutation(slot, (context, submittedBody) => reviewRequest({ type: "editComment", threadId, commentId, body: submittedBody ?? "" }, context), {
    body,
    draftKind: "edit",
    draftKey: key
  });
}
function sendReply(threadId: string): void {
  const key = replyDraftKey(threadId);
  if (!key) return;
  const body = replyDrafts[key] ?? "";
  if (!body.trim()) return;
  const slot = mutationSlot("reply", threadId);
  sendReviewMutation(slot, (context, submittedBody) => reviewRequest({ type: "addComment", threadId, body: submittedBody ?? "" }, context), {
    body,
    draftKind: "reply",
    draftKey: key
  });
}
function addOverviewThread(): void {
  const body = overviewThreadDraft.value;
  if (!body.trim()) return;
  const key = overviewDraftKey();
  if (!key) return;
  const mode = overviewThreadMode.value;
  const slot = mutationSlot("overview-thread");
  sendReviewMutation(slot, (context, submittedBody) => reviewRequest({ type: "addOverviewThread", body: submittedBody ?? "", mode }, context), {
    body,
    draftKind: "overview",
    draftKey: key
  });
}
function scheduleOverviewComposerReveal(): void {
  if (overviewComposerRevealFrame !== undefined) return;
  overviewComposerRevealFrame = window.requestAnimationFrame(() => {
    overviewComposerRevealFrame = undefined;
    const form = document.querySelector<HTMLElement>(".new-thread-form");
    const footer = form?.querySelector<HTMLElement>("footer");
    const tray = document.querySelector<HTMLElement>(".review-submit-tray");
    if (!footer || !tray) return;

    const spacing = Number.parseFloat(getComputedStyle(tray).getPropertyValue("--gl-spacing-8"));
    const footerBounds = footer.getBoundingClientRect();
    const trayTop = tray.getBoundingClientRect().top;
    const overlap = footerBounds.bottom - (trayTop - (Number.isFinite(spacing) ? spacing : 0));
    if (overlap <= 0) return;

    const scrollingElement = document.scrollingElement;
    if (!scrollingElement) return;
    const maxScrollTop = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
    const nextScrollTop = Math.min(scrollingElement.scrollTop + overlap, maxScrollTop);
    if (nextScrollTop > scrollingElement.scrollTop) scrollingElement.scrollTop = nextScrollTop;
  });
}
function updateOverviewThreadDraft(value: string): void {
  overviewThreadDraft.value = value;
  persist();
  scheduleOverviewComposerReveal();
}
function setOverviewThreadMode(mode: ReviewSubmissionMode): void {
  const key = overviewDraftKey();
  if (!key) return;
  overviewThreadModes[key] = mode;
  persist();
  post({ type: "setSubmissionMode", mode });
  scheduleOverviewComposerReveal();
}
function openThread(thread: ReviewThreadSummary): void {
  if (thread.filePath) postReviewAction({ type: "openFile", filePath: thread.filePath, line: thread.line, threadId: thread.id });
}
function toggleResolved(threadId: string): void {
  sendReviewMutation(mutationSlot("resolve", threadId), (context) => reviewRequest({ type: "toggleResolved", threadId }, context));
}
function loadCommentReactions(threadId: string, commentId: string): void {
  postReviewAction({ type: "loadCommentReactions", threadId, commentId });
}
function toggleCommentReaction(threadId: string, commentId: string, name: string): void {
  sendReviewMutation(mutationSlot("reaction", threadId, commentId, name), (context) => reviewRequest({ type: "toggleCommentReaction", threadId, commentId, name }, context));
}
function publishReviewDraft(draftId: string): void {
  sendReviewMutation(mutationSlot("publish-draft", draftId), (context) => reviewRequest({ type: "publishReviewDraft", draftId }, context));
}
function submitReview(): void {
  sendReviewMutation(mutationSlot("submit-review"), (context) => reviewRequest({ type: "submitReview" }, context));
}
function collapseKey(thread: ReviewThreadSummary): string {
  return threadCollapseKey(mrKey.value || "no-merge-request", thread.id);
}
function isThreadCollapsed(thread: ReviewThreadSummary): boolean {
  return collapsedThreads[collapseKey(thread)] ?? (thread.resolved || (overview.value?.threads.length ?? 0) > 20);
}
function toggleThread(thread: ReviewThreadSummary): void {
  const collapsed = !isThreadCollapsed(thread);
  collapsedThreads[collapseKey(thread)] = collapsed;
  if (collapsed) requestedThreadDetails.delete(thread.id);
  else requestedThreadDetails.add(thread.id);
  persist();
  post({ type: "setThreadExpanded", threadId: thread.id, expanded: !collapsed });
}
function threadPanelId(thread: ReviewThreadSummary): string {
  return threadContentId("sidebar", mrKey.value || "no-merge-request", thread.id);
}
function lastComment(thread: ReviewThreadSummary): ReviewThreadSummary["lastComment"] { return thread.lastComment; }
function replyCount(thread: ReviewThreadSummary): number { return Math.max(0, thread.commentCount - 1); }
function relativeReplyTime(thread: ReviewThreadSummary): string { return formatRelativeReplyTime(lastComment(thread)?.createdAt); }
function threadLocation(thread: ReviewThreadSummary): string {
  return thread.filePath ? `${thread.filePath}${thread.line ? `:${thread.line}` : ""}` : "MR overview";
}
function threadSearchExcerpt(thread: ReviewThreadSummary): string {
  const query = normalizedThreadSearchQuery.value;
  if (!query) return "";
  const text = thread.searchText.replace(/\s+/g, " ").trim();
  const matchIndex = text.toLocaleLowerCase().indexOf(query);
  if (matchIndex < 0) return "";
  const start = Math.max(0, matchIndex - 36);
  const end = Math.min(text.length, matchIndex + query.length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
async function revealThread(threadId: string): Promise<void> {
  pendingRevealThreadId = threadId;
  const thread = overview.value?.threads.find((candidate) => candidate.id === threadId);
  if (!thread || activeTab.value !== "review") return;
  threadSearchQuery.value = "";
  threadSearchOpen.value = false;
  collapsedThreads[collapseKey(thread)] = false;
  requestedThreadDetails.add(thread.id);
  persist();
  post({ type: "setThreadExpanded", threadId: thread.id, expanded: true });
  await nextTick();
  const element = Array.from(document.querySelectorAll<HTMLElement>("[data-review-thread-id]"))
    .find((candidate) => candidate.dataset.reviewThreadId === threadId);
  if (!element) return;
  pendingRevealThreadId = undefined;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
}
async function toggleThreadSearch(): Promise<void> {
  if (threadSearchOpen.value) {
    threadSearchQuery.value = "";
    threadSearchOpen.value = false;
    return;
  }
  threadSearchOpen.value = true;
  await nextTick();
  threadSearchInput.value?.focus();
}
function closeThreadSearchFromKeyboard(): void {
  threadSearchQuery.value = "";
  threadSearchOpen.value = false;
  void nextTick(() => document.querySelector<HTMLButtonElement>(".thread-search-control button")?.focus());
}
function reconcileThreads(threads: readonly ReviewThreadSummary[]): void {
  let changed = false;
  for (const thread of threads) {
    const key = collapseKey(thread);
    const next = reconcileThreadCollapsed(thread.resolved, {
      collapsed: collapsedThreads[key],
      previousResolved: resolvedByThread.get(key)
    });
    if (collapsedThreads[key] !== next) {
      collapsedThreads[key] = next;
      changed = true;
    }
    resolvedByThread.set(key, thread.resolved);
  }
  if (changed) persist();
}
function selectCommit(commitId: string): void {
  commitFileLimit.value = 200;
  const alreadySelected = selectedCommitId.value === commitId;
  if (commitId !== "all" && alreadySelected) {
    commitSelection.value = { mrKey: mrKey.value, commitId: "all" };
    persist();
    if (model.value?.commitDiff.phase !== "hidden") post({ type: "collapseCommit" });
    return;
  }
  commitSelection.value = { mrKey: mrKey.value, commitId };
  persist();
  if (commitId === "all") {
    if (model.value?.commitDiff.phase !== "hidden") post({ type: "collapseCommit" });
    return;
  }
  post({ type: "toggleCommit", commitId });
}
function currentCommitId(): string {
  return selectedCommitId.value;
}
function openChangedFile(path: string): void {
  postReviewAction({ type: "openFile", filePath: path });
}
function openNextUnresolved(): void {
  const next = nextUnresolvedThread.value;
  if (!next) return;
  if (next.filePath) {
    postReviewAction({ type: "openFile", filePath: next.filePath, line: next.line ?? next.newLine, threadId: next.id });
    return;
  }
  void revealThread(next.id);
}
function openLatestChanges(): void {
  const activeFile = changedFiles.value.find((file) => file.path === model.value?.activeFilePath);
  const filePath = (activeFile?.newSinceLastReview ? activeFile.path : undefined)
    ?? changedFiles.value.find((file) => file.newSinceLastReview)?.path
    ?? changedFiles.value[0]?.path;
  if (filePath) postReviewAction({ type: "openNewChangesFile", filePath });
}
function openLocalTarget(): void {
  const target = localTarget.value;
  if (!target) return;
  if (target.kind === "existing-worktree") {
    post({ type: "openExistingWorktree", path: target.path });
  } else if (target.kind === "local-branch") {
    if ((localWorkspace.value?.dirty.total ?? 0) > 0) {
      post({ type: "createWorktree", branch: target.branch });
    } else {
      post({ type: "switchCurrentWorkspace", branch: target.branch });
    }
  } else if (target.kind === "remote-only") {
    post({ type: "showRemoteBranchInstructions" });
  }
}
function beginResize(event: PointerEvent): void {
  event.preventDefault();
  const startY = event.clientY;
  const start = changedFilesHeight.value;
  const move = (next: PointerEvent) => { changedFilesHeight.value = Math.max(110, Math.round(start + next.clientY - startY)); };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    persist();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
}
function onResizerKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 40 : 16;
  if (event.key === "ArrowUp") {
    event.preventDefault();
    changedFilesHeight.value = Math.max(110, changedFilesHeight.value - step);
    persist();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    changedFilesHeight.value = Math.min(640, changedFilesHeight.value + step);
    persist();
  } else if (event.key === "Home") {
    event.preventDefault();
    changedFilesHeight.value = 110;
    persist();
  } else if (event.key === "End") {
    event.preventDefault();
    changedFilesHeight.value = 640;
    persist();
  }
}
function selectSidebarTab(tab: "review" | "my-work"): void {
  post({ type: "setSidebarTab", tab });
}
function updateMyWorkScrollPosition(value: number): void {
  myWorkScrollTop.value = value;
  persist();
}
function openMyWorkMergeRequest(item: MyWorkMergeRequest): void {
  persist();
  post({ type: "openMyWorkMergeRequest", projectId: item.projectId, iid: item.iid });
}
function setThreadSort(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "open-first" || value === "oldest" || value === "newest") {
    post({ type: "setThreadSort", order: value satisfies ReviewThreadSortOrder });
  }
}
function receiveState(event: MessageEvent<HostMessage<SidebarViewState, SidebarHostMessage>>): void {
  const message = event.data;
  if (isReviewMutationResult(message)) {
    handleReviewMutationResult(message);
    return;
  }
  if (message.type === "revealThread") {
    void revealThread(message.threadId);
    return;
  }
  if (handleCommentImageMessage(message)) return;
  if (message.type !== "state") return;
  stopReadyRetry();
  const selected = message.state.overview.selectedMergeRequest;
  const nextMrKey = message.state.overview.reviewContext
    ? reviewContextKey(message.state.overview.reviewContext)
    : selected ? `selection:${selected.projectId}!${selected.iid}` : "";
  if (nextMrKey !== loadedMrKey) {
    loadedMrKey = nextMrKey;
    threadSearchQuery.value = "";
    threadSearchOpen.value = false;
    changedFileQuery.value = "";
    changedFileFilter.value = "all";
    changedFileLimit.value = 200;
    commitFileLimit.value = 200;
    requestedThreadDetails.clear();
  }
  model.value = message.state;
  reconcileThreads(message.state.overview.threads);
  const availableDetails = new Set(message.state.threadDetails.map((thread) => thread.id));
  for (const threadId of availableDetails) requestedThreadDetails.delete(threadId);
  for (const thread of message.state.overview.threads) {
    if (isThreadCollapsed(thread) || availableDetails.has(thread.id) || requestedThreadDetails.has(thread.id)) continue;
    requestedThreadDetails.add(thread.id);
    post({ type: "setThreadExpanded", threadId: thread.id, expanded: true });
  }
  const normalized = normalizeCommitFilter(
    mrKey.value,
    message.state.overview.commits.map((commit) => commit.id),
    commitSelection.value
  );
  if (normalized !== commitSelection.value) {
    commitSelection.value = normalized;
    persist();
  }
  if (normalized.commitId === "all") {
    if (message.state.commitDiff.phase !== "hidden") post({ type: "collapseCommit" });
  } else if (!isCommitDiffForSelection(message.state.commitDiff, mrKey.value, normalized.commitId)) {
    post({ type: "toggleCommit", commitId: normalized.commitId });
  }
  if (pendingRevealThreadId) void revealThread(pendingRevealThreadId);
}
function requestInitialState(): void { post({ type: "ready" }); }
function stopReadyRetry(): void {
  if (readyRetry === undefined) return;
  window.clearInterval(readyRetry);
  readyRetry = undefined;
}

window.addEventListener("message", receiveState);
onMounted(() => {
  readyRetry = window.setInterval(requestInitialState, 500);
  requestInitialState();
});
onBeforeUnmount(() => {
  stopReadyRetry();
  if (overviewComposerRevealFrame !== undefined) {
    window.cancelAnimationFrame(overviewComposerRevealFrame);
    overviewComposerRevealFrame = undefined;
  }
  if (retainedDraftCopyTimer !== undefined) {
    window.clearTimeout(retainedDraftCopyTimer);
    retainedDraftCopyTimer = undefined;
  }
  for (const key of Object.keys(pendingMutations)) delete pendingMutations[key];
  for (const key of Object.keys(failedMutations)) delete failedMutations[key];
  for (const key of Object.keys(mutationErrors)) delete mutationErrors[key];
  window.removeEventListener("message", receiveState);
});
</script>

<template>
  <main class="sidebar-shell" :style="{ '--changed-height': `${changedFilesHeight}px` }">
    <div v-if="model?.auth.phase === 'available'" class="auth-compact">
      <span class="auth-identity" :title="`GitLab CLI: ${model.auth.hostname}`">
        <span class="auth-dot" aria-hidden="true" />
        <span>{{ model.auth.hostname }}</span>
      </span>
      <span class="top-toolbar" aria-label="GitLab actions">
        <GlIconButton v-if="activeTab === 'review'" icon="retry" label="Reload merge request" :loading="overview?.isRefreshing" @click="post({ type: 'refreshReview' })" />
        <GlIconButton icon="account" label="Refresh GitLab login" @click="post({ type: 'refreshAuth' })" />
      </span>
    </div>
    <div v-else-if="model" class="auth-prompt">
      <GlIcon name="account" />
      <span>{{ model.auth.phase === "checking" ? "Checking glab" : model.auth.phase === "signedOut" ? "Sign in to GitLab" : "glab unavailable. Check CLI setup, then retry." }}</span>
      <GlButton v-if="model.auth.phase === 'signedOut'" size="small" variant="confirm" @click="post({ type: 'login' })">Sign in</GlButton>
      <GlButton v-else-if="model.auth.phase === 'unavailable'" icon="retry" size="small" @click="post({ type: 'refreshAuth' })">Retry</GlButton>
      <GlIconButton v-else icon="retry" label="Refresh GitLab login" size="small" @click="post({ type: 'refreshAuth' })" />
    </div>

    <SidebarTabs
      v-if="model?.auth.phase === 'available'"
      :active-tab="activeTab"
      :attention-count="attentionCount"
      @select="selectSidebarTab"
    />

    <div v-if="activeTab === 'my-work' && model?.auth.phase === 'available'" id="my-work-panel" role="tabpanel" aria-labelledby="my-work-tab">
      <MyWorkView
        :state="model.myWork"
        :initial-scroll-top="myWorkScrollTop"
        @refresh="post({ type: 'refreshMyWork' })"
        @open-mr="openMyWorkMergeRequest"
        @scroll-position="updateMyWorkScrollPosition"
      />
    </div>

    <GlEmptyState v-if="activeTab === 'review' && (!overview || overview.loadState === 'loading')" title="Loading merge request…" icon="spinner" />
    <GlEmptyState
      v-else-if="activeTab === 'review' && overview?.loadState === 'error'"
      :title="overview.errorMessage || 'Could not load merge request'"
      description="Refresh the merge request to try again."
      icon="warning"
    >
      <template #actions><GlButton icon="retry" @click="post({ type: 'refreshReview' })">Retry</GlButton></template>
    </GlEmptyState>
    <GlEmptyState
      v-else-if="activeTab === 'review' && overview && (overview.loadState === 'empty' || !overview.selectedMergeRequest)"
      title="No merge request selected"
      description="Open My work to choose a merge request to review."
      icon="information"
    >
      <template #actions><GlButton variant="confirm" @click="selectSidebarTab('my-work')">Open My work</GlButton></template>
    </GlEmptyState>

    <div
      v-else-if="activeTab === 'review' && overview?.loadState === 'ready' && overview.selectedMergeRequest"
      id="review-panel"
      role="tabpanel"
      aria-labelledby="review-tab"
      class="review-loaded"
      :class="{ 'branch-open': model?.branchTree.phase !== 'hidden' }"
    >
      <div v-if="overview.isRefreshing" class="review-status-banner" role="status">
        <GlIcon name="spinner" class="spin" :size="13" />
        <span>Refreshing merge request… Showing cached review until it finishes.</span>
      </div>
      <div v-else-if="overview.errorMessage" class="review-status-banner is-danger" role="alert">
        <GlIcon name="warning" :size="13" />
        <span>Refresh failed. Showing cached review. {{ overview.errorMessage }}</span>
      </div>
      <section v-if="retainedDrafts.length" class="retained-drafts" aria-label="Drafts from previous review revision">
        <header class="retained-drafts-header">
          <span><GlIcon name="warning" :size="12" />Drafts from a previous review revision</span>
          <small>Review and copy before continuing.</small>
        </header>
        <article v-for="draft in retainedDrafts" :key="draft.key" class="retained-draft">
          <div class="retained-draft-meta">
            <strong>{{ draft.kind === "overview" ? "New comment" : draft.kind === "reply" ? "Reply" : "Edited comment" }}</strong>
            <span>{{ draft.context.instanceUrl }} · {{ draft.context.projectId }}!{{ draft.context.mergeRequestIid }}</span>
            <code :title="draft.context.headSha">{{ draft.context.headSha }}</code>
          </div>
          <textarea
            :data-retained-draft-key="draft.key"
            class="retained-draft-text"
            :aria-label="`Previous ${draft.kind} draft for ${draft.context.projectId}!${draft.context.mergeRequestIid}`"
            readonly
            :value="draft.body"
          />
          <GlButton variant="link" size="small" @click="copyRetainedDraft(draft)">{{ copiedRetainedDraftKey === draft.key ? "Copied" : "Copy draft" }}</GlButton>
        </article>
      </section>
      <header class="mr-header">
        <div class="mr-main">
          <span class="review-context-label"><GlIcon name="comments" :size="12" />Review · Remote</span>
          <div class="mr-title-row">
            <GlStatusBadge :status="overview.selectedMergeRequest.state" />
            <h1>{{ overview.title }}</h1>
          </div>
          <div class="mr-meta">
            <strong>!{{ overview.selectedMergeRequest.iid }}</strong>
            <span>by {{ overview.author }}</span>
          </div>
          <GlReviewerList :reviewers="overview.reviewers" />
        </div>

        <div class="branch-flow" aria-label="Merge request branches">
          <button type="button" @click="post({ type: 'toggleBranchTree', branch: overview.sourceBranch })">
            <GlIcon name="branch" :size="14" />
            <GlTechnicalIdentifier :value="overview.sourceBranch" :tail-length="29" />
          </button>
          <GlIcon name="arrow-right" :size="14" />
          <button type="button" @click="post({ type: 'toggleBranchTree', branch: overview.targetBranch })">
            <GlIcon name="branch" :size="14" />
            <GlTechnicalIdentifier :value="overview.targetBranch" :tail-length="29" />
          </button>
        </div>

        <div class="mr-summary" aria-label="Merge request summary">
          <span><strong>{{ overview.files.length }}</strong> files</span>
          <span><strong>{{ overview.totalComments }}</strong> comments</span>
          <span><strong>{{ overview.commits.length }}</strong> commits</span>
          <span><strong>{{ overview.resolvedThreads }}/{{ overview.resolvedThreads + overview.unresolvedThreads }}</strong> resolved</span>
        </div>
      </header>

      <section class="local-workspace" aria-label="Local workspace" :title="localWorkspace?.repositoryRoot">
        <div class="local-workspace-row">
          <span class="local-workspace-title"><GlIcon name="branch" :size="13" /><strong>Local</strong></span>
          <span v-if="localWorkspace?.phase === 'loading'" class="local-state-message">
            <GlIcon name="spinner" class="spin" :size="12" />Checking
          </span>
          <template v-else>
            <code class="local-current-branch">{{ localWorkspace?.currentBranch || 'detached HEAD' }}</code>
            <GlBadge :tone="localTargetTone">{{ localTargetLabel }}</GlBadge>
            <span class="local-dirty" :class="{ 'is-dirty': (localWorkspace?.dirty.total ?? 0) > 0 }">
              <span class="local-status-dot" aria-hidden="true" />{{ localDirtyLabel }}
            </span>
          </template>
          <GlButton
            v-if="localActionLabel"
            class="local-primary-action"
            size="small"
            :icon="localTarget?.kind === 'existing-worktree' ? 'external-link' : 'branch'"
            @click="openLocalTarget"
          >{{ localActionLabel }}</GlButton>
          <GlIconButton icon="retry" label="Refresh local Git state" size="small" @click="post({ type: 'refreshLocalWorkspace' })" />
        </div>
        <p v-if="localWorkspace?.errorMessage" class="local-state-message is-danger"><GlIcon name="warning" :size="12" />{{ localWorkspace.errorMessage }}</p>
        <p v-else-if="localTarget?.kind === 'different-repository'" class="local-help">This workspace points to a different repository.</p>
        <p v-else-if="localTarget?.kind === 'missing'" class="local-help">No matching local or remote branch is available.</p>
      </section>

      <GlSection v-if="model?.branchTree.phase !== 'hidden'" class="branch-explorer" :title="model?.branchTree.branch || 'Branch'" flush>
        <template #icon><GlIcon name="file-tree" /></template>
        <template #actions><GlIconButton icon="close" label="Close branch tree" size="small" @click="post({ type: 'closeBranchTree' })" /></template>
        <p v-if="model?.branchTree.phase === 'loading'" class="state-message"><GlIcon name="spinner" class="spin" /> Loading…</p>
        <p v-else-if="model?.branchTree.phase === 'error'" class="state-message is-danger">{{ model.branchTree.errorMessage }}</p>
        <div v-else class="tree">
          <TreeItem
            v-for="node in branchTree"
            :key="node.path"
            :node="node"
            kind="branch"
            :branch="model?.branchTree.branch"
            @open-branch="(branch, path) => postReviewAction({ type: 'openBranchFile', branch, filePath: path })"
            @open-changed="() => {}"
          />
        </div>
      </GlSection>

      <section class="changed-section collapsible-section">
        <button
          type="button"
          class="collapsible-section-header"
          :aria-expanded="changedFilesExpanded"
          aria-controls="changed-files-content"
          @click="toggleChangedFiles"
        >
          <span class="collapsible-section-title"><GlIcon name="file-tree" /><strong>Changed files</strong><span class="collapsible-section-count">{{ overview.files.length }}</span></span>
          <span class="collapsible-section-actions">
            <span class="diff-stats"><span class="gl-text-success">+{{ overview.additions }}</span><span class="gl-text-danger">−{{ overview.deletions }}</span></span>
            <GlIcon :name="changedFilesExpanded ? 'chevron-up' : 'chevron-down'" :size="14" />
          </span>
        </button>
        <Transition name="gl-collapse">
          <div
            v-if="changedFilesContentMounted"
            v-show="changedFilesExpanded"
            :key="mrKey"
            class="gl-collapse-shell"
          >
            <div id="changed-files-content" class="collapsible-section-content gl-collapse-content">
              <div v-if="changedFiles.length" class="changed-file-tools" role="search" aria-label="Changed file filters">
                <div class="changed-file-search">
                  <GlIcon name="search" :size="13" aria-hidden="true" />
                  <input
                    ref="changedFileSearchInput"
                    v-model="changedFileQuery"
                    class="gl-input"
                    type="search"
                    aria-label="Search changed files"
                    placeholder="Filter files…"
                    @keydown.esc="changedFileQuery = ''"
                  >
                  <GlIconButton v-if="changedFileQuery" icon="close" label="Clear changed file search" size="small" @click="clearChangedFileSearch" />
                </div>
                <select v-model="changedFileFilter" aria-label="Filter changed files by status">
                  <option value="all">All files</option>
                  <option value="new">New since review</option>
                  <option value="unresolved">Needs review</option>
                  <option value="local">Local edits</option>
                </select>
                <GlButton
                  v-if="overview.newChanges && changedFiles.length"
                  size="small"
                  icon="external-link"
                  title="Open the latest push in the native diff editor"
                  @click="openLatestChanges"
                >Latest push</GlButton>
                <span class="changed-file-result-count" aria-live="polite">
                  <span>{{ filteredChangedFiles.length }} {{ filteredChangedFiles.length === 1 ? "file" : "files" }}</span>
                  <span class="changed-file-result-help">Select a file to open its diff</span>
                </span>
              </div>
              <GlEmptyState
                v-if="!changedFiles.length"
                title="No changed files"
                icon="file"
                compact
              />
              <GlEmptyState
                v-else-if="!filteredChangedFiles.length"
                title="No files match this filter"
                description="Try a different path or status filter."
                icon="search"
                compact
              />
              <div v-else class="changed-scroll changed-tree-list" :class="{ scrollable: filteredChangedFiles.length > 4 }">
                <TreeItem
                  v-for="node in changedFileTree"
                  :key="node.path"
                  :node="node"
                  kind="changed"
                  :active-file-path="model?.activeFilePath"
                  @open-changed="openChangedFile"
                  @open-branch="() => {}"
                />
                <GlButton
                  v-if="visibleChangedFiles.length < filteredChangedFiles.length"
                  class="changed-load-more"
                  size="small"
                  @click="changedFileLimit += 200"
                >Show 200 more</GlButton>
              </div>
              <div
                v-if="filteredChangedFiles.length > 4"
                class="resizer"
                role="separator"
                aria-label="Resize changed files panel"
                aria-orientation="horizontal"
                aria-valuemin="110"
                aria-valuemax="640"
                :aria-valuenow="changedFilesHeight"
                tabindex="0"
                @pointerdown="beginResize"
                @keydown="onResizerKeydown"
              />
            </div>
          </div>
        </Transition>
      </section>

      <section class="commit-section collapsible-section">
        <button
          type="button"
          class="collapsible-section-header"
          :aria-expanded="commitsExpanded"
          aria-controls="commits-content"
          @click="toggleCommits"
        >
          <span class="collapsible-section-title"><GlIcon name="commit" /><strong>Commits</strong><span class="collapsible-section-count">{{ overview.commits.length }}</span></span>
          <GlIcon :name="commitsExpanded ? 'chevron-up' : 'chevron-down'" :size="14" />
        </button>
        <Transition name="gl-collapse">
          <div v-if="commitsExpanded" class="gl-collapse-shell">
            <div id="commits-content" class="collapsible-section-content gl-collapse-content">
              <div v-if="overview.commits.length" class="commit-filter-bar" aria-label="Commit filter">
                <button type="button" :class="{ active: currentCommitId() === 'all' }" :aria-pressed="currentCommitId() === 'all'" @click="selectCommit('all')">
                  <GlIcon name="file-tree" :size="13" />
                  <span>All changes</span>
                </button>
                <span class="commit-filter-help">Select a commit to inspect its native diff</span>
              </div>
              <GlEmptyState v-if="!overview.commits.length" title="No commits" icon="commit" compact />
              <div v-else class="commit-list" :class="{ expanded: model?.commitDiff.phase !== 'hidden' }">
                <article v-for="commit in overview.commits" :key="commit.id" class="commit-item">
                  <button
                    class="commit-row"
                    type="button"
                    :class="{ active: currentCommitId() === commit.id }"
                    :aria-pressed="currentCommitId() === commit.id"
                    :aria-expanded="currentCommitId() === commit.id && selectedCommitDiffMatches"
                    :aria-label="`${currentCommitId() === commit.id && selectedCommitDiffMatches ? 'Hide changes for' : 'Show changes for'} commit ${commit.shortId}: ${commit.title}`"
                    @click="selectCommit(commit.id)"
                  >
                    <span class="commit-dot" aria-hidden="true" />
                    <code>{{ commit.shortId }}</code>
                    <span class="gl-truncate">{{ commit.title }}</span>
                    <span class="commit-author gl-truncate">{{ commit.authorName }}</span>
                    <time>{{ formatDate(commit.committedAt) }}</time>
                    <span class="commit-row-action" aria-hidden="true">
                      <span class="commit-row-action-label">{{ currentCommitId() === commit.id && selectedCommitDiffMatches ? "Hide changes" : "Show changes" }}</span>
                      <GlIcon :name="currentCommitId() === commit.id && selectedCommitDiffMatches ? 'chevron-up' : 'chevron-down'" :size="14" />
                    </span>
                  </button>
                  <Transition name="gl-collapse">
                    <div v-if="currentCommitId() === commit.id && selectedCommitDiffMatches" class="commit-detail-shell gl-collapse-shell">
                      <div class="commit-detail gl-collapse-content">
                        <header>
                          <span>{{ model?.commitDiff.phase === "ready" ? `${model.commitDiff.files.length} changed files` : commit.shortId }}</span>
                          <GlIconButton v-if="commit.webUrl" icon="external-link" label="Open commit on GitLab" size="small" @click="post({ type: 'openCommit', commitId: commit.id })" />
                        </header>
                        <p v-if="model?.commitDiff.phase === 'loading'" class="state-message"><GlIcon name="spinner" class="spin" /> Loading diff…</p>
                        <p v-else-if="model?.commitDiff.phase === 'error'" class="state-message is-danger">{{ model.commitDiff.errorMessage }}</p>
                        <GlEmptyState v-else-if="!model?.commitDiff.files.length" title="No changed files" icon="file" compact />
                        <div v-else class="commit-files">
                          <button
                            v-for="file in visibleCommitFiles"
                            :key="file.path"
                            type="button"
                            :disabled="file.collapsed || file.tooLarge"
                            @click="postReviewAction({ type: 'openCommitFile', commitId: commit.id, filePath: file.path })"
                          >
                            <GlStatusBadge :status="file.status" />
                            <span class="gl-truncate">{{ file.renamedFile && file.oldPath !== file.newPath ? `${file.oldPath} → ${file.newPath}` : file.path }}</span>
                            <small v-if="file.collapsed || file.tooLarge">{{ file.tooLarge ? "too large" : "collapsed" }}</small>
                          </button>
                          <GlButton
                            v-if="visibleCommitFiles.length < (model?.commitDiff.files.length ?? 0)"
                            size="small"
                            @click="commitFileLimit += 200"
                          >Show 200 more</GlButton>
                        </div>
                      </div>
                    </div>
                  </Transition>
                </article>
              </div>
            </div>
          </div>
        </Transition>
      </section>

      <GlSection class="thread-section" title="Review threads" :count="overview.threads.length" flush>
        <template #icon><GlIcon name="comments" /></template>
        <template #actions>
          <span class="open-count">{{ overview.unresolvedThreads }} open</span>
          <span class="thread-search-control">
            <GlIconButton
              :icon="threadSearchOpen ? 'close' : 'search'"
              :label="threadSearchOpen ? 'Close review search' : 'Search review comments and files'"
              size="small"
              :aria-expanded="threadSearchOpen"
              aria-controls="review-thread-search"
              @click="toggleThreadSearch"
            />
          </span>
          <select :value="overview.threadSortOrder" aria-label="Review thread order" @change="setThreadSort">
            <option value="open-first">Open first</option>
            <option value="oldest">Oldest</option>
            <option value="newest">Newest</option>
          </select>
        </template>

        <div v-if="threadSearchOpen" id="review-thread-search" class="thread-search">
          <input
            ref="threadSearchInput"
            v-model="threadSearchQuery"
            class="gl-input thread-search-input"
            type="search"
            aria-label="Search review comments, authors, and files"
            placeholder="Search comments, authors, or files…"
            @keydown.esc="closeThreadSearchFromKeyboard"
          />
          <GlButton
            v-if="threadSearchQuery"
            variant="link"
            size="small"
            aria-label="Clear review search"
            @click="threadSearchQuery = ''"
          >Clear</GlButton>
          <span v-if="normalizedThreadSearchQuery" class="thread-search-status" aria-live="polite">
            {{ filteredThreads.length }} of {{ overview.threads.length }} threads
          </span>
        </div>

        <div class="thread-list">
          <GlEmptyState
            v-if="normalizedThreadSearchQuery && filteredThreads.length === 0"
            title="No review comments found"
            :description="`No comments match “${threadSearchQuery.trim()}” in this merge request.`"
            icon="search"
            compact
          />
          <article
            v-for="thread in filteredThreads"
            :key="thread.id"
            :data-review-thread-id="thread.id"
            class="thread"
            :class="{ resolved: thread.resolved, collapsed: isThreadCollapsed(thread) }"
          >
            <header class="thread-header">
              <button
                class="thread-toggle"
                type="button"
                :aria-expanded="!isThreadCollapsed(thread)"
                :aria-controls="threadPanelId(thread)"
                :aria-label="`${isThreadCollapsed(thread) ? 'Expand' : 'Collapse'} discussion at ${threadLocation(thread)}`"
                @click="toggleThread(thread)"
              >
                <GlIcon name="chevron-right" :size="12" />
                <GlAvatarGroup
                  v-if="thread.commentCount > 1 && thread.authors.length"
                  :items="thread.authors"
                  aria-label="Reply authors"
                />
                <span class="thread-heading">
                  <span v-if="isThreadCollapsed(thread) && replyCount(thread) > 0" class="thread-summary-line">
                    <strong class="reply-count-link">{{ replyCount(thread) }} replies</strong>
                    <span class="thread-last-reply gl-truncate">Last reply by <b>{{ lastComment(thread)?.author || "GitLab user" }}</b> {{ relativeReplyTime(thread) }}</span>
                  </span>
                  <template v-else>
                    <strong class="thread-expanded-title">
                      <GlTechnicalIdentifier :value="threadLocation(thread)" :tail-length="26" />
                    </strong>
                    <span class="thread-last-reply">{{ thread.commentCount }} comments</span>
                  </template>
                  <span v-if="isThreadCollapsed(thread)" class="thread-location">
                    <GlTechnicalIdentifier :value="threadLocation(thread)" :tail-length="26" />
                  </span>
                  <span v-if="threadSearchExcerpt(thread)" class="thread-search-excerpt gl-truncate">{{ threadSearchExcerpt(thread) }}</span>
                </span>
              </button>
              <span class="thread-actions">
                <GlThreadStatusAction
                  :resolved="thread.resolved"
                  :pending="thread.pending || isMutationPending(mutationSlot('resolve', thread.id))"
                  :resolvable="thread.resolvable !== false"
                  @toggle="toggleResolved(thread.id)"
                />
                <GlButton
                  v-if="thread.filePath"
                  class="view-diff-action"
                  variant="link"
                  icon="external-link"
                  :aria-label="`Go to diff for ${thread.filePath}${thread.line ? ` at line ${thread.line}` : ''}`"
                  size="small"
                  @click.stop="openThread(thread)"
                >Go to diff</GlButton>
              </span>
            </header>
            <p v-if="mutationError(mutationSlot('resolve', thread.id))" class="mutation-error thread-mutation-error" role="alert">
              <GlIcon name="warning" :size="12" />
              <span>{{ mutationError(mutationSlot('resolve', thread.id)) }}</span>
              <GlButton variant="link" size="small" @click="retryMutation(mutationSlot('resolve', thread.id))">Retry</GlButton>
            </p>

            <Transition name="gl-collapse">
              <div v-if="!isThreadCollapsed(thread)" class="gl-collapse-shell">
                <div :id="threadPanelId(thread)" class="thread-content gl-collapse-content">
                  <p v-if="!threadDetailsById.get(thread.id)" class="thread-detail-loading"><GlIcon name="spinner" class="spin" :size="12" /> Loading discussion…</p>
                  <template v-for="comment in threadDetailsById.get(thread.id)?.comments ?? []" :key="comment.id">
                    <GlComment
                      v-if="!isEditing(thread.id, comment.id)"
                      :author="comment.author"
                      :avatar-url="comment.avatarUrl"
                      :date="formatDate(comment.createdAt)"
                      :edited="isCommentEdited(comment)"
                      :pending="comment.pending"
                    >
                      <template #meta><span v-if="comment.pending">{{ comment.id.includes("-pending-") ? "sending" : "saving" }}</span></template>
                      <template #actions>
                        <GlButton v-if="comment.canEdit && !comment.pending" class="comment-edit-action" variant="link" size="small" icon="pencil" @click.stop="startEdit(thread.id, comment)">Edit</GlButton>
                      </template>
                      <GlMarkdown :source="comment.body" :review-context="reviewContext" />
                      <template #footer>
                        <GlReactionBar
                          :reactions="comment.reactions"
                          :loaded="comment.reactionsLoaded"
                          :loading="comment.reactionsLoading"
                          :error="comment.reactionError"
                          :disabled="comment.pending || isMutationPendingFor('reaction', thread.id, comment.id)"
                          @load="loadCommentReactions(thread.id, comment.id)"
                          @toggle="name => toggleCommentReaction(thread.id, comment.id, name)"
                        />
                      </template>
                    </GlComment>
                    <GlCommentForm
                      v-else
                      v-model="editDrafts[commentKey(thread.id, comment.id)]"
                      :class="{ 'mutation-pending': isMutationPending(mutationSlot('edit-comment', thread.id, comment.id)) }"
                      :submitting="isMutationPending(mutationSlot('edit-comment', thread.id, comment.id))"
                      :aria-busy="isMutationPending(mutationSlot('edit-comment', thread.id, comment.id))"
                      aria-label="Edit comment"
                      submit-label="Save"
                      cancel-label="Cancel"
                      compact
                      :review-context="reviewContext"
                      @update:model-value="persist"
                      @submit="saveEdit(thread.id, comment.id)"
                      @cancel="cancelEdit(thread.id, comment.id)"
                    />
                    <p v-if="isEditing(thread.id, comment.id) && isMutationPending(mutationSlot('edit-comment', thread.id, comment.id))" class="mutation-status" role="status"><GlIcon name="spinner" class="spin" :size="12" /> Saving…</p>
                    <p v-if="!isEditing(thread.id, comment.id) && mutationErrorFor('reaction', thread.id, comment.id)" class="mutation-error" role="alert">
                      <GlIcon name="warning" :size="12" />
                      <span>{{ mutationErrorFor('reaction', thread.id, comment.id) }}</span>
                      <GlButton variant="link" size="small" @click="retryMutationFor('reaction', thread.id, comment.id)">Retry</GlButton>
                    </p>
                    <p v-if="isEditing(thread.id, comment.id) && mutationError(mutationSlot('edit-comment', thread.id, comment.id))" class="mutation-error" role="alert">
                      <GlIcon name="warning" :size="12" />
                      <span>{{ mutationError(mutationSlot('edit-comment', thread.id, comment.id)) }}</span>
                      <GlButton variant="link" size="small" @click="retryMutation(mutationSlot('edit-comment', thread.id, comment.id))">Retry</GlButton>
                    </p>
                  </template>
                  <GlCommentForm
                    v-if="!thread.pending || isMutationPending(mutationSlot('reply', thread.id)) || Boolean(replyDrafts[replyDraftKey(thread.id)])"
                    :model-value="replyDrafts[replyDraftKey(thread.id)] ?? ''"
                    :class="{ 'mutation-pending': isMutationPending(mutationSlot('reply', thread.id)) }"
                    :submitting="isMutationPending(mutationSlot('reply', thread.id))"
                    :aria-busy="isMutationPending(mutationSlot('reply', thread.id))"
                    aria-label="Reply to thread"
                    placeholder="Reply…"
                    submit-label="Reply"
                    compact
                    :review-context="reviewContext"
                    @update:model-value="value => { const key = replyDraftKey(thread.id); if (key) replyDrafts[key] = value; persist(); }"
                    @submit="sendReply(thread.id)"
                  />
                  <p v-if="mutationError(mutationSlot('reply', thread.id))" class="mutation-error" role="alert">
                    <GlIcon name="warning" :size="12" />
                    <span>{{ mutationError(mutationSlot('reply', thread.id)) }}</span>
                    <GlButton variant="link" size="small" @click="retryMutation(mutationSlot('reply', thread.id))">Retry</GlButton>
                  </p>
                  <p v-if="isMutationPending(mutationSlot('reply', thread.id))" class="mutation-status" role="status"><GlIcon name="spinner" class="spin" :size="12" /> Sending…</p>
                </div>
              </div>
            </Transition>
          </article>
        </div>

        <section v-if="overview.draftNotes.length" class="pending-review" aria-label="Pending review">
          <header class="pending-review-header">
            <span class="pending-review-title">
              <GlBadge tone="warning" pill>Pending review</GlBadge>
              <span>{{ overview.draftNotes.length }} comment{{ overview.draftNotes.length === 1 ? "" : "s" }}</span>
            </span>
          </header>
          <article v-for="draft in overview.draftNotes" :key="draft.id" class="pending-review-note">
            <header>
              <span class="pending-review-location">{{ draft.filePath ? `${draft.filePath}${draft.line ? `:${draft.line}` : ""}` : "MR overview" }}</span>
              <GlButton
                variant="link"
                size="small"
                :loading="draft.pending"
                :disabled="draft.pending || isMutationPending(mutationSlot('publish-draft', draft.id)) || (reviewSubmissionPending && !draft.pending)"
                @click="publishReviewDraft(draft.id)"
              >Post as comment</GlButton>
            </header>
            <GlMarkdown :source="draft.body" :review-context="reviewContext" />
            <p v-if="mutationError(mutationSlot('publish-draft', draft.id))" class="mutation-error" role="alert">
              <GlIcon name="warning" :size="12" />
              <span>{{ mutationError(mutationSlot('publish-draft', draft.id)) }}</span>
              <GlButton variant="link" size="small" @click="retryMutation(mutationSlot('publish-draft', draft.id))">Retry</GlButton>
            </p>
          </article>
        </section>

        <div class="new-thread-composer" :class="{ 'has-submission-tray': overview.draftNotes.length > 0 }">
          <div class="new-thread-heading"><GlIcon name="comment" :size="12" /><span>New comment</span></div>
          <div class="submission-mode-row">
            <span class="submission-mode-label">Post as</span>
            <div class="submission-mode" role="group" aria-label="Choose comment or review">
              <button
                type="button"
                aria-label="Post as comment"
                :aria-pressed="overviewThreadMode === 'comment'"
                :disabled="isMutationPending(mutationSlot('overview-thread'))"
                title="Post immediately as a comment"
                @click="setOverviewThreadMode('comment')"
              >Comment</button>
              <button
                type="button"
                aria-label="Post as review"
                :aria-pressed="overviewThreadMode === 'review'"
                :disabled="isMutationPending(mutationSlot('overview-thread'))"
                title="Keep pending until you submit the review"
                @click="setOverviewThreadMode('review')"
              >Review</button>
            </div>
            <span class="submission-mode-help">
              {{ overviewThreadMode === "comment" ? "Posts immediately" : "Stays pending until review submission" }}
            </span>
          </div>
          <GlCommentForm
            v-model="overviewThreadDraft"
            class="new-thread-form"
            :class="{ 'mutation-pending': isMutationPending(mutationSlot('overview-thread')) }"
            :submitting="isMutationPending(mutationSlot('overview-thread'))"
            :aria-busy="isMutationPending(mutationSlot('overview-thread'))"
            aria-label="Add review thread"
            :placeholder="overviewThreadMode === 'comment' ? 'Add a comment…' : 'Add to your review…'"
            :submit-label="overviewThreadMode === 'comment' ? 'Comment' : 'Add to review'"
            compact
            :review-context="reviewContext"
            @focusin="scheduleOverviewComposerReveal"
            @update:model-value="updateOverviewThreadDraft"
            @submit="addOverviewThread"
          />
          <p v-if="isMutationPending(mutationSlot('overview-thread'))" class="mutation-status" role="status"><GlIcon name="spinner" class="spin" :size="12" /> Sending…</p>
          <p v-if="mutationError(mutationSlot('overview-thread'))" class="mutation-error" role="alert">
            <GlIcon name="warning" :size="12" />
            <span>{{ mutationError(mutationSlot('overview-thread')) }}</span>
            <GlButton variant="link" size="small" @click="retryMutation(mutationSlot('overview-thread'))">Retry</GlButton>
          </p>
        </div>

        <section v-if="overview.draftNotes.length" class="review-submit-tray" aria-label="Review submission">
          <div class="review-submit-tray-copy">
            <GlBadge tone="warning" pill>{{ overview.draftNotes.length }} pending</GlBadge>
            <span><strong>Review ready to submit</strong><small>Draft comments stay private until submitted.</small></span>
          </div>
          <div class="review-submit-tray-actions">
            <GlButton v-if="nextUnresolvedThread" size="small" variant="link" @click="openNextUnresolved">Next unresolved</GlButton>
            <GlButton
              variant="confirm"
              size="small"
              :loading="reviewSubmissionPending || isMutationPending(mutationSlot('submit-review'))"
              :disabled="isMutationPending(mutationSlot('submit-review'))"
              @click="submitReview"
            >Submit review</GlButton>
          </div>
          <p v-if="isMutationPending(mutationSlot('submit-review'))" class="mutation-status review-submit-error" role="status"><GlIcon name="spinner" class="spin" :size="12" /> Sending…</p>
          <p v-if="mutationError(mutationSlot('submit-review'))" class="mutation-error review-submit-error" role="alert">
            <GlIcon name="warning" :size="12" />
            <span>{{ mutationError(mutationSlot('submit-review')) }}</span>
            <GlButton variant="link" size="small" @click="retryMutation(mutationSlot('submit-review'))">Retry</GlButton>
          </p>
        </section>
      </GlSection>
    </div>
  </main>
</template>

<style scoped>
.sidebar-shell {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 0;
  padding: 0;
  color: var(--vscode-sideBar-foreground, var(--gl-text-default));
  background: var(--vscode-sideBar-background, var(--gl-surface-subtle));
}
.auth-compact {
  min-height: 34px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gl-spacing-4);
  padding: var(--gl-spacing-4) var(--gl-spacing-8);
  border-bottom: 1px solid var(--gl-border-subtle);
  color: var(--gl-text-subtle);
  font-size: 11px;
}
.auth-identity, .top-toolbar { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); }
.auth-identity > :last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.top-toolbar { flex: none; gap: var(--gl-spacing-2); }
.auth-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gl-feedback-success); }
.auth-prompt { display: flex; align-items: center; gap: var(--gl-spacing-8); padding: var(--gl-spacing-8); color: var(--gl-text-subtle); background: var(--gl-surface-raised); }
.auth-prompt > span { flex: 1; }
.review-loaded { width: 100%; min-width: 0; max-width: 100%; display: grid; align-content: start; gap: var(--gl-spacing-12); }
.retained-drafts {
  min-width: 0;
  display: grid;
  gap: var(--gl-spacing-4);
  margin: 0 var(--gl-spacing-8);
  padding: var(--gl-spacing-6) var(--gl-spacing-8);
  border: 1px solid color-mix(in srgb, var(--gl-feedback-warning) 42%, var(--gl-border-default));
  border-left: 2px solid var(--gl-feedback-warning);
  border-radius: var(--gl-radius-sm);
  background: color-mix(in srgb, var(--gl-feedback-warning) 6%, var(--gl-surface-raised));
}
.retained-drafts-header { min-width: 0; display: flex; align-items: baseline; justify-content: space-between; gap: var(--gl-spacing-8); color: var(--gl-text-default); font-size: 11px; }
.retained-drafts-header > span { min-width: 0; display: inline-flex; align-items: center; gap: var(--gl-spacing-4); font-weight: 600; }
.retained-drafts-header > span > .gl-icon { color: var(--gl-feedback-warning); }
.retained-drafts-header small { color: var(--gl-text-subtle); font-size: 10px; }
.retained-draft { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--gl-spacing-4) var(--gl-spacing-8); padding-top: var(--gl-spacing-4); border-top: 1px solid var(--gl-border-subtle); }
.retained-draft-meta { min-width: 0; grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: var(--gl-spacing-4); color: var(--gl-text-subtle); font-size: 10px; }
.retained-draft-meta strong { color: var(--gl-text-default); }
.retained-draft-meta span { min-width: 0; grid-row: 2; grid-column: 1 / -1; overflow-wrap: anywhere; }
.retained-draft-meta code { max-width: 16ch; grid-column: 2; grid-row: 1; overflow: hidden; color: var(--gl-text-subtle); text-overflow: ellipsis; white-space: nowrap; }
.retained-draft-text { width: 100%; min-width: 0; min-height: 48px; max-height: 112px; resize: vertical; padding: var(--gl-spacing-4); border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-sm); color: var(--gl-text-default); background: var(--gl-surface-raised); font: 11px/1.4 var(--vscode-editor-font-family); }
.retained-draft > .gl-button { align-self: end; white-space: nowrap; }
.review-status-banner {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--gl-spacing-6);
  margin: 0 var(--gl-spacing-8);
  padding: var(--gl-spacing-6) var(--gl-spacing-8);
  border: 1px solid color-mix(in srgb, var(--gl-feedback-brand) 34%, var(--gl-border-default));
  border-left: 2px solid var(--gl-feedback-brand);
  border-radius: var(--gl-radius-sm);
  color: var(--gl-text-subtle);
  background: color-mix(in srgb, var(--gl-feedback-brand) 6%, var(--gl-surface-raised));
  font-size: 11px;
  line-height: 1.35;
}
.review-status-banner > span { min-width: 0; flex: 1; }
.review-status-banner > .gl-icon { flex: none; color: var(--gl-feedback-brand); }
.review-status-banner.is-danger {
  border-color: color-mix(in srgb, var(--gl-feedback-danger) 40%, var(--gl-border-default));
  border-left-color: var(--gl-feedback-danger);
  color: var(--gl-text-default);
  background: color-mix(in srgb, var(--gl-feedback-danger) 7%, var(--gl-surface-raised));
}
.review-status-banner.is-danger > .gl-icon { color: var(--gl-feedback-danger); }
.mr-header { display: grid; gap: var(--gl-spacing-8); padding: var(--gl-spacing-8) var(--gl-spacing-8) var(--gl-spacing-12); border-top: 2px solid var(--gl-accent-orange); border-bottom: 1px solid var(--gl-border-default); background: color-mix(in srgb, var(--gl-accent-orange) 4%, var(--gl-surface-default)); }
.mr-main { min-width: 0; display: grid; gap: var(--gl-spacing-4); }
.review-context-label { display: inline-flex; align-items: center; gap: var(--gl-spacing-4); width: fit-content; color: var(--gl-thread-accent); font-size: 10px; font-weight: 600; letter-spacing: .02em; }
.mr-title-row { min-width: 0; display: flex; align-items: flex-start; gap: var(--gl-spacing-8); }
.mr-title-row h1 { min-width: 0; margin: 0; color: var(--gl-text-strong); font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
.mr-meta { display: flex; gap: var(--gl-spacing-8); color: var(--gl-text-subtle); font-size: 11px; }
.mr-meta strong { color: var(--gl-text-link); }
.branch-flow { grid-column: 1 / -1; min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-text-subtle); }
.branch-flow button { min-width: 0; max-width: calc(50% - var(--gl-spacing-12)); display: flex; align-items: center; gap: var(--gl-spacing-4); padding: var(--gl-spacing-2) var(--gl-spacing-4); border-radius: var(--gl-radius-sm); color: inherit; background: transparent; font: 11px var(--vscode-editor-font-family); cursor: pointer; }
.branch-flow button:hover { color: var(--gl-hover-text); background: var(--gl-hover-surface); }
.branch-flow button :deep(.gl-technical-identifier) { flex: 1; }
.mr-summary { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--gl-spacing-4) var(--gl-spacing-12); color: var(--gl-text-subtle); font-size: 11px; }
.mr-summary strong { color: var(--gl-text-strong); }
.review-submit-tray, .review-submit-tray-copy, .review-submit-tray-actions { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-6); }
.review-submit-tray { justify-content: space-between; flex-wrap: wrap; }
.review-submit-error { flex-basis: 100%; order: 3; }
.local-workspace {
  min-width: 0;
  display: grid;
  gap: var(--gl-spacing-4);
  margin: 0 var(--gl-spacing-8);
  padding: var(--gl-spacing-4) var(--gl-spacing-8);
  border: 1px solid var(--gl-border-default);
  border-left: 2px solid var(--gl-accent-purple);
  border-radius: var(--gl-radius-sm);
  background: color-mix(in srgb, var(--gl-accent-purple) 5%, var(--gl-surface-raised));
}
.local-workspace-row { min-width: 0; min-height: 24px; display: flex; align-items: center; gap: var(--gl-spacing-4); }
.local-workspace-title { flex: none; display: inline-flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-accent-purple); font-size: 11px; }
.local-current-branch { min-width: 52px; flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--gl-text-strong); font-size: 11px; white-space: nowrap; }
.local-dirty { flex: none; display: inline-flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-text-subtle); font-size: 11px; white-space: nowrap; }
.local-dirty.is-dirty { color: var(--gl-feedback-warning); }
.local-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gl-feedback-success); }
.is-dirty .local-status-dot { background: var(--gl-feedback-warning); }
.local-primary-action { flex: none; }
.local-state-message { display: flex; align-items: center; gap: var(--gl-spacing-4); margin: 0; color: var(--gl-text-subtle); font-size: 11px; }
.local-state-message.is-danger { color: var(--gl-feedback-danger); }
.local-help { margin: 0; color: var(--gl-text-subtle); font-size: 11px; line-height: 1.3; }
@media (max-width: 320px) {
  .local-workspace-row { flex-wrap: wrap; }
  .local-current-branch { order: 2; flex-basis: calc(100% - 64px); }
  .local-dirty { font-size: 10px; }
}
.branch-explorer { max-height: 220px; padding: var(--gl-spacing-8); overflow: auto; border-left: 2px solid var(--gl-feedback-brand); background: var(--gl-surface-raised); }
.tree { display: grid; gap: var(--gl-spacing-2); }
.state-message { display: flex; align-items: center; gap: var(--gl-spacing-4); margin: 0; padding: var(--gl-spacing-8); color: var(--gl-text-subtle); }
.state-message.is-danger { color: var(--gl-feedback-danger); }
.collapsible-section { min-width: 0; display: grid; gap: var(--gl-spacing-4); }
.collapsible-section-header {
  width: 100%;
  min-width: 0;
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gl-spacing-8);
  padding: 0 var(--gl-spacing-8);
  border: 0;
  border-bottom: 1px solid var(--gl-border-subtle);
  color: var(--gl-text-default);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.collapsible-section-header:hover { background: var(--gl-hover-surface); }
.collapsible-section-header:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.collapsible-section-title, .collapsible-section-actions { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); }
.collapsible-section-title strong { color: var(--gl-text-strong); font-size: 11px; font-weight: 600; letter-spacing: .02em; }
.collapsible-section-count { color: var(--gl-text-subtle); font-size: 10px; }
.collapsible-section-content { min-width: 0; min-height: 0; }
.changed-section {
  min-height: 0;
  overflow: visible;
  border: 0;
  background: transparent;
}
.changed-section > .collapsible-section-header {
  background: transparent;
}
.changed-section .collapsible-section-title > .gl-icon { color: var(--gl-changed-accent); }
.changed-scroll { min-width: 0; min-height: 0; padding: var(--gl-spacing-4) 0 var(--gl-spacing-4) var(--gl-spacing-4); overflow: visible; }
.changed-scroll.scrollable { max-height: var(--changed-height); overflow-x: hidden; overflow-y: auto; }
.changed-file-tools { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--gl-spacing-4); align-items: center; padding: var(--gl-spacing-4); border-bottom: 1px solid var(--gl-border-subtle); background: var(--gl-surface-subtle); }
.changed-file-search { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); padding-inline: var(--gl-spacing-4); border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-sm); background: var(--gl-surface-raised); }
.changed-file-search > .gl-input { min-width: 0; flex: 1; height: 26px; padding: 0; border: 0; background: transparent; }
.changed-file-search > .gl-input:focus { outline: none; }
.changed-file-result-count { grid-column: 1 / -1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--gl-spacing-8); color: var(--gl-text-subtle); font-size: 11px; }
.changed-file-result-help { min-width: 0; color: var(--gl-text-subtle); font-size: 10px; }
.changed-tree-list { display: grid; align-content: start; gap: var(--gl-spacing-2); }
.changed-flat-list { display: grid; align-content: start; gap: 1px; padding-inline: var(--gl-spacing-4); }
.changed-flat-file {
  width: 100%;
  min-width: 0;
  min-height: 25px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gl-spacing-4);
  padding: 2px var(--gl-spacing-4);
  border: 0;
  border-radius: var(--gl-radius-sm);
  color: var(--gl-text-default);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.changed-flat-file:hover { background: var(--gl-hover-surface); }
.changed-flat-file.active-file { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.changed-flat-path { font: 11px var(--vscode-editor-font-family); }
.file-stats { display: inline-flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-text-subtle); font-size: 10px; white-space: nowrap; }
.discussion-count { display: inline-flex; align-items: center; gap: 2px; color: var(--gl-thread-accent); }
.local-edit-mark { color: var(--gl-local-accent); }
.changed-load-more { justify-self: center; margin-block: var(--gl-spacing-4); }
.diff-stats { display: flex; gap: var(--gl-spacing-8); font-size: 10px; }
.resizer { height: 5px; margin-top: calc(var(--gl-spacing-12) * -1); cursor: row-resize; }
.resizer::before { content: ""; display: block; width: 32px; height: 2px; margin: 3px auto; border-radius: var(--gl-radius-pill); background: var(--gl-border-strong); }
.resizer:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.commit-timeline { display: flex; gap: var(--gl-spacing-4); overflow-x: auto; padding-bottom: var(--gl-spacing-4); }
.commit-timeline button { min-height: 24px; display: flex; align-items: center; gap: var(--gl-spacing-4); padding: var(--gl-spacing-2) var(--gl-spacing-8); border-radius: var(--gl-radius-pill); color: var(--gl-text-subtle); background: transparent; cursor: pointer; }
.commit-timeline button:hover { background: var(--gl-hover-surface); }
.commit-timeline button.active { color: var(--gl-commit-accent); background: color-mix(in srgb, var(--gl-commit-accent) 14%, transparent); }
.commit-filter-bar { display: flex; align-items: center; gap: var(--gl-spacing-8); padding: var(--gl-spacing-4) var(--gl-spacing-8); border-bottom: 1px solid var(--gl-border-subtle); background: var(--gl-surface-subtle); }
.commit-filter-bar button { min-height: 26px; display: inline-flex; align-items: center; gap: var(--gl-spacing-4); padding: var(--gl-spacing-2) var(--gl-spacing-8); border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-sm); color: var(--gl-text-subtle); background: var(--gl-surface-raised); cursor: pointer; }
.commit-filter-bar button:hover { color: var(--gl-text-default); background: var(--gl-hover-surface); }
.commit-filter-bar button.active { color: var(--gl-commit-accent); border-color: color-mix(in srgb, var(--gl-commit-accent) 55%, var(--gl-border-default)); background: color-mix(in srgb, var(--gl-commit-accent) 12%, var(--gl-surface-raised)); }
.commit-filter-help { min-width: 0; overflow: hidden; color: var(--gl-text-subtle); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.commit-dot { width: 7px; height: 7px; flex: none; border: 2px solid currentColor; border-radius: 50%; color: var(--gl-commit-accent); }
.commit-list { max-height: 168px; overflow: auto; border-top: 1px solid var(--gl-border-subtle); }
.commit-list.expanded { max-height: 430px; }
.commit-item { position: relative; border-bottom: 1px solid var(--gl-border-subtle); }
.commit-item:not(:last-child)::before { content: ""; position: absolute; left: 11px; top: 22px; bottom: -1px; width: 1px; background: color-mix(in srgb, var(--gl-commit-accent) 60%, transparent); pointer-events: none; }
.commit-row { position: relative; width: 100%; min-width: 0; min-height: 32px; display: grid; grid-template-columns: 8px 52px minmax(90px, 1fr) minmax(48px, auto) auto auto; gap: var(--gl-spacing-8); align-items: center; padding: var(--gl-spacing-4) var(--gl-spacing-8); color: var(--gl-text-default); background: transparent; text-align: left; cursor: pointer; transition: background-color var(--gl-motion-duration-fast) var(--gl-motion-ease-standard); }
.commit-row::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 2px; background: var(--gl-commit-accent); pointer-events: none; transform: scaleY(0); transform-origin: center; transition: transform var(--gl-motion-duration-fast) var(--gl-motion-ease-standard); }
.commit-row:hover { background: var(--gl-hover-surface); }
.commit-row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.commit-row.active { background: color-mix(in srgb, var(--gl-commit-accent) 12%, var(--gl-surface-raised)); }
.commit-row .commit-author, .commit-row time { color: var(--gl-text-subtle); font-size: 10px; }
.commit-row.active::before { transform: scaleY(1); }
.commit-row-action { min-width: 14px; display: inline-flex; align-items: center; justify-content: flex-end; gap: 2px; color: var(--gl-text-subtle); font-size: 10px; font-weight: 600; white-space: nowrap; }
.commit-row:hover .commit-row-action, .commit-row:focus-visible .commit-row-action, .commit-row.active .commit-row-action { color: var(--gl-commit-accent); }
.commit-detail-shell { display: grid; grid-template-rows: 1fr; overflow: hidden; }
.commit-detail-shell > .commit-detail { min-height: 0; }
.commit-detail { border-top: 1px solid var(--gl-border-subtle); background: var(--gl-surface-subtle); }
.commit-detail > header { min-height: 28px; display: flex; justify-content: space-between; align-items: center; padding: var(--gl-spacing-4) var(--gl-spacing-8); color: var(--gl-text-subtle); font-size: 10px; }
.commit-files { display: grid; border-top: 1px solid var(--gl-border-subtle); }
.commit-files button { min-height: 30px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--gl-spacing-8); align-items: center; padding: var(--gl-spacing-4) var(--gl-spacing-8); color: var(--gl-text-default); background: transparent; text-align: left; cursor: pointer; }
.commit-files button:hover:not(:disabled) { background: var(--gl-hover-surface); }
.commit-files small { color: var(--gl-text-subtle); }
.open-count { color: var(--gl-text-subtle); font-size: 10px; }
select { min-height: 24px; border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-sm); color: var(--vscode-dropdown-foreground, var(--gl-text-default)); background: var(--vscode-dropdown-background, var(--gl-surface-raised)); }
.thread-list { min-width: 0; display: grid; gap: var(--gl-spacing-8); }
.thread-search-toggle { min-width: 0; display: flex; justify-content: flex-end; margin-bottom: var(--gl-spacing-4); }
.thread-search { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--gl-spacing-4); align-items: center; margin-bottom: var(--gl-spacing-8); padding: var(--gl-spacing-4) var(--gl-spacing-8); border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); background: var(--gl-surface-subtle); }
.thread-search-input { min-width: 0; height: 28px; padding-block: var(--gl-spacing-4); }
.thread-search-input::-webkit-search-cancel-button { display: none; }
.thread-search-status { grid-column: 1 / -1; color: var(--gl-text-subtle); font-size: 10px; }
.new-thread-composer { min-width: 0; margin-bottom: var(--gl-spacing-8); scroll-margin-bottom: var(--review-submit-reserved-space, 0px); }
.new-thread-composer.has-submission-tray { padding-bottom: var(--review-submit-reserved-space, 0px); }
.new-thread-heading { display: flex; align-items: center; gap: var(--gl-spacing-4); margin-bottom: var(--gl-spacing-4); color: var(--gl-text-strong); font-size: 11px; font-weight: 600; }
.submission-mode-row { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-8); margin-bottom: var(--gl-spacing-4); }
.submission-mode-label { flex: none; color: var(--gl-text-subtle); font-size: 10px; }
.submission-mode { flex: none; display: inline-flex; overflow: hidden; border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-sm); }
.submission-mode button { min-height: 24px; padding: var(--gl-spacing-2) var(--gl-spacing-8); border: 0; border-right: 1px solid var(--gl-border-default); color: var(--gl-text-subtle); background: var(--gl-surface-raised); font-size: 10px; cursor: pointer; }
.submission-mode button:last-child { border-right: 0; }
.submission-mode button:hover { color: var(--gl-text-default); background: var(--gl-hover-surface); }
.submission-mode button[aria-pressed="true"] { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, var(--gl-feedback-brand)); }
.submission-mode-help { min-width: 0; overflow: hidden; color: var(--gl-text-subtle); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.new-thread-form { border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-md); }
.sidebar-shell :deep(.new-thread-form .hint) { color: var(--vscode-editor-foreground, var(--gl-text-default)); }
.sidebar-shell :deep(.new-thread-form .gl-button.is-confirm),
.sidebar-shell :deep(.new-thread-form .gl-button.is-confirm span) { color: #fff !important; }
.mutation-pending { cursor: progress; }
.mutation-pending :deep(button[type="submit"]) { pointer-events: none; }
.mutation-error, .mutation-status {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--gl-spacing-4);
  margin: var(--gl-spacing-4) 0 0;
  color: var(--gl-text-subtle);
  font-size: 11px;
  line-height: 1.3;
}
.mutation-error { color: var(--gl-feedback-danger); }
.mutation-error > span, .mutation-status > span { min-width: 0; flex: 1; }
.thread-mutation-error { margin: 0; padding: var(--gl-spacing-4) var(--gl-spacing-8); border-bottom: 1px solid var(--gl-border-subtle); background: var(--gl-feedback-danger-subtle); }
.pending-review { min-width: 0; display: grid; gap: var(--gl-spacing-4); margin-bottom: var(--gl-spacing-8); padding: var(--gl-spacing-8); border: 1px solid color-mix(in srgb, var(--gl-feedback-warning) 40%, var(--gl-border-default)); border-radius: var(--gl-radius-md); background: var(--gl-feedback-warning-subtle); }
.pending-review-header, .pending-review-note > header { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--gl-spacing-8); }
.pending-review-title { min-width: 0; flex: 1; display: flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-text-subtle); font-size: 11px; }
.pending-review-note { min-width: 0; padding: var(--gl-spacing-8); border: 1px solid var(--gl-border-subtle); border-radius: var(--gl-radius-sm); background: var(--gl-surface-raised); }
.pending-review-location { min-width: 0; overflow: hidden; color: var(--gl-text-subtle); font: 11px var(--vscode-editor-font-family); text-overflow: ellipsis; white-space: nowrap; }
.pending-review-note :deep(.gl-markdown) { margin-top: var(--gl-spacing-4); }
.pending-review :deep(.gl-button) { white-space: nowrap; }
.review-submit-tray { position: sticky; bottom: 0; z-index: 4; margin: var(--gl-spacing-8) calc(-1 * var(--gl-spacing-8)) calc(-1 * var(--gl-spacing-8)); padding: var(--gl-spacing-8); border-top: 1px solid var(--gl-border-default); background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, transparent); box-shadow: 0 -6px 16px color-mix(in srgb, var(--gl-surface-default) 18%, transparent); backdrop-filter: blur(5px); }
.review-submit-tray-copy { min-width: 0; flex: 1; }
.review-submit-tray-copy > span { min-width: 0; display: grid; gap: 1px; }
.review-submit-tray-copy small { overflow: hidden; color: var(--gl-text-subtle); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.review-submit-tray-actions { flex: none; justify-content: flex-end; }
.commit-section .collapsible-section-title > .gl-icon { color: var(--gl-commit-accent); }
.thread-section :deep(.gl-section-header) { min-height: 24px; padding-inline: var(--gl-spacing-8); border-bottom: 1px solid var(--gl-border-subtle); }
.thread-section :deep(.gl-section-title > .gl-icon) { color: var(--gl-thread-accent); }
.thread {
  overflow: hidden;
  border: 1px solid var(--gl-border-default);
  border-left: 3px solid var(--gl-thread-accent);
  border-radius: var(--gl-radius-md);
  background: var(--gl-surface-raised);
}
.thread.resolved {
  border-left-width: 4px;
  border-left-color: var(--gl-resolved-accent);
  background: color-mix(in srgb, var(--gl-resolved-accent) 4%, var(--gl-surface-raised));
}
.thread.resolved.collapsed {
  border-color: var(--gl-border-subtle);
  border-left-width: 2px;
  border-radius: var(--gl-radius-sm);
  background: transparent;
}
.thread-header {
  min-height: 36px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gl-spacing-4);
  padding: var(--gl-spacing-4);
  border-bottom: 1px solid var(--gl-border-subtle);
  background: var(--gl-surface-subtle);
}
.thread.collapsed .thread-header { border-bottom: 0; }
.thread:not(.resolved) .thread-header { background: color-mix(in srgb, var(--gl-thread-accent) 5%, var(--gl-surface-subtle)); }
.thread.resolved .thread-header {
  border-bottom-color: color-mix(in srgb, var(--gl-resolved-accent) 24%, var(--gl-border-subtle));
  background: color-mix(in srgb, var(--gl-resolved-accent) 12%, var(--gl-surface-subtle));
}
.thread.resolved.collapsed .thread-header { min-height: 28px; padding-block: var(--gl-spacing-2); border-bottom: 0; background: transparent; }
.thread-toggle {
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
.thread-toggle:hover { background: var(--gl-hover-surface); }
.thread-toggle > :first-child { color: var(--gl-text-subtle); transition: transform var(--gl-motion-duration-fast) var(--gl-motion-ease-standard); }
.thread.resolved .thread-toggle > :first-child { color: var(--gl-resolved-accent); }
.thread.resolved.collapsed .thread-toggle > :first-child { color: var(--gl-text-subtle); }
.thread-toggle[aria-expanded="true"] > :first-child { transform: rotate(90deg); }
.thread-heading { min-width: 0; flex: 1; display: grid; gap: 1px; overflow: hidden; }
.thread-summary-line { min-width: 0; display: flex; align-items: baseline; gap: var(--gl-spacing-4); overflow: hidden; white-space: nowrap; }
.reply-count-link { flex: none; color: var(--gl-text-link); font-size: 11px; text-decoration: underline; }
.thread-last-reply { min-width: 0; color: var(--gl-text-subtle); font-size: 11px; }
.thread-last-reply b, .thread-expanded-title { color: var(--gl-text-strong); font-size: 11px; }
.thread-expanded-title, .thread-location { min-width: 0; display: block; }
.thread-location { color: var(--gl-text-subtle); font: 11px var(--vscode-editor-font-family); }
.thread-search-excerpt { color: var(--gl-text-subtle); font-size: 11px; }
.view-diff-action { min-height: 28px; white-space: nowrap; color: var(--gl-thread-accent); }
.view-diff-action:hover:not(:disabled) { color: var(--gl-text-strong); background: color-mix(in srgb, var(--gl-thread-accent) 12%, transparent); }
.thread.resolved.collapsed .view-diff-action { color: var(--gl-text-subtle); }
.thread.resolved.collapsed .view-diff-action:hover:not(:disabled) { color: var(--gl-hover-text); background: var(--gl-hover-surface); }
.thread.resolved.collapsed .thread-status-action.resolved { border-color: transparent; color: var(--gl-text-subtle); background: transparent; font-weight: 500; }
.thread.resolved.collapsed .thread-status-action.resolved.has-action:hover,
.thread.resolved.collapsed .thread-status-action.resolved.has-action:focus-visible { border-color: var(--gl-border-default); color: var(--gl-hover-text); background: var(--gl-hover-surface); }
.comment-edit-action { color: var(--gl-text-subtle); }
.comment-edit-action:hover:not(:disabled) { color: var(--gl-thread-accent); }
.thread-actions { display: inline-flex; align-items: center; gap: var(--gl-spacing-2); white-space: nowrap; }
.thread-content { min-width: 0; }

@media (max-width: 480px) {
  .thread-header { gap: var(--gl-spacing-2); padding-inline: var(--gl-spacing-2); }
  .thread-toggle { padding-inline: var(--gl-spacing-2); }
  .thread-actions { gap: 0; }
}

@media (max-width: 360px) {
  .new-thread-composer.has-submission-tray {
    --review-submit-reserved-space: calc(var(--gl-spacing-32) + var(--gl-spacing-24) + var(--gl-spacing-16) + var(--gl-spacing-8));
    margin-top: calc(-1 * (var(--gl-spacing-12) + var(--gl-spacing-4)));
  }
  .new-thread-composer.has-submission-tray :deep(.new-thread-form.gl-comment-form) { padding: var(--gl-spacing-4); }
  .new-thread-composer.has-submission-tray :deep(.new-thread-form .rich-comment-editor) { min-height: 26px; }
  .branch-flow { flex-direction: column; align-items: stretch; gap: var(--gl-spacing-2); }
  .branch-flow button { width: 100%; max-width: none; }
  .branch-flow > :deep(.gl-icon) { align-self: center; transform: rotate(90deg); }
  .thread-header { grid-template-columns: minmax(0, 1fr); }
  .thread-toggle { grid-column: 1; grid-row: 1; }
  .thread-actions { grid-column: 1; grid-row: 2; justify-self: end; padding-inline: var(--gl-spacing-2); }
  .commit-row { grid-template-columns: 8px 48px minmax(0, 1fr) auto auto; }
  .commit-row-action-label { display: none; }
  .commit-author { display: none; }
  .submission-mode-help { display: none; }
  .pending-review-header { flex-wrap: wrap; }
  .pending-review-title { flex-basis: 100%; justify-content: space-between; }
  .pending-review-header > :deep(.gl-button) { margin-left: auto; }
  .review-submit-tray { align-items: flex-start; flex-wrap: wrap; }
  .review-submit-tray-copy { flex-basis: 100%; }
  .review-submit-tray-actions { margin-left: auto; }
}

</style>
