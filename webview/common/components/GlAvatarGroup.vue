<script setup lang="ts">
import GlAvatar from "./GlAvatar.vue";

export interface GlAvatarGroupItem {
  id?: string;
  name: string;
  avatarUrl?: string;
}

withDefaults(defineProps<{
  items: readonly GlAvatarGroupItem[];
  ariaLabel?: string;
  size?: "small" | "medium";
}>(), {
  ariaLabel: "Authors",
  size: "medium"
});
</script>

<template>
  <span v-if="items.length" class="gl-avatar-group" role="group" :aria-label="ariaLabel">
    <GlAvatar
      v-for="item in items"
      :key="item.id ?? item.name"
      :name="item.name"
      :avatar-url="item.avatarUrl"
      :size="size"
      :title="item.name"
    />
  </span>
</template>

<style scoped>
.gl-avatar-group {
  min-width: 0;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--gl-spacing-2);
}
</style>
