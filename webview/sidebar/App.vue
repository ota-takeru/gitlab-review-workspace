<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from "vue";
import { buildBranchTree } from "../../src/branchTreeUtils";
import { isCommentEdited } from "../../src/commentUtils";
import { buildChangedFileTree } from "../../src/reviewTreeUtils";
import {
  formatRelativeReplyTime,
  isCommitDiffForSelection,
  normalizeCommitFilter,
  reconcileThreadCollapsed,
  threadCollapseKey,
  threadContentId
} from "../../src/webviewViewModels";
import type { MyWorkMergeRequest } from "../../src/myWorkTypes";
import type { ReviewComment, ReviewThread, ReviewThreadSortOrder } from "../../src/reviewTypes";
import type { HostMessage, SidebarMessage, SidebarViewState } from "../../src/webviewProtocol";
import GlBadge from "../common/components/GlBadge.vue";
import GlAvatar from "../common/components/GlAvatar.vue";
import GlButton from "../common/components/GlButton.vue";
import GlComment from "../common/components/GlComment.vue";
import GlCommentForm from "../common/components/GlCommentForm.vue";
import GlEmptyState from "../common/components/GlEmptyState.vue";
import GlIcon from "../common/components/GlIcon.vue";
import GlIconButton from "../common/components/GlIconButton.vue";
import GlMarkdown from "../common/components/GlMarkdown.vue";
import GlSection from "../common/components/GlSection.vue";
import GlStatusBadge from "../common/components/GlStatusBadge.vue";
import GlThreadStatusAction from "../common/components/GlThreadStatusAction.vue";
import { handleCommentImageMessage } from "../common/commentImages";
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
  myWorkScrollTop?: number;
}

const saved = (vscode.getState() ?? {}) as UiState;
const model = shallowRef<SidebarViewState>();
const changedFilesHeight = ref(saved.changedFilesHeight ?? 210);
const changedFilesExpanded = ref(saved.changedFilesExpanded ?? false);
const commitsExpanded = ref(saved.commitsExpanded ?? false);
const myWorkScrollTop = ref(saved.myWorkScrollTop ?? 0);
const commitSelection = ref(saved.commitSelection);
const replyDrafts = reactive<Record<string, string>>(saved.replyDrafts ?? {});
const editDrafts = reactive<Record<string, string>>(saved.editDrafts ?? {});
const editingComments = reactive<Record<string, boolean>>(saved.editingComments ?? {});
const collapsedThreads = reactive<Record<string, boolean>>(saved.collapsedThreads ?? {});
const resolvedByThread = new Map<string, boolean>();
let readyRetry: number | undefined;

const overview = computed(() => model.value?.overview);
const activeTab = computed(() => model.value?.activeTab ?? "review");
const attentionCount = computed(() => model.value?.myWork.attentionCount ?? 0);
const branchTree = computed(() => buildBranchTree(model.value?.branchTree.entries ?? []));
const mrKey = computed(() => {
  const selected = overview.value?.selectedMergeRequest;
  return selected ? `${selected.projectId}!${selected.iid}` : "";
});
const commentProjectId = computed(() => overview.value?.selectedMergeRequest?.projectId);
const filteredCommits = computed(() => {
  const commits = overview.value?.commits ?? [];
  const selection = commitSelection.value;
  if (!selection || selection.mrKey !== mrKey.value || selection.commitId === "all") return commits;
  return commits.filter((commit) => commit.id === selection.commitId);
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
const changedTree = computed(() => buildChangedFileTree(changedFiles.value));
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
    myWorkScrollTop: myWorkScrollTop.value
  });
}
function toggleChangedFiles(): void {
  changedFilesExpanded.value = !changedFilesExpanded.value;
  persist();
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
function commentKey(threadId: string, commentId: string): string { return `${threadId}:${commentId}`; }
function isEditing(threadId: string, commentId: string): boolean { return editingComments[commentKey(threadId, commentId)] === true; }
function startEdit(threadId: string, comment: ReviewComment): void {
  const key = commentKey(threadId, comment.id);
  editDrafts[key] = comment.body;
  editingComments[key] = true;
  persist();
}
function cancelEdit(threadId: string, commentId: string): void {
  const key = commentKey(threadId, commentId);
  delete editDrafts[key];
  delete editingComments[key];
  persist();
}
function saveEdit(threadId: string, commentId: string): void {
  const key = commentKey(threadId, commentId);
  const body = editDrafts[key] ?? "";
  if (!body.trim()) return;
  post({ type: "editComment", threadId, commentId, body });
  cancelEdit(threadId, commentId);
}
function sendReply(threadId: string): void {
  const body = replyDrafts[threadId] ?? "";
  if (!body.trim()) return;
  post({ type: "addComment", threadId, body });
  delete replyDrafts[threadId];
  persist();
}
function openThread(thread: ReviewThread): void {
  if (thread.filePath) post({ type: "openFile", filePath: thread.filePath, line: thread.line, threadId: thread.id });
}
function collapseKey(thread: ReviewThread): string {
  return threadCollapseKey(mrKey.value || "no-merge-request", thread.id);
}
function isThreadCollapsed(thread: ReviewThread): boolean {
  return collapsedThreads[collapseKey(thread)] ?? thread.resolved;
}
function toggleThread(thread: ReviewThread): void {
  collapsedThreads[collapseKey(thread)] = !isThreadCollapsed(thread);
  persist();
}
function threadPanelId(thread: ReviewThread): string {
  return threadContentId("sidebar", mrKey.value || "no-merge-request", thread.id);
}
function lastComment(thread: ReviewThread): ReviewComment | undefined { return thread.comments.at(-1); }
function replyCount(thread: ReviewThread): number { return Math.max(0, thread.comments.length - 1); }
function relativeReplyTime(thread: ReviewThread): string { return formatRelativeReplyTime(lastComment(thread)?.createdAt); }
function reconcileThreads(threads: readonly ReviewThread[]): void {
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
  post({ type: "openFile", filePath: path });
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
function receiveState(event: MessageEvent<HostMessage<SidebarViewState>>): void {
  const message = event.data;
  if (handleCommentImageMessage(message)) return;
  if (message.type !== "state") return;
  stopReadyRetry();
  model.value = message.state;
  reconcileThreads(message.state.overview.threads);
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
        <GlIconButton v-if="activeTab === 'review'" icon="retry" label="Merge requestを再読み込み" :loading="overview?.isRefreshing" @click="post({ type: 'refreshReview' })" />
        <GlIconButton icon="account" label="ログイン状態を再確認" @click="post({ type: 'refreshAuth' })" />
      </span>
    </div>
    <div v-else-if="model" class="auth-prompt">
      <GlIcon name="account" />
      <span>{{ model.auth.phase === "checking" ? "Checking glab" : model.auth.phase === "signedOut" ? "Sign in to GitLab" : "glab unavailable" }}</span>
      <GlButton v-if="model.auth.phase === 'signedOut'" size="small" variant="confirm" @click="post({ type: 'login' })">Sign in</GlButton>
      <GlIconButton icon="retry" label="ログイン状態を再確認" size="small" @click="post({ type: 'refreshAuth' })" />
    </div>

    <SidebarTabs
      v-if="model?.auth.phase === 'available'"
      :active-tab="activeTab"
      :attention-count="attentionCount"
      @select="selectSidebarTab"
    />

    <MyWorkView
      v-if="activeTab === 'my-work' && model?.auth.phase === 'available'"
      :state="model.myWork"
      :initial-scroll-top="myWorkScrollTop"
      @refresh="post({ type: 'refreshMyWork' })"
      @open-mr="openMyWorkMergeRequest"
      @scroll-position="updateMyWorkScrollPosition"
    />

    <GlEmptyState v-if="activeTab === 'review' && (!overview || overview.loadState === 'loading')" title="Merge requestを読み込んでいます" icon="spinner" />
    <GlEmptyState
      v-else-if="activeTab === 'review' && overview && overview.loadState !== 'ready'"
      :title="overview.errorMessage || '表示できるMerge requestがありません'"
      icon="warning"
    >
      <template #actions><GlButton icon="retry" @click="post({ type: 'refreshReview' })">再試行</GlButton></template>
    </GlEmptyState>

    <div
      v-else-if="activeTab === 'review' && overview?.selectedMergeRequest"
      class="review-loaded"
      :class="{ 'branch-open': model?.branchTree.phase !== 'hidden' }"
    >
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
        </div>

        <div class="branch-flow" aria-label="Merge request branches">
          <button type="button" @click="post({ type: 'toggleBranchTree', branch: overview.sourceBranch })">
            <GlIcon name="branch" :size="14" />
            <span>{{ overview.sourceBranch }}</span>
          </button>
          <GlIcon name="arrow-right" :size="14" />
          <button type="button" @click="post({ type: 'toggleBranchTree', branch: overview.targetBranch })">
            <GlIcon name="branch" :size="14" />
            <span>{{ overview.targetBranch }}</span>
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
          <GlIconButton icon="retry" label="ローカルGit状態を更新" size="small" @click="post({ type: 'refreshLocalWorkspace' })" />
        </div>
        <p v-if="localWorkspace?.errorMessage" class="local-state-message is-danger"><GlIcon name="warning" :size="12" />{{ localWorkspace.errorMessage }}</p>
        <p v-else-if="localTarget?.kind === 'different-repository'" class="local-help">このMRとは異なるrepositoryです。</p>
        <p v-else-if="localTarget?.kind === 'missing'" class="local-help">対応するlocalまたはremote branchがありません。</p>
      </section>

      <GlSection v-if="model?.branchTree.phase !== 'hidden'" class="branch-explorer" :title="model?.branchTree.branch || 'Branch'" flush>
        <template #icon><GlIcon name="file-tree" /></template>
        <template #actions><GlIconButton icon="close" label="ブランチツリーを閉じる" size="small" @click="post({ type: 'closeBranchTree' })" /></template>
        <p v-if="model?.branchTree.phase === 'loading'" class="state-message"><GlIcon name="spinner" class="spin" /> 取得中</p>
        <p v-else-if="model?.branchTree.phase === 'error'" class="state-message is-danger">{{ model.branchTree.errorMessage }}</p>
        <div v-else class="tree">
          <TreeItem
            v-for="node in branchTree"
            :key="node.path"
            :node="node"
            kind="branch"
            :branch="model?.branchTree.branch"
            @open-branch="(branch, path) => post({ type: 'openBranchFile', branch, filePath: path })"
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
        <div id="changed-files-content" v-show="changedFilesExpanded" class="collapsible-section-content">
          <GlEmptyState v-if="!changedFiles.length" title="No changed files" icon="file" compact />
          <div v-else class="changed-scroll" :class="{ scrollable: changedFiles.length > 4 }">
            <TreeItem
              v-for="node in changedTree"
              :key="node.path"
              :node="node"
              kind="changed"
              :active-file-path="model?.activeFilePath"
              @open-changed="openChangedFile"
              @open-branch="() => {}"
            />
          </div>
        </div>
      </section>
      <div v-if="changedFilesExpanded && changedFiles.length > 4" class="resizer" role="separator" aria-label="Changed filesの高さを変更" tabindex="0" @pointerdown="beginResize" />

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
        <div id="commits-content" v-show="commitsExpanded" class="collapsible-section-content">
          <div v-if="overview.commits.length" class="commit-timeline" aria-label="Commit filter">
            <button type="button" :class="{ active: currentCommitId() === 'all' }" @click="selectCommit('all')">All</button>
            <button
              v-for="commit in overview.commits"
              :key="commit.id"
              type="button"
              :class="{ active: currentCommitId() === commit.id }"
              @click="selectCommit(commit.id)"
            >
              <span class="commit-dot" aria-hidden="true" /><code>{{ commit.shortId }}</code>
            </button>
          </div>
          <GlEmptyState v-if="!overview.commits.length" title="No commits" icon="commit" compact />
          <div v-else class="commit-list" :class="{ expanded: model?.commitDiff.phase !== 'hidden' }">
            <article v-for="commit in filteredCommits" :key="commit.id" class="commit-item">
              <button
                class="commit-row"
                type="button"
                :class="{ active: currentCommitId() === commit.id }"
                :aria-expanded="currentCommitId() === commit.id && selectedCommitDiffMatches"
                @click="selectCommit(commit.id)"
              >
                <span class="commit-dot" aria-hidden="true" />
                <code>{{ commit.shortId }}</code>
                <span class="gl-truncate">{{ commit.title }}</span>
                <span class="commit-author gl-truncate">{{ commit.authorName }}</span>
                <time>{{ formatDate(commit.committedAt) }}</time>
                <GlIcon :name="currentCommitId() === commit.id && selectedCommitDiffMatches ? 'chevron-up' : 'chevron-down'" :size="14" />
              </button>
              <div v-if="currentCommitId() === commit.id && selectedCommitDiffMatches" class="commit-detail">
                <header>
                  <span>{{ model?.commitDiff.phase === "ready" ? `${model.commitDiff.files.length} changed files` : commit.shortId }}</span>
                  <GlIconButton v-if="commit.webUrl" icon="external-link" label="GitLabでcommitを開く" size="small" @click="post({ type: 'openCommit', commitId: commit.id })" />
                </header>
                <p v-if="model?.commitDiff.phase === 'loading'" class="state-message"><GlIcon name="spinner" class="spin" /> 差分を取得中</p>
                <p v-else-if="model?.commitDiff.phase === 'error'" class="state-message is-danger">{{ model.commitDiff.errorMessage }}</p>
                <GlEmptyState v-else-if="!model?.commitDiff.files.length" title="変更ファイルはありません" icon="file" compact />
                <div v-else class="commit-files">
                  <button
                    v-for="file in model?.commitDiff.files ?? []"
                    :key="file.path"
                    type="button"
                    :disabled="file.collapsed || file.tooLarge"
                    @click="post({ type: 'openCommitFile', commitId: commit.id, filePath: file.path })"
                  >
                    <GlStatusBadge :status="file.status" />
                    <span class="gl-truncate">{{ file.renamedFile && file.oldPath !== file.newPath ? `${file.oldPath} → ${file.newPath}` : file.path }}</span>
                    <small v-if="file.collapsed || file.tooLarge">{{ file.tooLarge ? "too large" : "collapsed" }}</small>
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <GlSection class="thread-section" title="Review threads" :count="overview.threads.length" flush>
        <template #icon><GlIcon name="comments" /></template>
        <template #actions>
          <span class="open-count">{{ overview.unresolvedThreads }} open</span>
          <select :value="overview.threadSortOrder" aria-label="レビューの並び順" @change="setThreadSort">
            <option value="open-first">Open first</option>
            <option value="oldest">Oldest</option>
            <option value="newest">Newest</option>
          </select>
        </template>

        <div class="thread-list">
          <article
            v-for="thread in overview.threads"
            :key="thread.id"
            class="thread"
            :class="{ resolved: thread.resolved, collapsed: isThreadCollapsed(thread) }"
          >
            <header class="thread-header">
              <button
                class="thread-toggle"
                type="button"
                :aria-expanded="!isThreadCollapsed(thread)"
                :aria-controls="threadPanelId(thread)"
                :aria-label="`${isThreadCollapsed(thread) ? 'Expand' : 'Collapse'} discussion at ${thread.filePath || 'MR overview'}`"
                @click="toggleThread(thread)"
              >
                <GlIcon name="chevron-right" :size="12" />
                <GlAvatar
                  :name="lastComment(thread)?.author || 'GitLab user'"
                  :avatar-url="lastComment(thread)?.avatarUrl"
                />
                <span class="thread-heading">
                  <span v-if="isThreadCollapsed(thread)" class="thread-summary-line">
                    <strong class="reply-count-link">{{ replyCount(thread) }} replies</strong>
                    <span class="thread-last-reply gl-truncate">Last reply by <b>{{ lastComment(thread)?.author || "GitLab user" }}</b> {{ relativeReplyTime(thread) }}</span>
                  </span>
                  <template v-else>
                    <strong class="thread-expanded-title gl-truncate">{{ thread.filePath ? `${thread.filePath}${thread.line ? `:${thread.line}` : ""}` : "MR overview" }}</strong>
                    <span class="thread-last-reply">{{ thread.comments.length }} comments</span>
                  </template>
                  <span v-if="isThreadCollapsed(thread)" class="thread-location gl-truncate">{{ thread.filePath ? `${thread.filePath}${thread.line ? `:${thread.line}` : ""}` : "MR overview" }}</span>
                </span>
              </button>
              <span class="thread-actions">
                <GlButton
                  v-if="thread.filePath"
                  class="view-diff-action"
                  variant="link"
                  icon="external-link"
                  :aria-label="`View diff for ${thread.filePath}${thread.line ? ` at line ${thread.line}` : ''}`"
                  size="small"
                  @click.stop="openThread(thread)"
                >View diff</GlButton>
                <GlThreadStatusAction
                  :resolved="thread.resolved"
                  :pending="thread.pending"
                  :resolvable="thread.resolvable !== false"
                  @toggle="post({ type: 'toggleResolved', threadId: thread.id })"
                />
              </span>
            </header>

            <div v-show="!isThreadCollapsed(thread)" :id="threadPanelId(thread)" class="thread-content">
              <template v-for="comment in thread.comments" :key="comment.id">
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
                  <GlMarkdown :source="comment.body" :project-id="commentProjectId" />
                </GlComment>
                <GlCommentForm
                  v-else
                  v-model="editDrafts[commentKey(thread.id, comment.id)]"
                  aria-label="Edit comment"
                  submit-label="Save"
                  cancel-label="Cancel"
                  compact
                  :project-id="commentProjectId"
                  @update:model-value="persist"
                  @submit="saveEdit(thread.id, comment.id)"
                  @cancel="cancelEdit(thread.id, comment.id)"
                />
              </template>
              <GlCommentForm
                v-if="!thread.pending"
                v-model="replyDrafts[thread.id]"
                aria-label="Reply to thread"
                placeholder="Reply…"
                submit-label="Reply"
                compact
                :project-id="commentProjectId"
                @update:model-value="persist"
                @submit="sendReply(thread.id)"
              />
            </div>
          </article>
        </div>
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
  font-size: 9px;
}
.auth-identity, .top-toolbar { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); }
.auth-identity > :last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.top-toolbar { flex: none; gap: var(--gl-spacing-2); }
.auth-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gl-feedback-success); }
.auth-prompt { display: flex; align-items: center; gap: var(--gl-spacing-8); padding: var(--gl-spacing-8); color: var(--gl-text-subtle); background: var(--gl-surface-raised); }
.auth-prompt > span { flex: 1; }
.review-loaded { width: 100%; min-width: 0; max-width: 100%; display: grid; align-content: start; gap: var(--gl-spacing-12); }
.mr-header { display: grid; gap: var(--gl-spacing-8); padding: var(--gl-spacing-8) var(--gl-spacing-8) var(--gl-spacing-12); border-top: 2px solid var(--gl-accent-orange); border-bottom: 1px solid var(--gl-border-default); background: color-mix(in srgb, var(--gl-accent-orange) 4%, var(--gl-surface-default)); }
.mr-main { min-width: 0; display: grid; gap: var(--gl-spacing-4); }
.review-context-label { display: inline-flex; align-items: center; gap: var(--gl-spacing-4); width: fit-content; color: var(--gl-thread-accent); font-size: 10px; font-weight: 600; letter-spacing: .02em; }
.mr-title-row { min-width: 0; display: flex; align-items: flex-start; gap: var(--gl-spacing-8); }
.mr-title-row h1 { min-width: 0; margin: 0; color: var(--gl-text-strong); font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
.mr-meta { display: flex; gap: var(--gl-spacing-8); color: var(--gl-text-subtle); font-size: 10px; }
.mr-meta strong { color: var(--gl-text-link); }
.branch-flow { grid-column: 1 / -1; min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-text-subtle); }
.branch-flow button { min-width: 0; max-width: calc(50% - var(--gl-spacing-12)); display: flex; align-items: center; gap: var(--gl-spacing-4); padding: var(--gl-spacing-2) var(--gl-spacing-4); border-radius: var(--gl-radius-sm); color: inherit; background: transparent; cursor: pointer; }
.branch-flow button:hover { color: var(--gl-hover-text); background: var(--gl-hover-surface); }
.branch-flow button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 10px var(--vscode-editor-font-family); }
.mr-summary { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--gl-spacing-4) var(--gl-spacing-12); color: var(--gl-text-subtle); font-size: 10px; }
.mr-summary strong { color: var(--gl-text-strong); }
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
.local-workspace-title { flex: none; display: inline-flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-accent-purple); font-size: 10px; }
.local-current-branch { min-width: 52px; flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--gl-text-strong); font-size: 10px; white-space: nowrap; }
.local-dirty { flex: none; display: inline-flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-text-subtle); font-size: 9px; white-space: nowrap; }
.local-dirty.is-dirty { color: var(--gl-feedback-warning); }
.local-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gl-feedback-success); }
.is-dirty .local-status-dot { background: var(--gl-feedback-warning); }
.local-primary-action { flex: none; }
.local-state-message { display: flex; align-items: center; gap: var(--gl-spacing-4); margin: 0; color: var(--gl-text-subtle); font-size: 10px; }
.local-state-message.is-danger { color: var(--gl-feedback-danger); }
.local-help { margin: 0; color: var(--gl-text-subtle); font-size: 9px; line-height: 1.3; }
@media (max-width: 320px) {
  .local-workspace-row { flex-wrap: wrap; }
  .local-current-branch { order: 2; flex-basis: calc(100% - 64px); }
  .local-dirty { display: none; }
}
.branch-explorer { max-height: 220px; padding: var(--gl-spacing-8); overflow: auto; border-left: 2px solid var(--gl-feedback-brand); background: var(--gl-surface-raised); }
.tree { display: grid; gap: var(--gl-spacing-2); }
.state-message { display: flex; align-items: center; gap: var(--gl-spacing-4); margin: 0; padding: var(--gl-spacing-8); color: var(--gl-text-subtle); }
.state-message.is-danger { color: var(--gl-feedback-danger); }
.collapsible-section { min-width: 0; display: grid; gap: var(--gl-spacing-4); }
.collapsible-section-header {
  width: 100%;
  min-width: 0;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gl-spacing-8);
  padding: 0 var(--gl-spacing-8);
  border: 0;
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
  overflow: hidden;
  border: 1px solid var(--gl-border-default);
  border-left: 2px solid var(--gl-changed-accent);
  border-radius: var(--gl-radius-md);
  background: var(--gl-surface-raised);
}
.changed-section > .collapsible-section-header {
  border-bottom: 1px solid var(--gl-border-default);
  background: color-mix(in srgb, var(--gl-changed-accent) 8%, var(--gl-surface-subtle));
}
.changed-section > .collapsible-section-header[aria-expanded="false"] { border-bottom: 0; }
.changed-section .collapsible-section-title > .gl-icon { color: var(--gl-changed-accent); }
.changed-scroll { min-width: 0; min-height: 0; padding: var(--gl-spacing-4) 0 var(--gl-spacing-4) var(--gl-spacing-4); overflow: visible; }
.changed-scroll.scrollable { max-height: var(--changed-height); overflow-x: hidden; overflow-y: auto; }
.diff-stats { display: flex; gap: var(--gl-spacing-8); font-size: 10px; }
.resizer { height: 5px; margin-top: calc(var(--gl-spacing-12) * -1); cursor: row-resize; }
.resizer::before { content: ""; display: block; width: 32px; height: 2px; margin: 3px auto; border-radius: var(--gl-radius-pill); background: var(--gl-border-strong); }
.commit-timeline { display: flex; gap: var(--gl-spacing-4); overflow-x: auto; padding-bottom: var(--gl-spacing-4); }
.commit-timeline button { min-height: 24px; display: flex; align-items: center; gap: var(--gl-spacing-4); padding: var(--gl-spacing-2) var(--gl-spacing-8); border-radius: var(--gl-radius-pill); color: var(--gl-text-subtle); background: transparent; cursor: pointer; }
.commit-timeline button:hover { background: var(--gl-hover-surface); }
.commit-timeline button.active { color: var(--gl-commit-accent); background: color-mix(in srgb, var(--gl-commit-accent) 14%, transparent); }
.commit-dot { width: 7px; height: 7px; flex: none; border: 2px solid currentColor; border-radius: 50%; color: var(--gl-commit-accent); }
.commit-list { max-height: 168px; overflow: auto; border-top: 1px solid var(--gl-border-subtle); }
.commit-list.expanded { max-height: 430px; }
.commit-item { position: relative; border-bottom: 1px solid var(--gl-border-subtle); }
.commit-item:not(:last-child)::before { content: ""; position: absolute; left: 11px; top: 22px; bottom: -1px; width: 1px; background: color-mix(in srgb, var(--gl-commit-accent) 60%, transparent); pointer-events: none; }
.commit-row { width: 100%; min-width: 0; min-height: 32px; display: grid; grid-template-columns: 8px 52px minmax(90px, 1fr) minmax(48px, auto) auto 16px; gap: var(--gl-spacing-8); align-items: center; padding: var(--gl-spacing-4) var(--gl-spacing-8); color: var(--gl-text-default); background: transparent; text-align: left; cursor: pointer; }
.commit-row:hover { background: var(--gl-hover-surface); }
.commit-row.active { background: color-mix(in srgb, var(--gl-commit-accent) 12%, var(--gl-surface-raised)); box-shadow: inset 2px 0 var(--gl-commit-accent); }
.commit-row .commit-author, .commit-row time { color: var(--gl-text-subtle); font-size: 10px; }
.commit-detail { border-top: 1px solid var(--gl-border-subtle); background: var(--gl-surface-subtle); }
.commit-detail > header { min-height: 28px; display: flex; justify-content: space-between; align-items: center; padding: var(--gl-spacing-4) var(--gl-spacing-8); color: var(--gl-text-subtle); font-size: 10px; }
.commit-files { display: grid; border-top: 1px solid var(--gl-border-subtle); }
.commit-files button { min-height: 30px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--gl-spacing-8); align-items: center; padding: var(--gl-spacing-4) var(--gl-spacing-8); color: var(--gl-text-default); background: transparent; text-align: left; cursor: pointer; }
.commit-files button:hover:not(:disabled) { background: var(--gl-hover-surface); }
.commit-files small { color: var(--gl-text-subtle); }
.open-count { color: var(--gl-text-subtle); font-size: 10px; }
select { min-height: 24px; border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-sm); color: var(--vscode-dropdown-foreground, var(--gl-text-default)); background: var(--vscode-dropdown-background, var(--gl-surface-raised)); }
.thread-list { min-width: 0; display: grid; gap: var(--gl-spacing-8); }
.commit-section .collapsible-section-title > .gl-icon { color: var(--gl-commit-accent); }
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
.thread-toggle > :first-child { color: var(--gl-text-subtle); transition: transform .12s; }
.thread.resolved .thread-toggle > :first-child { color: var(--gl-resolved-accent); }
.thread-toggle[aria-expanded="true"] > :first-child { transform: rotate(90deg); }
.thread-heading { min-width: 0; flex: 1; display: grid; gap: 1px; overflow: hidden; }
.thread-summary-line { min-width: 0; display: flex; align-items: baseline; gap: var(--gl-spacing-4); overflow: hidden; white-space: nowrap; }
.reply-count-link { flex: none; color: var(--gl-text-link); font-size: 11px; text-decoration: underline; }
.thread-last-reply { min-width: 0; color: var(--gl-text-subtle); font-size: 10px; }
.thread-last-reply b, .thread-expanded-title { color: var(--gl-text-strong); font-size: 11px; }
.thread-location { color: var(--gl-text-subtle); font: 9px var(--vscode-editor-font-family); }
.view-diff-action { min-height: 28px; white-space: nowrap; color: var(--gl-thread-accent); }
.view-diff-action:hover:not(:disabled) { color: var(--gl-text-strong); background: color-mix(in srgb, var(--gl-thread-accent) 12%, transparent); }
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
  .commit-row { grid-template-columns: 8px 48px minmax(0, 1fr) auto 16px; }
  .commit-author { display: none; }
}
</style>
