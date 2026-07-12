<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
const props = withDefaults(defineProps<{ open: boolean; label: string; align?: "start" | "end" }>(), { align: "end" });
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
function onPointerDown(event: PointerEvent): void { if (props.open && !panel.value?.contains(event.target as Node)) emit("close"); }
function onKeydown(event: KeyboardEvent): void { if (props.open && event.key === "Escape") { event.preventDefault(); emit("close"); } }
watch(() => props.open, (open) => { if (open) void nextTick(() => panel.value?.focus()); });
document.addEventListener("pointerdown", onPointerDown);
document.addEventListener("keydown", onKeydown);
onBeforeUnmount(() => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeydown); });
</script>
<template><div v-if="open" ref="panel" class="gl-popover" :class="`is-${align}`" role="dialog" :aria-label="label" tabindex="-1" @pointerdown.stop><slot /></div></template>
<style scoped>
.gl-popover { position:absolute; top:calc(100% + var(--gl-spacing-4)); z-index:50; width:min(360px,calc(100vw - var(--gl-spacing-16))); max-height:min(520px,calc(100vh - var(--gl-spacing-32))); overflow:auto; border:1px solid var(--gl-border-default); border-radius:var(--gl-radius-md); color:var(--gl-text-default); background:var(--gl-surface-overlay); box-shadow:var(--gl-overlay-shadow); }.is-end { right:0; }.is-start { left:0; }
</style>
