<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  value: string;
  tailLength?: number;
}>(), { tailLength: 24 });

const normalizedTailLength = computed(() => Math.max(1, Math.floor(props.tailLength)));
const leading = computed(() => props.value.slice(0, Math.max(0, props.value.length - normalizedTailLength.value)));
const trailing = computed(() => props.value.slice(-normalizedTailLength.value));
</script>

<template>
  <span class="gl-technical-identifier" :title="value">
    <span class="gl-technical-identifier-full">{{ value }}</span>
    <span v-if="leading" class="gl-technical-identifier-leading" aria-hidden="true">{{ leading }}</span>
    <span class="gl-technical-identifier-tail" aria-hidden="true">{{ trailing }}</span>
  </span>
</template>

<style scoped>
.gl-technical-identifier {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  overflow: hidden;
  white-space: nowrap;
}

.gl-technical-identifier-leading {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gl-technical-identifier-tail { flex: none; }

.gl-technical-identifier-full {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
