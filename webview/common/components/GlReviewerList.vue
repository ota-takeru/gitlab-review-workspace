<script setup lang="ts">
import type { ReviewUser } from "../../../src/reviewTypes";
import GlAvatar from "./GlAvatar.vue";

withDefaults(defineProps<{
  reviewers: readonly ReviewUser[];
  compact?: boolean;
}>(), { compact: false });
</script>

<template>
  <span v-if="reviewers.length" class="gl-reviewer-list" :class="{ 'is-compact': compact }" aria-label="Reviewers">
    <span class="gl-reviewer-label">Reviewers</span>
    <span
      v-for="reviewer in reviewers"
      :key="reviewer.id ?? reviewer.username ?? reviewer.name"
      class="gl-reviewer"
      :title="reviewer.name"
    >
      <GlAvatar :name="reviewer.name" :avatar-url="reviewer.avatarUrl" size="small" />
      <span v-if="!compact" class="gl-reviewer-name gl-truncate">{{ reviewer.name }}</span>
    </span>
  </span>
</template>

<style scoped>
.gl-reviewer-list {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gl-spacing-4) var(--gl-spacing-8);
  color: var(--gl-text-subtle);
  font-size: 10px;
}
.gl-reviewer-label { flex: none; font-weight: 600; }
.gl-reviewer { min-width: 0; display: inline-flex; align-items: center; gap: var(--gl-spacing-4); }
.gl-reviewer-name { max-width: 140px; color: var(--gl-text-default); }
.is-compact { gap: var(--gl-spacing-2) var(--gl-spacing-4); }
.is-compact .gl-reviewer-label { margin-right: var(--gl-spacing-2); }
</style>
