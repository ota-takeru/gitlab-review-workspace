<script setup lang="ts">
import GlIcon, { type GlIconName } from "./GlIcon.vue";

withDefaults(defineProps<{
  variant?: "default" | "confirm" | "danger" | "link";
  size?: "small" | "medium";
  icon?: GlIconName;
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
}>(), { variant: "default", size: "medium", type: "button" });
</script>

<template>
  <button class="gl-button" :class="[`is-${variant}`, `is-${size}`]" :type="type" :disabled="disabled || loading" :aria-label="ariaLabel">
    <GlIcon v-if="loading" class="spin" name="spinner" />
    <GlIcon v-else-if="icon" :name="icon" />
    <span v-if="$slots.default"><slot /></span>
  </button>
</template>

<style scoped>
.gl-button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gl-spacing-4);
  padding: var(--gl-spacing-4) var(--gl-spacing-12);
  border: 1px solid var(--gl-border-default);
  border-radius: var(--gl-radius-md);
  color: var(--vscode-button-secondaryForeground, var(--gl-text-default));
  background: var(--vscode-button-secondaryBackground, var(--gl-surface-raised));
  cursor: pointer;
}
.gl-button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--gl-hover-surface)); }
.is-small { min-height: 24px; padding: var(--gl-spacing-2) var(--gl-spacing-8); font-size: 11px; }
.is-confirm { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: transparent; }
.is-confirm:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.is-danger { color: var(--gl-feedback-danger); background: var(--gl-feedback-danger-subtle); border-color: color-mix(in srgb, var(--gl-feedback-danger) 45%, transparent); }
.is-link { min-height: 24px; padding: var(--gl-spacing-2) var(--gl-spacing-8); border-color: transparent; border-radius: var(--gl-radius-sm); color: var(--gl-text-link); background: transparent; }
.is-link:hover:not(:disabled) { text-decoration: none; background: color-mix(in srgb, var(--gl-thread-accent) 10%, transparent); }
</style>
