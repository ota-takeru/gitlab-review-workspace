<script setup lang="ts">
export interface ComponentReferenceLink {
  label: string;
  href: string;
}

defineProps<{
  comparisonId: string;
  title: string;
  extensionComponents: string[];
  gitlabComponents: string[];
  referenceSummary: string;
  references: ComponentReferenceLink[];
  aligned: string[];
  differences: string[];
  gaps?: string[];
}>();
</script>

<template>
  <main class="component-comparison" :data-comparison-id="comparisonId" :aria-labelledby="`${comparisonId}-title`">
    <header class="comparison-header">
      <div>
        <p class="comparison-eyebrow">Component comparison</p>
        <h1 :id="`${comparisonId}-title`">{{ title }}</h1>
      </div>
      <div class="component-map" aria-label="Component mapping">
        <span class="map-side">Extension</span>
        <code v-for="component in extensionComponents" :key="component">{{ component }}</code>
        <span class="map-arrow" aria-hidden="true">→</span>
        <span class="map-side">GitLab</span>
        <strong v-for="component in gitlabComponents" :key="component">{{ component }}</strong>
      </div>
    </header>

    <div class="comparison-columns">
      <section class="comparison-pane extension-pane" aria-labelledby="extension-specimen-title">
        <header>
          <p>Rendered from this extension</p>
          <h2 id="extension-specimen-title">Extension specimen</h2>
        </header>
        <div class="specimen-stage" aria-label="Extension component specimen">
          <slot />
        </div>
      </section>

      <section class="comparison-pane reference-pane" aria-labelledby="gitlab-reference-title">
        <header>
          <p>Official comparison target</p>
          <h2 id="gitlab-reference-title">GitLab / Pajamas</h2>
        </header>
        <p class="reference-summary">{{ referenceSummary }}</p>
        <div class="reference-links" aria-label="Official component references">
          <a v-for="reference in references" :key="reference.href" :href="reference.href" target="_blank" rel="noopener noreferrer">
            {{ reference.label }}<span aria-hidden="true"> ↗</span>
          </a>
        </div>
      </section>
    </div>

    <div class="comparison-notes">
      <section class="note-block aligned" aria-labelledby="aligned-title">
        <h2 id="aligned-title">Aligned</h2>
        <ul><li v-for="item in aligned" :key="item">{{ item }}</li></ul>
      </section>
      <section class="note-block different" aria-labelledby="different-title">
        <h2 id="different-title">Different by design</h2>
        <ul><li v-for="item in differences" :key="item">{{ item }}</li></ul>
      </section>
      <section v-if="gaps?.length" class="note-block gaps" aria-labelledby="gaps-title">
        <h2 id="gaps-title">Gap to review</h2>
        <ul><li v-for="item in gaps" :key="item">{{ item }}</li></ul>
      </section>
    </div>
  </main>
</template>

<style scoped>
.component-comparison {
  width: min(1180px, 100%);
  min-height: 100vh;
  margin: 0 auto;
  padding: var(--gl-spacing-24);
  color: var(--vscode-foreground);
}
.comparison-header { display: flex; align-items: start; justify-content: space-between; gap: var(--gl-spacing-16); margin-bottom: var(--gl-spacing-16); }
.comparison-eyebrow, .comparison-pane header p { margin: 0 0 var(--gl-spacing-4); color: var(--vscode-descriptionForeground); font: 10px var(--vscode-editor-font-family); letter-spacing: .04em; text-transform: uppercase; }
h1, h2 { color: var(--vscode-editor-foreground); }
h1 { margin: 0; font-size: 22px; line-height: 1.3; }
.component-map { max-width: 58%; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--gl-spacing-4); }
.component-map code, .component-map strong, .map-side { border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-pill); padding: 2px 7px; font-size: 10px; white-space: nowrap; }
.component-map code { color: var(--vscode-textLink-foreground); background: var(--gl-surface-subtle); }
.component-map strong { color: var(--gl-accent-orange); background: color-mix(in srgb, var(--gl-accent-orange) 9%, var(--gl-surface-raised)); }
.map-side { border-color: transparent; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
.map-arrow { color: var(--vscode-descriptionForeground); }
.comparison-columns { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(260px, .65fr); gap: var(--gl-spacing-12); }
.comparison-pane { min-width: 0; border: 1px solid var(--gl-border-default); border-radius: var(--gl-radius-md); background: var(--gl-surface-raised); }
.comparison-pane > header { padding: var(--gl-spacing-12); border-bottom: 1px solid var(--gl-border-default); }
.comparison-pane h2 { margin: 0; font-size: 13px; }
.specimen-stage { min-width: 0; min-height: 220px; display: grid; align-content: center; padding: var(--gl-spacing-16); overflow: auto; background: var(--gl-surface-default); }
.reference-pane { border-left: 3px solid var(--gl-accent-orange); }
.reference-summary { margin: 0; padding: var(--gl-spacing-16); color: var(--vscode-foreground); font-size: 12px; line-height: 1.55; }
.reference-links { display: flex; flex-wrap: wrap; gap: var(--gl-spacing-4); padding: 0 var(--gl-spacing-16) var(--gl-spacing-16); }
.reference-links a { border-radius: var(--gl-radius-sm); padding: 3px 6px; color: var(--vscode-textLink-foreground, #428fdc); background: var(--gl-surface-subtle); font-size: 11px; font-weight: 600; text-decoration: none; }
.reference-links a:hover, .reference-links a:focus-visible { text-decoration: underline; }
.comparison-notes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gl-spacing-12); margin-top: var(--gl-spacing-12); }
.note-block { min-width: 0; border-top: 2px solid var(--gl-border-strong); padding: var(--gl-spacing-12); background: var(--gl-surface-subtle); }
.note-block.aligned { border-top-color: var(--gl-resolved-accent); }
.note-block.different { border-top-color: var(--gl-commit-accent); }
.note-block.gaps { border-top-color: var(--gl-changed-accent); }
.note-block h2 { margin: 0 0 var(--gl-spacing-8); font-size: 12px; }
.note-block ul { display: grid; gap: var(--gl-spacing-4); margin: 0; padding-left: 18px; color: var(--vscode-foreground); font-size: 11px; line-height: 1.5; }
:deep(.comparison-demo-row) { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gl-spacing-8); }
:deep(.comparison-demo-stack) { width: 100%; display: grid; gap: var(--gl-spacing-8); }
:deep(.comparison-sidebar-demo) { width: min(400px, 100%); margin: 0 auto; border: 1px solid var(--gl-border-default); background: var(--vscode-sideBar-background); }
:deep(.comparison-popover-anchor) { position: relative; min-height: 180px; display: grid; place-items: start; align-content: start; gap: var(--gl-spacing-8); }
:deep(.comparison-popover-content) { display: grid; gap: var(--gl-spacing-8); padding: var(--gl-spacing-12); }

@media (max-width: 760px) {
  .component-comparison { padding: var(--gl-spacing-16); }
  .comparison-header { flex-direction: column; }
  .component-map { max-width: none; justify-content: flex-start; }
  .comparison-columns, .comparison-notes { grid-template-columns: 1fr; }
  .specimen-stage { min-height: 160px; }
}
</style>
