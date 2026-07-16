<script setup lang="ts">
import { ref } from "vue";
import GlIcon from "./GlIcon.vue";

const props = withDefaults(defineProps<{
  resolved: boolean;
  pending?: boolean;
  resolvable?: boolean;
}>(), { pending: false, resolvable: true });
const emit = defineEmits<{ toggle: [] }>();
const showNextState = ref(false);

function activate(): void {
  if (!props.pending && props.resolvable) emit("toggle");
}
</script>

<template>
  <button
    v-if="resolvable"
    class="thread-status-action"
    :class="{ 'has-action': resolvable && !pending, resolved }"
    type="button"
    :disabled="pending || !resolvable"
    :aria-label="pending ? 'Updating discussion status' : resolvable ? `${resolved ? 'Reopen' : 'Resolve'} discussion` : `${resolved ? 'Resolved' : 'Open'} discussion`"
    @mouseenter="showNextState = true"
    @mouseleave="showNextState = false"
    @focus="showNextState = true"
    @blur="showNextState = false"
    @click.stop="activate"
  >
    <span v-if="pending" class="status-label"><GlIcon class="spin" name="spinner" :size="12" />Updating</span>
    <span v-else class="status-label">
      <GlIcon
        :name="showNextState && resolvable ? resolved ? 'retry' : 'check-circle' : resolved ? 'check-circle' : 'comments'"
        :size="12"
      />{{ showNextState && resolvable ? resolved ? "Reopen" : "Resolve" : resolved ? "Resolved" : "Open" }}
    </span>
  </button>
</template>

<style scoped>
.thread-status-action {
  position: relative;
  min-width: 82px;
  min-height: 24px;
  display: inline-grid;
  place-items: center;
  flex: none;
  padding: var(--gl-spacing-2) var(--gl-spacing-8);
  border: 1px solid transparent;
  border-radius: var(--gl-radius-sm);
  color: var(--gl-text-subtle);
  background: transparent;
  font-size: 10px;
}
.thread-status-action.resolved {
  border-color: color-mix(in srgb, var(--gl-resolved-accent) 42%, transparent);
  color: var(--gl-resolved-accent);
  background: color-mix(in srgb, var(--gl-resolved-accent) 14%, transparent);
  font-weight: 600;
}
.thread-status-action.has-action { cursor: pointer; }
.thread-status-action.has-action:hover,
.thread-status-action.has-action:focus-visible {
  border-color: var(--gl-border-default);
  color: var(--gl-text-link);
  background: var(--gl-hover-surface);
}
.thread-status-action.resolved.has-action:hover,
.thread-status-action.resolved.has-action:focus-visible {
  border-color: color-mix(in srgb, var(--gl-resolved-accent) 55%, var(--gl-border-default));
  color: var(--gl-resolved-accent);
  background: color-mix(in srgb, var(--gl-resolved-accent) 10%, var(--gl-hover-surface));
}
.status-label { display: inline-flex; align-items: center; gap: var(--gl-spacing-4); white-space: nowrap; }
.thread-status-action:disabled { cursor: default; opacity: 1; }
</style>
