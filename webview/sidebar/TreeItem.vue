<script setup lang="ts">
import { ref } from "vue";
import type { BranchTreeNode } from "../../src/branchTreeUtils";
import type { ChangedFileTreeNode } from "../../src/reviewTreeUtils";
import GlIcon from "../common/components/GlIcon.vue";

defineOptions({ name: "TreeItem" });
const props = defineProps<{
  node: BranchTreeNode | ChangedFileTreeNode;
  kind: "branch" | "changed";
  branch?: string;
  activeFilePath?: string;
}>();
const emit = defineEmits<{
  openChanged: [path: string];
  openBranch: [branch: string, path: string];
}>();
const expanded = ref(false);

function isTree(): boolean { return props.node.type === "tree"; }
function open(): void {
  if (isTree()) return;
  if (props.kind === "changed") emit("openChanged", props.node.path);
  else if (props.branch) emit("openBranch", props.branch, props.node.path);
}
function forwardBranch(branch: string, path: string): void { emit("openBranch", branch, path); }
function syncExpanded(event: Event): void {
  expanded.value = (event.currentTarget as HTMLDetailsElement).open;
}
</script>

<template>
  <details v-if="isTree()" class="tree-directory" :open="expanded" @toggle="syncExpanded">
    <summary :title="node.path">
      <GlIcon class="directory-chevron" name="chevron-right" :size="12" />
      <GlIcon class="directory-icon" name="folder" :size="14" />
      <span class="tree-name">{{ node.name }}</span>
      <span class="directory-count">{{ node.children.length }}</span>
    </summary>
    <div v-if="expanded" class="tree-children">
      <TreeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :kind="kind"
        :branch="branch"
        :active-file-path="activeFilePath"
        @open-changed="emit('openChanged', $event)"
        @open-branch="forwardBranch"
      />
    </div>
  </details>
  <button
    v-else
    class="tree-file"
    :class="{ 'active-file': kind === 'changed' && node.path === activeFilePath }"
    type="button"
    :aria-current="kind === 'changed' && node.path === activeFilePath ? 'true' : undefined"
    :title="node.path"
    @click="open"
  >
    <GlIcon name="file" :size="14" />
    <span class="tree-name">{{ node.name }}</span>
    <span v-if="kind === 'changed' && 'file' in node && node.file" class="file-stats">
      <span v-if="node.file.additions" class="gl-text-success">+{{ node.file.additions }}</span>
      <span v-if="node.file.deletions" class="gl-text-danger">−{{ node.file.deletions }}</span>
      <span v-if="node.file.unresolvedThreadCount" class="discussion-count" :title="`${node.file.unresolvedThreadCount}件の未解決コメント`">
        <GlIcon name="comments" :size="12" />{{ node.file.unresolvedThreadCount }}
      </span>
      <GlIcon v-if="node.file.hasLocalEdit" class="local-edit-mark" name="pencil" :size="12" label="ローカル編集あり" />
    </span>
  </button>
</template>

<style scoped>
.tree-directory > summary, .tree-file {
  width: 100%;
  min-width: 0;
  min-height: 27px;
  display: flex;
  align-items: center;
  gap: var(--gl-spacing-4);
  border-radius: var(--gl-radius-sm);
  color: var(--gl-text-default);
  font: 11px var(--vscode-editor-font-family);
  text-align: left;
}
.tree-directory > summary { padding: 0 var(--gl-spacing-4); cursor: pointer; list-style: none; font-weight: 600; }
.tree-directory > summary::-webkit-details-marker { display:none; }
.directory-chevron { color: var(--gl-text-subtle); transition: transform .12s; }
.tree-directory[open] > summary > .directory-chevron { transform: rotate(90deg); }
.directory-icon { color: var(--gl-text-subtle); }
.tree-directory > summary:hover, .tree-file:hover { color:var(--gl-hover-text); background:var(--gl-hover-surface); }
.tree-file { padding: 0 var(--gl-spacing-4) 0 21px; background: transparent; cursor: pointer; }
.tree-name { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.directory-count { min-width: 16px; color: var(--gl-text-subtle); font: 9px var(--vscode-font-family); text-align: right; }
.tree-children { display: grid; margin-left: 10px; padding-left: 8px; border-left: 1px solid var(--gl-border-subtle); }
.active-file {
  color: var(--gl-selected-text);
  background: color-mix(in srgb, var(--gl-changed-accent) 11%, var(--gl-surface-raised));
  box-shadow: inset 3px 0 var(--gl-changed-accent);
}
.active-file > :first-child { color: var(--gl-changed-accent); }
.file-stats { display:inline-flex; gap:var(--gl-spacing-8); align-items:center; color:var(--gl-text-subtle); font-size:10px; white-space:nowrap; }
.discussion-count { display:inline-flex; align-items:center; gap:var(--gl-spacing-2); color:var(--gl-thread-accent); font-weight:600; }
.local-edit-mark { color:var(--gl-local-accent); }

@media (forced-colors: active) {
  .active-file { border: 1px solid Highlight; box-shadow: none; }
}
</style>
