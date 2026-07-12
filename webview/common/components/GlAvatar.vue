<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  name: string;
  avatarUrl?: string;
  size?: "small" | "medium";
}>(), { size: "small" });
const failed = ref(false);
const initials = computed(() => props.name.trim().split(/\s+/).slice(0, 2)
  .map((part) => part[0]?.toUpperCase()).join("") || "?");
const showImage = computed(() => Boolean(props.avatarUrl) && !failed.value);
const avatarColors = ["avatar-color-orange", "avatar-color-purple", "avatar-color-blue", "avatar-color-green", "avatar-color-cyan", "avatar-color-rose"] as const;
const avatarColorClass = computed(() => {
  let hash = 0;
  for (const character of props.name.trim().toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return avatarColors[hash % avatarColors.length];
});

watch(() => props.avatarUrl, () => { failed.value = false; });
</script>

<template>
  <img
    v-if="showImage"
    class="gl-avatar"
    :class="[`is-${size}`, avatarColorClass]"
    :src="avatarUrl"
    :alt="`${name} avatar`"
    @error="failed = true"
  >
  <span v-else class="gl-avatar" :class="[`is-${size}`, avatarColorClass]" :aria-label="`${name} avatar`" role="img">{{ initials }}</span>
</template>

<style scoped>
.gl-avatar {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  flex: none;
  overflow: hidden;
  border: 1px solid var(--gl-border-default);
  border-radius: 50%;
  color: var(--gl-text-strong);
  background: var(--gl-feedback-brand-subtle);
  object-fit: cover;
  font-size: 10px;
  font-weight: 600;
}
.is-small { width: 24px; height: 24px; font-size: 9px; }
.avatar-color-orange { color: #6b341d; background: color-mix(in srgb, var(--gl-accent-orange) 24%, var(--gl-surface-raised)); }
.avatar-color-purple { color: #453a7d; background: color-mix(in srgb, var(--gl-accent-purple) 24%, var(--gl-surface-raised)); }
.avatar-color-blue { color: #1f4e85; background: color-mix(in srgb, var(--gl-accent-blue) 24%, var(--gl-surface-raised)); }
.avatar-color-green { color: #2e633d; background: color-mix(in srgb, var(--gl-accent-green) 24%, var(--gl-surface-raised)); }
.avatar-color-cyan { color: #1d5d65; background: color-mix(in srgb, var(--gl-accent-cyan) 24%, var(--gl-surface-raised)); }
.avatar-color-rose { color: #7b3854; background: color-mix(in srgb, #d66b92 24%, var(--gl-surface-raised)); }
body.vscode-dark .avatar-color-orange { color: #ffd9c5; }
body.vscode-dark .avatar-color-purple { color: #e1d9ff; }
body.vscode-dark .avatar-color-blue { color: #d3e5ff; }
body.vscode-dark .avatar-color-green { color: #cdebd4; }
body.vscode-dark .avatar-color-cyan { color: #c9f2f3; }
body.vscode-dark .avatar-color-rose { color: #f5d3df; }
</style>
