<script setup lang="ts">
import GlBadge from "../common/components/GlBadge.vue";

defineProps<{
  activeTab: "review" | "my-work";
  attentionCount: number;
}>();

defineEmits<{
  select: [tab: "review" | "my-work"];
}>();
</script>

<template>
  <nav class="sidebar-tabs" aria-label="GitLab workspace views">
    <button
      type="button"
      role="tab"
      :aria-selected="activeTab === 'review'"
      :class="{ active: activeTab === 'review' }"
      @click="$emit('select', 'review')"
    >
      Review
    </button>
    <button
      type="button"
      role="tab"
      :aria-selected="activeTab === 'my-work'"
      :class="{ active: activeTab === 'my-work' }"
      @click="$emit('select', 'my-work')"
    >
      My work
      <GlBadge v-if="attentionCount > 0" tone="warning" pill>{{ attentionCount }}</GlBadge>
    </button>
  </nav>
</template>

<style scoped>
.sidebar-tabs {
  position: sticky;
  top: 0;
  z-index: 8;
  min-height: 36px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 0 var(--gl-spacing-8);
  border-bottom: 1px solid var(--gl-border-default);
  background: var(--vscode-sideBar-background, var(--gl-surface-subtle));
}
.sidebar-tabs button {
  position: relative;
  min-width: 0;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gl-spacing-4);
  color: var(--gl-text-subtle);
  background: transparent;
  cursor: pointer;
}
.sidebar-tabs button::after {
  content: "";
  position: absolute;
  right: var(--gl-spacing-8);
  bottom: -1px;
  left: var(--gl-spacing-8);
  height: 2px;
  border-radius: var(--gl-radius-pill) var(--gl-radius-pill) 0 0;
  background: transparent;
}
.sidebar-tabs button:hover { color: var(--gl-text-strong); background: var(--gl-hover-surface); }
.sidebar-tabs button.active { color: var(--gl-text-strong); font-weight: 600; }
.sidebar-tabs button.active::after { background: var(--gl-accent-orange); }
.sidebar-tabs :deep(.gl-badge) { min-height: 16px; padding-block: 1px; }
</style>
