<script setup lang="ts">
import type { DiffSideBySideRow } from "../../../src/diffUtils";

export interface GlDiffSideLine<TData = unknown> {
  kind: string;
  text: string;
  line?: number;
  data?: TData;
}

const props = defineProps<{
  rows: DiffSideBySideRow<GlDiffSideLine>[];
  leftLabel?: string;
  rightLabel?: string;
  ariaLabel?: string;
  "aria-label"?: string;
}>();

function markerFor(line?: GlDiffSideLine): string {
  if (!line) return "";
  if (["added", "mr-added", "local-added"].includes(line.kind)) return "+";
  if (["deleted", "mr-removed", "local-removed"].includes(line.kind)) return "−";
  return "";
}

function codeFor(line?: GlDiffSideLine): string {
  if (!line) return "";
  if (["added", "deleted", "context"].includes(line.kind)) return line.text.slice(1);
  return line.text;
}
</script>

<template>
  <section
    class="gl-diff-side-by-side"
    role="table"
    :aria-label="props.ariaLabel ?? props['aria-label'] ?? 'Side-by-side diff'"
  >
    <div class="gl-diff-side-by-side-header" role="row">
      <div role="columnheader">{{ props.leftLabel ?? 'Before' }}</div>
      <div role="columnheader">{{ props.rightLabel ?? 'After' }}</div>
    </div>

    <template v-for="(row, index) in props.rows" :key="row.key">
      <slot name="row" :row="row" :index="index">
        <div v-if="row.fullWidth" class="gl-diff-side-by-side-full" role="row">
          <code role="cell">{{ row.left?.text ?? row.right?.text ?? ' ' }}</code>
        </div>
        <div v-else class="gl-diff-side-by-side-row" role="row">
          <div
            v-for="(side, sideIndex) in [row.left, row.right]"
            :key="`${row.key}-${sideIndex}`"
            class="gl-diff-side-by-side-side"
            :class="side?.kind ?? 'empty'"
            role="cell"
          >
            <span class="gl-diff-side-by-side-line-number">{{ side?.line ?? '' }}</span>
            <span class="gl-diff-side-by-side-marker" aria-hidden="true">{{ markerFor(side) }}</span>
            <code class="gl-diff-side-by-side-code">{{ codeFor(side) || ' ' }}</code>
          </div>
        </div>
      </slot>
    </template>
  </section>
</template>

<style scoped>
.gl-diff-side-by-side {
  width: 100%;
  min-width: 0;
  overflow: auto;
  background: var(--gl-surface-default);
}

.gl-diff-side-by-side-header,
.gl-diff-side-by-side-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(320px, 1fr));
  min-width: 640px;
}

.gl-diff-side-by-side-header {
  border-bottom: 1px solid var(--gl-border-default);
  color: var(--gl-text-subtle);
  background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
  font-size: 9px;
  line-height: 20px;
  text-transform: uppercase;
}

.gl-diff-side-by-side-header > div {
  padding-inline: var(--gl-spacing-8);
  border-right: 1px solid var(--gl-border-default);
}

.gl-diff-side-by-side-header > div:last-child { border-right: 0; }

.gl-diff-side-by-side-side {
  position: relative;
  min-width: 0;
  display: grid;
  grid-template-columns: 42px 22px minmax(0, 1fr);
  min-height: 22px;
  border-right: 1px solid var(--gl-border-default);
  cursor: crosshair;
  user-select: none;
}

.gl-diff-side-by-side-side:last-child { border-right: 0; }
.gl-diff-side-by-side-side.context { background: var(--gl-surface-default); }
.gl-diff-side-by-side-side.added,
.gl-diff-side-by-side-side.mr-added { background: var(--vscode-diffEditor-insertedLineBackground, var(--gl-feedback-success-subtle)); }
.gl-diff-side-by-side-side.deleted,
.gl-diff-side-by-side-side.mr-removed { background: var(--vscode-diffEditor-removedLineBackground, var(--gl-feedback-danger-subtle)); }
.gl-diff-side-by-side-side.local-added { background: var(--gl-feedback-info-subtle); }
.gl-diff-side-by-side-side.local-removed { background: var(--gl-feedback-warning-subtle); }
.gl-diff-side-by-side-side.empty { background: var(--vscode-editor-background); }

.gl-diff-side-by-side-line-number,
.gl-diff-side-by-side-marker {
  min-height: 22px;
  padding: 3px var(--gl-spacing-4);
  border-right: 1px solid color-mix(in srgb, var(--gl-border-default) 58%, transparent);
  color: var(--vscode-editorLineNumber-foreground);
  background: color-mix(in srgb, var(--vscode-editorGutter-background, var(--vscode-editor-background)) 92%, transparent);
  font: 10px/16px var(--vscode-editor-font-family);
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: none;
}

.gl-diff-side-by-side-marker {
  padding-inline: 0;
  color: var(--gl-text-subtle);
  text-align: center;
}

.added .gl-diff-side-by-side-marker,
.mr-added .gl-diff-side-by-side-marker { color: var(--vscode-gitDecoration-addedResourceForeground, var(--gl-feedback-success)); }
.deleted .gl-diff-side-by-side-marker,
.mr-removed .gl-diff-side-by-side-marker { color: var(--vscode-gitDecoration-deletedResourceForeground, var(--gl-feedback-danger)); }
.local-added .gl-diff-side-by-side-marker,
.local-removed .gl-diff-side-by-side-marker { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--gl-feedback-info)); }

.gl-diff-side-by-side-code {
  min-width: 0;
  min-height: 22px;
  margin: 0;
  padding: 3px var(--gl-spacing-8);
  overflow: visible;
  white-space: pre;
  overflow-wrap: normal;
  border: 0;
  border-radius: 0;
  background: transparent;
  font: var(--vscode-editor-font-size)/1.35 var(--vscode-editor-font-family);
  tab-size: 2;
}

.gl-diff-side-by-side-full {
  min-width: 640px;
  padding: var(--gl-spacing-4) var(--gl-spacing-12);
  border-bottom: 1px solid var(--gl-border-subtle);
  color: var(--gl-text-link);
  background: var(--gl-feedback-brand-subtle);
  font: var(--vscode-editor-font-size)/1.35 var(--vscode-editor-font-family);
}

.gl-diff-side-by-side-full code { white-space: pre; overflow-wrap: normal; }
</style>
