<script setup lang="ts">
defineProps<{ title: string; count?: number | string; flush?: boolean }>();
</script>
<template>
  <section class="gl-section" :class="{ 'is-flush': flush }">
    <header class="gl-section-header"><div class="gl-section-title"><slot name="icon" /><h2>{{ title }}</h2><span v-if="count !== undefined" class="gl-section-count">{{ count }}</span></div><div class="gl-section-actions"><slot name="actions" /></div></header>
    <div class="gl-section-content"><slot /></div>
  </section>
</template>
<style scoped>
.gl-section { min-width:0; display:grid; gap:var(--gl-spacing-8); }.gl-section-header { min-height:24px; display:flex; align-items:center; justify-content:space-between; gap:var(--gl-spacing-8); }.gl-section-title,.gl-section-actions { min-width:0; display:flex; align-items:center; gap:var(--gl-spacing-4); }.gl-section-title h2 { margin:0; color:var(--gl-text-strong); font-size:11px; font-weight:600; letter-spacing:.02em; }.gl-section-count { color:var(--gl-text-subtle); font-size:10px; }.gl-section-content { min-width:0; }.is-flush { gap:var(--gl-spacing-4); }
</style>
