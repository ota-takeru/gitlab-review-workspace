<script setup lang="ts">
import GlIcon from "./GlIcon.vue";

export type GlDiffScope = "changes" | "file";

withDefaults(defineProps<{
  modelValue: GlDiffScope;
  fullFileAvailable?: boolean;
  loading?: boolean;
}>(), { fullFileAvailable: true, loading: false });

const emit = defineEmits<{ "update:modelValue": [value: GlDiffScope] }>();
</script>

<template>
  <div class="gl-diff-scope" role="group" aria-label="Diff display range">
    <button
      type="button"
      class="scope-option"
      :class="{ active: modelValue === 'changes' }"
      :aria-pressed="modelValue === 'changes'"
      @click="emit('update:modelValue', 'changes')"
    >
      <GlIcon name="code" :size="12" />Changed lines
    </button>
    <button
      type="button"
      class="scope-option"
      :class="{ active: modelValue === 'file' }"
      :aria-pressed="modelValue === 'file'"
      :disabled="!fullFileAvailable || loading"
      :title="fullFileAvailable ? 'Show entire file' : 'Click to load the entire file'"
      @click="emit('update:modelValue', 'file')"
    >
      <GlIcon v-if="loading" name="spinner" class="spin" :size="12" />
      <GlIcon v-else name="file" :size="12" />Entire file
    </button>
  </div>
</template>

<style scoped>
.gl-diff-scope {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 1px;
  border: 1px solid var(--gl-border-default);
  border-radius: var(--gl-radius-sm);
  background: var(--gl-surface-raised);
}
.scope-option {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  gap: var(--gl-spacing-4);
  padding: var(--gl-spacing-2) var(--gl-spacing-8);
  border: 0;
  border-radius: var(--gl-radius-sm);
  color: var(--gl-text-subtle);
  background: transparent;
  font-size: 10px;
  cursor: pointer;
}
.scope-option:hover:not(:disabled) { color: var(--gl-text-default); background: var(--gl-hover-surface); }
.scope-option.active { color: var(--gl-text-strong); background: var(--gl-selected-surface); }
.scope-option:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.scope-option:disabled { cursor: wait; opacity: .75; }
</style>
