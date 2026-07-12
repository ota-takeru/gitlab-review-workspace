<script setup lang="ts">
export interface GlDiffLine { key?: string | number; kind: string; oldLine?: number; newLine?: number; text: string; }
const props = defineProps<{ lines: GlDiffLine[]; ariaLabel?: string; "aria-label"?: string }>();

function markerFor(line: GlDiffLine): string {
  if (line.kind === "added" || line.kind === "mr-added" || line.kind === "local-added") return "+";
  if (line.kind === "deleted" || line.kind === "mr-removed" || line.kind === "local-removed") return "−";
  return "";
}

function codeFor(line: GlDiffLine): string {
  if (line.kind === "added" || line.kind === "deleted" || line.kind === "context") {
    return line.text.slice(1);
  }
  return line.text;
}
</script>
<template><section class="gl-diff-table" role="table" :aria-label="props.ariaLabel ?? props['aria-label'] ?? 'Diff'"><slot name="header" /><template v-for="(line,index) in lines" :key="line.key ?? `${index}:${line.oldLine ?? ''}:${line.newLine ?? ''}`"><slot name="line" :line="line" :index="index"><div class="gl-diff-row" :class="line.kind" role="row"><span class="gl-diff-gutter" role="cell">{{ line.oldLine ?? '' }}</span><span class="gl-diff-gutter" role="cell">{{ line.newLine ?? '' }}</span><span class="gl-diff-marker" role="cell" aria-hidden="true">{{ markerFor(line) }}</span><code class="gl-diff-code" role="cell">{{ codeFor(line) || ' ' }}</code></div></slot></template></section></template>
<style scoped>
.gl-diff-table { width:100%; overflow:auto; background:var(--gl-surface-default); }
:deep(.gl-diff-row) { min-width:max-content; display:grid; grid-template-columns:30px 30px 22px minmax(max-content,1fr); font-family:var(--vscode-editor-font-family); font-size:var(--vscode-editor-font-size); line-height:1.45; }
:deep(.gl-diff-gutter) { width:30px; min-height:20px; padding:var(--gl-spacing-2) var(--gl-spacing-4); border-right:1px solid var(--gl-border-subtle); color:var(--vscode-editorLineNumber-foreground); text-align:right; user-select:none; }
:deep(.gl-diff-marker) { min-height:20px; padding:var(--gl-spacing-2) 0; color:var(--gl-text-subtle); text-align:center; user-select:none; }
:deep(.gl-diff-code) { min-height:20px; padding:var(--gl-spacing-2) var(--gl-spacing-12); white-space:pre; }
:deep(.gl-diff-code),:deep(.gl-diff-code code) { border:0; border-radius:0; box-shadow:none; background:transparent; }
:deep(.added),:deep(.mr-added) { background:var(--vscode-diffEditor-insertedLineBackground, var(--gl-feedback-success-subtle)); }
:deep(.deleted),:deep(.mr-removed) { background:var(--vscode-diffEditor-removedLineBackground, var(--gl-feedback-danger-subtle)); }
:deep(.local-added) { background:var(--gl-feedback-info-subtle); }
:deep(.local-removed) { background:var(--gl-feedback-warning-subtle); }
:deep(.added) .gl-diff-marker,:deep(.mr-added) .gl-diff-marker,:deep(.local-added) .gl-diff-marker { color:var(--vscode-gitDecoration-addedResourceForeground, var(--gl-feedback-success)); }
:deep(.deleted) .gl-diff-marker,:deep(.mr-removed) .gl-diff-marker,:deep(.local-removed) .gl-diff-marker { color:var(--vscode-gitDecoration-deletedResourceForeground, var(--gl-feedback-danger)); }
:deep(.hunk) { color:var(--gl-text-link); background:var(--gl-feedback-brand-subtle); }
:deep(.meta) { color:var(--gl-text-subtle); }
</style>
