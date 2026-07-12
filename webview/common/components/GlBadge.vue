<script setup lang="ts">
import GlIcon, { type GlIconName } from "./GlIcon.vue";
withDefaults(defineProps<{ tone?: "neutral" | "success" | "danger" | "warning" | "info" | "brand"; icon?: GlIconName; pill?: boolean }>(), { tone: "neutral" });
</script>
<template><span class="gl-badge" :class="[`is-${tone}`, { 'is-pill': pill }]"><GlIcon v-if="icon" :name="icon" :size="12" /><slot /></span></template>
<style scoped>
.gl-badge { min-height: 18px; display:inline-flex; align-items:center; gap:var(--gl-spacing-2); padding:var(--gl-spacing-2) var(--gl-spacing-4); border-radius:var(--gl-radius-sm); color:var(--gl-text-subtle); background:var(--gl-surface-subtle); font-size:10px; line-height:1.2; white-space:nowrap; }
.is-pill { padding-inline:var(--gl-spacing-8); border-radius:var(--gl-radius-pill); }
.is-success { color:var(--gl-feedback-success); background:var(--gl-feedback-success-subtle); }.is-danger { color:var(--gl-feedback-danger); background:var(--gl-feedback-danger-subtle); }.is-warning { color:var(--gl-feedback-warning); background:var(--gl-feedback-warning-subtle); }.is-info { color:var(--gl-feedback-info); background:var(--gl-feedback-info-subtle); }.is-brand { color:var(--gl-feedback-brand); background:var(--gl-feedback-brand-subtle); }
</style>
