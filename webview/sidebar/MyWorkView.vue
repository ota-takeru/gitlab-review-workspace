<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type { MyWorkMergeRequest, MyWorkState } from "../../src/myWorkTypes";
import GlEmptyState from "../common/components/GlEmptyState.vue";
import GlIcon from "../common/components/GlIcon.vue";
import GlIconButton from "../common/components/GlIconButton.vue";
import GlSection from "../common/components/GlSection.vue";
import WorkItemRow from "./WorkItemRow.vue";

const props = withDefaults(defineProps<{
  state: MyWorkState;
  initialScrollTop?: number;
}>(), { initialScrollTop: 0 });

const emit = defineEmits<{
  refresh: [];
  openMr: [item: MyWorkMergeRequest];
  scrollPosition: [value: number];
}>();

const scroller = ref<HTMLElement>();
const hasItems = computed(() => Object.values(props.state.buckets).some((items) => items.length > 0));

function formatUpdatedAt(value?: string): string {
  if (!value) return "未取得";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function onScroll(): void {
  emit("scrollPosition", scroller.value?.scrollTop ?? 0);
}

onMounted(() => {
  void nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = props.initialScrollTop;
  });
});
</script>

<template>
  <section ref="scroller" class="my-work-scroll" aria-label="My work" @scroll.passive="onScroll">
    <header class="my-work-header">
      <div>
        <h1>My work</h1>
        <span>Last successful update: {{ formatUpdatedAt(state.lastSuccessfulAt) }}</span>
      </div>
      <GlIconButton icon="retry" label="My workを更新" :loading="state.phase === 'loading'" @click="$emit('refresh')" />
    </header>

    <div v-if="state.phase === 'partial'" class="my-work-banner is-warning">
      <GlIcon name="warning" :size="14" />
      <span>一部を更新できませんでした。キャッシュを表示しています。</span>
    </div>
    <div v-else-if="state.phase === 'error'" class="my-work-banner is-danger">
      <GlIcon name="warning" :size="14" />
      <span>My workを更新できませんでした。</span>
    </div>
    <div v-else-if="state.phase === 'loading' && hasItems" class="my-work-banner">
      <GlIcon name="spinner" class="spin" :size="14" />
      <span>更新中。キャッシュを表示しています。</span>
    </div>

    <GlEmptyState v-if="state.phase === 'loading' && !hasItems" title="My workを読み込んでいます" icon="spinner" />

    <template v-else>
      <GlSection class="work-section attention" title="Action required" :count="state.buckets.attention.length" flush>
        <template #icon><GlIcon name="warning" /></template>
        <div v-if="state.buckets.attention.length" class="work-list">
          <WorkItemRow
            v-for="item in state.buckets.attention"
            :key="item.key"
            :item="item"
            @open-mr="(mr) => $emit('openMr', mr)"
          />
        </div>
        <GlEmptyState v-else title="対応が必要なMRはありません" icon="check-circle" compact />
      </GlSection>

      <GlSection class="work-section active" title="In progress" :count="state.buckets.active.length" flush>
        <template #icon><GlIcon name="commit" /></template>
        <div v-if="state.buckets.active.length" class="work-list">
          <WorkItemRow
            v-for="item in state.buckets.active"
            :key="item.key"
            :item="item"
            @open-mr="(mr) => $emit('openMr', mr)"
          />
        </div>
        <GlEmptyState v-else title="進行中のMRはありません" icon="commit" compact />
      </GlSection>

      <GlSection class="work-section waiting" title="Waiting" :count="state.buckets.waiting.length" flush>
        <template #icon><GlIcon name="information" /></template>
        <div v-if="state.buckets.waiting.length" class="work-list">
          <WorkItemRow
            v-for="item in state.buckets.waiting"
            :key="item.key"
            :item="item"
            @open-mr="(mr) => $emit('openMr', mr)"
          />
        </div>
        <GlEmptyState v-else title="待機中のMRはありません" icon="information" compact />
      </GlSection>
    </template>
  </section>
</template>

<style scoped>
.my-work-scroll {
  min-width: 0;
  max-height: calc(100vh - 72px);
  display: grid;
  align-content: start;
  gap: var(--gl-spacing-12);
  padding: var(--gl-spacing-8);
  overflow: auto;
}
.my-work-header { display: flex; align-items: center; justify-content: space-between; gap: var(--gl-spacing-8); }
.my-work-header > div { min-width: 0; display: grid; gap: var(--gl-spacing-2); }
.my-work-header h1 { margin: 0; color: var(--gl-text-strong); font-size: 14px; }
.my-work-header span { color: var(--gl-text-subtle); font-size: 9px; }
.my-work-banner { display: flex; align-items: center; gap: var(--gl-spacing-8); padding: var(--gl-spacing-8); border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-md); color: var(--gl-text-subtle); background: var(--gl-surface-raised); font-size: 10px; }
.my-work-banner.is-warning { color: var(--gl-feedback-warning); background: var(--gl-feedback-warning-subtle); }
.my-work-banner.is-danger { color: var(--gl-feedback-danger); background: var(--gl-feedback-danger-subtle); }
.work-section { padding: var(--gl-spacing-8); border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-md); background: var(--gl-surface-subtle); }
.work-section.attention { border-left: 3px solid var(--gl-feedback-warning); }
.work-section.active { border-left: 3px solid var(--gl-accent-purple); }
.work-section.waiting { border-left: 3px solid var(--gl-feedback-info); }
.work-list { display: grid; gap: var(--gl-spacing-8); }
</style>
