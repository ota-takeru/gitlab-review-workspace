<script setup lang="ts">
import GlIcon, { type GlIconName } from "./GlIcon.vue";

withDefaults(defineProps<{
  icon: GlIconName;
  label: string;
  size?: "small" | "medium";
  variant?: "default" | "subtle" | "danger";
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
}>(), { size: "medium", variant: "subtle", type: "button" });
</script>

<template>
  <button class="gl-icon-button" :class="[`is-${size}`, `is-${variant}`]" :type="type" :disabled="disabled || loading" :aria-label="label" :title="label">
    <GlIcon :class="{ spin: loading }" :name="loading ? 'spinner' : icon" />
  </button>
</template>

<style scoped>
.gl-icon-button {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--gl-radius-md);
  color: var(--gl-text-subtle);
  background: transparent;
  cursor: pointer;
}
.gl-icon-button:hover:not(:disabled) { color: var(--gl-hover-text); background: var(--gl-hover-surface); }
.is-small { width: 24px; height: 24px; border-radius: var(--gl-radius-sm); }
.is-default { border-color: var(--gl-border-default); color: var(--vscode-button-secondaryForeground, var(--gl-text-default)); background: var(--vscode-button-secondaryBackground, var(--gl-surface-raised)); }
.is-danger { color: var(--gl-feedback-danger); }
</style>
