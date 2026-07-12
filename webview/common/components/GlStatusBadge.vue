<script setup lang="ts">
import { computed } from "vue";
import GlBadge from "./GlBadge.vue";
const props = defineProps<{ status: string }>();
const tone = computed(() => props.status === "opened" || props.status === "open" || props.status === "new" ? "success" : props.status === "merged" ? "brand" : props.status === "renamed" || props.status === "modified" ? "info" : props.status === "closed" || props.status === "deleted" || props.status === "locked" ? "danger" : "neutral");
</script>
<template><GlBadge :tone="tone" pill><slot>{{ status === "opened" ? "open" : status }}</slot></GlBadge></template>
