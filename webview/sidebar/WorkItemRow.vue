<script setup lang="ts">
import { computed } from "vue";
import type { MyWorkItem, MyWorkMergeRequest } from "../../src/myWorkTypes";
import GlBadge from "../common/components/GlBadge.vue";
import GlIcon from "../common/components/GlIcon.vue";
import GlReviewerList from "../common/components/GlReviewerList.vue";

const props = defineProps<{ item: MyWorkItem }>();
defineEmits<{ openMr: [item: MyWorkMergeRequest] }>();

const isCandidate = computed(() => props.item.kind === "mr-candidate");
const mr = computed(() => props.item.kind === "merge-request" ? props.item : undefined);

const primaryReason = computed(() => {
  const reasons = mr.value?.attentionReasons ?? [];
  const priority = [
    ["conflict", "Conflict"],
    ["pipeline-failed", "Pipeline failed"],
    ["approval-required", "Approval required"],
    ["review-requested", "Review requested"],
    ["mentioned", "Mentioned"],
    ["assigned", "Assigned"],
    ["todo", "Todo"]
  ] as const;
  return priority.find(([reason]) => reasons.includes(reason))?.[1];
});

function relativeTime(value?: string): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(timestamp));
}
</script>

<template>
  <article v-if="isCandidate && item.kind === 'mr-candidate'" class="work-row candidate-row">
    <div class="work-row-topline">
      <GlBadge tone="brand" icon="branch">MR candidate</GlBadge>
      <time v-if="item.updatedAt">{{ relativeTime(item.updatedAt) }}</time>
    </div>
    <strong class="work-reference gl-truncate">{{ item.sourceProjectPath }}:{{ item.sourceBranch }}</strong>
    <div class="work-flow">
      <GlIcon name="arrow-right" :size="12" />
      <span class="gl-truncate">{{ item.targetProjectPath }}:{{ item.targetBranch }}</span>
    </div>
    <div class="work-meta"><span>{{ item.commitCount }} commits</span><span>Open MRなし</span></div>
  </article>

  <button
    v-else-if="mr"
    class="work-row mr-row"
    type="button"
    @click="$emit('openMr', mr)"
  >
    <span class="work-row-topline">
      <span class="work-badges">
        <GlBadge v-if="primaryReason" tone="warning">{{ primaryReason }}</GlBadge>
        <GlBadge v-else-if="mr.draft" tone="neutral">Draft</GlBadge>
        <GlBadge v-for="role in mr.roles" :key="role" tone="info">{{ role }}</GlBadge>
      </span>
      <time v-if="mr.updatedAt">{{ relativeTime(mr.updatedAt) }}</time>
    </span>
    <strong class="work-reference gl-truncate">{{ mr.projectPath }} !{{ mr.iid }}</strong>
    <span class="work-title">{{ mr.title }}</span>
    <span class="work-flow">
      <GlIcon name="branch" :size="12" />
      <code class="gl-truncate">{{ mr.sourceBranch }}</code>
      <GlIcon name="arrow-right" :size="11" />
      <code class="gl-truncate">{{ mr.targetBranch }}</code>
    </span>
    <GlReviewerList :reviewers="mr.reviewers" compact />
  </button>
</template>

<style scoped>
.work-row {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: var(--gl-spacing-4);
  padding: var(--gl-spacing-8);
  border: 1px solid var(--gl-border-default);
  border-left: 3px solid var(--gl-thread-accent);
  border-radius: var(--gl-radius-md);
  color: var(--gl-text-default);
  background: var(--gl-surface-raised);
  text-align: left;
}
.mr-row { cursor: pointer; }
.mr-row:hover { background: var(--gl-hover-surface); border-color: var(--gl-border-strong); }
.candidate-row { border-left-color: var(--gl-accent-purple); background: color-mix(in srgb, var(--gl-accent-purple) 5%, var(--gl-surface-raised)); }
.work-row-topline { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--gl-spacing-8); }
.work-row-topline time { flex: none; color: var(--gl-text-subtle); font-size: 9px; }
.work-badges { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: var(--gl-spacing-2); }
.work-reference { color: var(--gl-text-link); font: 600 10px var(--vscode-editor-font-family); }
.work-title { color: var(--gl-text-strong); font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
.work-flow { min-width: 0; display: flex; align-items: center; gap: var(--gl-spacing-4); color: var(--gl-text-subtle); font-size: 9px; }
.work-flow code, .work-flow span { min-width: 0; font-size: inherit; }
.work-meta { display: flex; flex-wrap: wrap; gap: var(--gl-spacing-8); color: var(--gl-text-subtle); font-size: 9px; }
</style>
