<script setup lang="ts">
import { ref, watch } from "vue";
import type { ReviewReaction } from "../../../src/reviewTypes";
import { commonEmojiReactions, emojiReactionText } from "../emojiReactions";

const props = withDefaults(defineProps<{
  reactions?: ReviewReaction[];
  loaded?: boolean;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
}>(), {
  reactions: () => [],
  loaded: false,
  loading: false,
  disabled: false
});
const emit = defineEmits<{
  load: [];
  toggle: [name: string];
}>();
const pickerOpen = ref(false);
const loadRequested = ref(false);

function load(force = false): void {
  if (props.loaded || props.loading || props.disabled) return;
  if (!force && loadRequested.value) return;
  loadRequested.value = true;
  emit("load");
}

function openPicker(): void {
  if (props.disabled || props.loading) return;
  const nextOpen = !pickerOpen.value;
  pickerOpen.value = nextOpen;
  if (nextOpen) load();
}

function retry(): void {
  load(true);
}

function toggle(name: string): void {
  if (props.disabled) return;
  pickerOpen.value = false;
  emit("toggle", name);
}

function reactionTitle(reaction: ReviewReaction): string {
  const names = reaction.users.map((user) => user.name).filter(Boolean);
  return names.length ? `${names.join(", ")} reacted with :${reaction.name}:` : `:${reaction.name}:`;
}

watch(() => props.loaded, (loaded) => {
  if (loaded) loadRequested.value = false;
});
</script>

<template>
  <div
    class="reaction-area"
    :class="{ 'is-empty-unloaded': !loaded && !loading && !error && !reactions.length && !disabled }"
  >
    <div v-if="reactions.length || loaded || !disabled" class="reaction-bar" aria-label="Comment reactions">
      <button
        v-for="reaction in reactions"
        :key="reaction.name"
        type="button"
        class="reaction-chip"
        :class="{ selected: Boolean(reaction.currentUserAwardId) }"
        :disabled="disabled || reaction.pending"
        :aria-pressed="Boolean(reaction.currentUserAwardId)"
        :aria-label="`${reaction.currentUserAwardId ? 'Remove' : 'Add'} ${reaction.name} reaction, ${reaction.count}`"
        :title="reactionTitle(reaction)"
        @click="toggle(reaction.name)"
      >
        <span aria-hidden="true">{{ emojiReactionText(reaction.name) }}</span>
        <span class="reaction-count">{{ reaction.count }}</span>
      </button>

      <span class="reaction-picker-wrap">
        <button
          type="button"
          class="reaction-add"
          :disabled="disabled || loading"
          aria-label="Add reaction"
          :aria-expanded="pickerOpen"
          @click="openPicker"
        ><span aria-hidden="true">☺＋</span></button>
        <span v-if="pickerOpen" class="reaction-picker" role="dialog" aria-label="Choose a reaction">
          <button
            v-for="option in commonEmojiReactions"
            :key="option.name"
            type="button"
            :disabled="disabled || loading || (loadRequested && !loaded)"
            :aria-label="option.label"
            :title="option.label"
            @click="toggle(option.name)"
          >{{ option.emoji }}</button>
        </span>
      </span>
    </div>

    <span v-if="loading" class="reaction-status" aria-live="polite">Loading reactions…</span>
    <span v-else-if="error" class="reaction-status is-error" role="status">
      {{ error }}
      <button type="button" @click="retry">Retry</button>
    </span>
  </div>
</template>

<style scoped>
.reaction-area { min-width: 0; }
.reaction-area.is-empty-unloaded { position:relative; height:0; }
.reaction-area.is-empty-unloaded .reaction-bar { position:absolute; top:0; right:0; opacity:0; pointer-events:none; }
:global(.gl-comment:hover) .reaction-area.is-empty-unloaded .reaction-bar,
.reaction-area.is-empty-unloaded:focus-within .reaction-bar { opacity:1; pointer-events:auto; }
.reaction-bar { display:flex; flex-wrap:wrap; align-items:center; gap:var(--gl-spacing-4); padding-top:var(--gl-spacing-4); }
.reaction-chip,
.reaction-add {
  min-height:24px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:var(--gl-spacing-4);
  padding:1px var(--gl-spacing-8);
  border:1px solid var(--gl-border-default);
  border-radius:999px;
  color:var(--gl-text-default);
  background:var(--gl-surface-raised);
  font:inherit;
  cursor:pointer;
}
.reaction-chip:hover:not(:disabled),
.reaction-add:hover:not(:disabled) { background:var(--gl-hover-surface); }
.reaction-chip:focus-visible,
.reaction-add:focus-visible,
.reaction-picker button:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:1px; }
.reaction-chip.selected { border-color:var(--gl-feedback-brand); background:var(--gl-feedback-brand-subtle); color:var(--gl-text-strong); }
.reaction-chip:disabled { cursor:progress; opacity:.7; }
.reaction-count { min-width:1ch; font-size:11px; font-variant-numeric:tabular-nums; }
.reaction-add { width:30px; padding:1px var(--gl-spacing-4); color:var(--gl-text-subtle); }
.reaction-picker-wrap { position:relative; display:inline-flex; }
.reaction-picker {
  position:absolute;
  z-index:12;
  left:0;
  bottom:calc(100% + var(--gl-spacing-4));
  display:grid;
  grid-template-columns:repeat(4, 30px);
  gap:var(--gl-spacing-4);
  padding:var(--gl-spacing-8);
  border:1px solid var(--gl-border-default);
  border-radius:var(--gl-radius-md);
  background:var(--gl-surface-overlay, var(--vscode-menu-background, var(--gl-surface-raised)));
  box-shadow:0 4px 12px color-mix(in srgb, black 24%, transparent);
}
.reaction-picker button { width:30px; height:30px; border:0; border-radius:var(--gl-radius-sm); background:transparent; font-size:17px; cursor:pointer; }
.reaction-picker button:hover { background:var(--gl-hover-surface); }
.reaction-status { display:inline-flex; align-items:center; gap:var(--gl-spacing-4); padding-top:var(--gl-spacing-4); color:var(--gl-text-subtle); font-size:11px; }
.reaction-status.is-error { color:var(--gl-feedback-danger); }
.reaction-status button { border:0; padding:0; color:var(--gl-text-link); background:transparent; font:inherit; cursor:pointer; }
</style>
