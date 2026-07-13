<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { buildCommitFileDiff, parseCommitDiff } from "../../src/commitDiffUtils";
import type { CommitFileDiffLine, CommitPatchLine } from "../../src/commitDiffUtils";
import { buildSideBySideRows } from "../../src/diffUtils";
import type { CommitDiffStatus } from "../../src/reviewTypes";
import type { CommitDiffMessage, CommitDiffViewState, HostMessage, ReadyMessage } from "../../src/webviewProtocol";
import GlDiffHeader from "../common/components/GlDiffHeader.vue";
import GlDiffSideBySideTable, { type GlDiffSideLine } from "../common/components/GlDiffSideBySideTable.vue";
import GlDiffScopeToggle, { type GlDiffScope } from "../common/components/GlDiffScopeToggle.vue";
import GlEmptyState from "../common/components/GlEmptyState.vue";
import GlIcon, { type GlIconName } from "../common/components/GlIcon.vue";
import { vscode } from "../common/vscode";

interface EmptyState {
  description: string;
  icon: GlIconName;
  title: string;
}

const state = shallowRef<CommitDiffViewState>();
const scope = ref<GlDiffScope>("changes");
let readyRetry: number | undefined;

const displayPath = computed(() => {
  const file = state.value?.file;
  if (!file) return "";
  return file.renamedFile && file.oldPath !== file.newPath
    ? `${file.oldPath} → ${file.newPath}`
    : file.path;
});

const statusLabel = computed(() => {
  const status = state.value?.file.status;
  if (!status) return "";
  return STATUS_LABELS[status];
});

const patchLines = computed(() => {
  const file = state.value?.file;
  if (!file || file.tooLarge || file.collapsed || file.diff.length === 0) return [];
  return parseCommitDiff(file.diff);
});

const fullLines = computed(() => {
  const fullFile = state.value?.fullFile;
  return fullFile ? buildCommitFileDiff(fullFile.oldText, fullFile.newText) : [];
});

const lines = computed(() => scope.value === "file" && state.value?.fullFile ? fullLines.value : patchLines.value);
type CommitDiffLine = CommitPatchLine | CommitFileDiffLine;

const sideBySideLines = computed(() => {
  const rows = buildSideBySideRows<CommitDiffLine>(lines.value, {
    leftKinds: new Set(["deleted"]),
    rightKinds: new Set(["added"]),
    contextKinds: new Set(["context"])
  });
  return rows.map((row) => ({
    ...row,
    left: commitSideLine(row.left, "left"),
    right: commitSideLine(row.right, "right")
  }));
});

function commitSideLine(line: CommitDiffLine | undefined, side: "left" | "right"): GlDiffSideLine | undefined {
  if (!line) return undefined;
  return {
    kind: line.kind,
    text: line.text,
    line: side === "left" ? line.oldLine : line.newLine
  };
}

const emptyState = computed<EmptyState | undefined>(() => {
  const file = state.value?.file;
  if (!file) return undefined;
  if (scope.value === "file" && !state.value?.fullFile) return undefined;
  if (file.tooLarge) {
    return {
      icon: "warning",
      title: "差分を表示できません",
      description: "この差分は大きすぎるため、GitLab から内容が返されませんでした。"
    };
  }
  if (file.collapsed) {
    return {
      icon: "information",
      title: "差分は折りたたまれています",
      description: "この差分は GitLab 側で折りたたまれています。"
    };
  }
  if (file.diff.length === 0) {
    return {
      icon: "file",
      title: "表示できる変更はありません",
      description: "このファイルには表示できる patch がありません。"
    };
  }
  return undefined;
});

const STATUS_LABELS: Record<CommitDiffStatus, string> = {
  new: "追加",
  deleted: "削除",
  renamed: "名前変更",
  modified: "変更"
};

function receiveMessage(event: MessageEvent<HostMessage<CommitDiffViewState>>): void {
  if (event.data?.type !== "state") return;
  stopReadyRetry();
  state.value = event.data.state;
}

function setScope(next: GlDiffScope): void {
  scope.value = next;
  if (next === "file" && !state.value?.fullFile && !state.value?.fullFileLoading) {
    const message: CommitDiffMessage = { type: "loadFullFile" };
    vscode.postMessage(message);
  }
}

function requestInitialState(): void {
  const ready: ReadyMessage = { type: "ready" };
  vscode.postMessage(ready);
}

function stopReadyRetry(): void {
  if (readyRetry === undefined) return;
  window.clearInterval(readyRetry);
  readyRetry = undefined;
}

onMounted(() => {
  window.addEventListener("message", receiveMessage);
  readyRetry = window.setInterval(requestInitialState, 500);
  requestInitialState();
});

onBeforeUnmount(() => {
  stopReadyRetry();
  window.removeEventListener("message", receiveMessage);
});
</script>

<template>
  <main class="commit-diff-app">
    <p v-if="!state" class="loading-state" role="status">
      差分を読み込んでいます…
    </p>

    <section v-else class="diff-card" :aria-label="`${displayPath} のコミット差分`">
      <GlDiffHeader
        :path="displayPath"
        :status="state.file.status"
        :status-label="statusLabel"
      >
        <template #meta>
          <span class="commit-meta" :title="state.commit.title">
            <GlIcon name="commit" />
            <code>{{ state.commit.shortId }}</code>
            <span class="commit-title">{{ state.commit.title }}</span>
          </span>
        </template>
      </GlDiffHeader>

      <div class="diff-toolbar">
        <span class="scope-label">表示範囲</span>
        <GlDiffScopeToggle
          :model-value="scope"
          :loading="Boolean(state.fullFileLoading)"
          @update:model-value="setScope"
        />
        <span v-if="state.fullFileLoading" class="scope-status" role="status">ファイル全体を読み込んでいます…</span>
        <button v-else-if="state.fullFileError" class="scope-retry" type="button" @click="setScope('file')">再読み込み</button>
      </div>

      <div v-if="emptyState" role="status">
        <GlEmptyState
          :icon="emptyState.icon"
          :title="emptyState.title"
          :description="emptyState.description"
        />
      </div>

      <div v-else-if="scope === 'file' && !state.fullFile" class="full-file-status" role="status">
        <GlEmptyState
          v-if="state.fullFileError"
          icon="warning"
          title="ファイル全体を表示できません"
          :description="state.fullFileError"
        />
        <p v-else>ファイル全体を読み込んでいます…</p>
      </div>

      <GlDiffSideBySideTable
        v-else
        :rows="sideBySideLines"
        left-label="変更前"
        right-label="変更後"
        aria-label="コミットのファイル差分"
      />
    </section>
  </main>
</template>

<style scoped>
.commit-diff-app {
  min-height: 100vh;
  padding: var(--gl-spacing-16);
  color: var(--vscode-editor-foreground);
  background: var(--gl-surface-default);
}

.diff-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--gl-border-default);
  border-radius: var(--gl-radius-md);
  background: var(--gl-surface-raised);
}

.commit-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--gl-spacing-4);
  color: var(--gl-text-subtle);
  font-size: 11px;
}

.commit-meta > .gl-icon { color: var(--gl-commit-accent); }

.commit-meta code {
  flex: none;
  color: var(--gl-text-default);
  font-family: var(--vscode-editor-font-family);
}

.commit-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loading-state {
  margin: 0;
  padding: var(--gl-spacing-24);
  color: var(--gl-text-subtle);
  text-align: center;
}

.diff-toolbar {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: var(--gl-spacing-8);
  padding: var(--gl-spacing-4) var(--gl-spacing-12);
  border-bottom: 1px solid var(--gl-border-default);
  color: var(--gl-text-subtle);
  background: var(--vscode-editor-background);
  font-size: 10px;
}

.scope-label { flex: none; }
.scope-status { color: var(--gl-text-subtle); }
.scope-retry {
  padding: var(--gl-spacing-2) var(--gl-spacing-4);
  border: 0;
  color: var(--gl-text-link);
  background: transparent;
  cursor: pointer;
}
.scope-retry:hover { background: var(--gl-hover-surface); }
.full-file-status { padding: var(--gl-spacing-24); }
.full-file-status p { margin: 0; color: var(--gl-text-subtle); text-align: center; }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 560px) {
  .commit-diff-app {
    padding: 0;
  }

  .diff-card {
    border-right: 0;
    border-left: 0;
    border-radius: 0;
  }
}
</style>
