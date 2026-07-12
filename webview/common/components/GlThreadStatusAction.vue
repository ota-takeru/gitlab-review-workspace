<script setup lang="ts">
import GlIcon from "./GlIcon.vue";

const props = withDefaults(defineProps<{
  resolved: boolean;
  pending?: boolean;
  resolvable?: boolean;
}>(), { pending: false, resolvable: true });
const emit = defineEmits<{ toggle: [] }>();

function activate(): void {
  if (!props.pending && props.resolvable) emit("toggle");
}
</script>

<template>
  <button
    class="thread-status-action"
    :class="{ 'has-action': resolvable && !pending, resolved }"
    type="button"
    :disabled="pending || !resolvable"
    :aria-label="pending ? 'Updating discussion status' : resolvable ? `${resolved ? 'Reopen' : 'Resolve'} discussion` : `${resolved ? 'Resolved' : 'Open'} discussion`"
    @click.stop="activate"
  >
    <span v-if="pending" class="status-label"><GlIcon class="spin" name="spinner" :size="12" />Updating</span>
    <template v-else>
      <span class="status-label current-status">
        <GlIcon :name="resolved ? 'check-circle' : 'comments'" :size="12" />{{ resolved ? "Resolved" : "Open" }}
      </span>
      <span v-if="resolvable" class="status-label status-action">
        <GlIcon :name="resolved ? 'retry' : 'check-circle'" :size="12" />{{ resolved ? "Reopen" : "Resolve" }}
      </span>
    </template>
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
.status-label { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: var(--gl-spacing-4); white-space: nowrap; }
.status-action { visibility: hidden; }
.has-action:hover .current-status,
.has-action:focus-visible .current-status { visibility: hidden; }
.has-action:hover .status-action,
.has-action:focus-visible .status-action { visibility: visible; }
.thread-status-action:disabled { cursor: default; opacity: 1; }
</style>
