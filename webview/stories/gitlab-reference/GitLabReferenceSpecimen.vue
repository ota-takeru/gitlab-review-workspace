<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

type ReferenceKind =
  | "actions"
  | "identity"
  | "navigation"
  | "work-item"
  | "tree"
  | "diff"
  | "discussion"
  | "editor"
  | "markdown"
  | "empty"
  | "popover";

const props = defineProps<{ kind: ReferenceKind }>();

const activeTab = ref<"overview" | "activity">("overview");
const accordionOpen = ref(true);
const treeOpen = ref(true);
const selectedTreeItem = ref("App.vue");
const diffScope = ref<"changes" | "file">("changes");
const resolved = ref(false);
const popoverOpen = ref(false);
const popoverTrigger = ref<HTMLButtonElement>();
const popover = ref<HTMLElement>();

const activePanelLabel = computed(() => activeTab.value === "overview" ? "Overview" : "Activity");

function moveTab(event: KeyboardEvent) {
  const tabs: Array<"overview" | "activity"> = ["overview", "activity"];
  const current = tabs.indexOf(activeTab.value);
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  activeTab.value = tabs[(current + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  nextTick(() => document.getElementById(`gl-ref-tab-${activeTab.value}`)?.focus());
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (popover.value?.contains(target) || popoverTrigger.value?.contains(target)) return;
  popoverOpen.value = false;
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && popoverOpen.value) {
    popoverOpen.value = false;
    popoverTrigger.value?.focus();
  }
}

watch(popoverOpen, (open) => {
  if (open) nextTick(() => popover.value?.querySelector<HTMLElement>("button")?.focus());
});

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeyDown);
});
</script>

<template>
  <section class="gl-ref" :data-gitlab-reference-kind="props.kind" aria-label="GitLab reference specimen">
    <div v-if="kind === 'actions'" class="gl-ref-row gl-ref-actions">
      <button class="gl-ref-button" type="button">Default</button>
      <button class="gl-ref-button gl-ref-button--confirm" type="button"><span aria-hidden="true">✓</span> Save review</button>
      <button class="gl-ref-button gl-ref-button--danger" type="button">Discard</button>
      <button class="gl-ref-button gl-ref-button--link" type="button">Open in GitLab</button>
      <button class="gl-ref-button" type="button" aria-busy="true" aria-disabled="true"><span class="gl-ref-spinner" aria-hidden="true" /> Saving</button>
      <button class="gl-ref-icon-button" type="button" aria-label="Refresh review"><span aria-hidden="true">↻</span></button>
    </div>

    <div v-else-if="kind === 'identity'" class="gl-ref-row gl-ref-identity">
      <span class="gl-ref-avatar" aria-label="Otata Reviewer">OR</span>
      <span class="gl-ref-avatar gl-ref-avatar--small" aria-label="GitLab User">GU</span>
      <span class="gl-ref-badge gl-ref-badge--opened">Opened</span>
      <span class="gl-ref-badge gl-ref-badge--merged">Merged</span>
      <span class="gl-ref-badge gl-ref-badge--warning">⚠ Review requested</span>
      <span class="gl-ref-badge gl-ref-badge--info">reviewer</span>
    </div>

    <div v-else-if="kind === 'navigation'" class="gl-ref-navigation">
      <div class="gl-ref-tabs" role="tablist" aria-label="Merge request details" @keydown="moveTab">
        <button id="gl-ref-tab-overview" class="gl-ref-tab" :class="{ 'is-active': activeTab === 'overview' }" role="tab" type="button" :aria-selected="activeTab === 'overview'" aria-controls="gl-ref-tabpanel" :tabindex="activeTab === 'overview' ? 0 : -1" @click="activeTab = 'overview'">Overview <span>12</span></button>
        <button id="gl-ref-tab-activity" class="gl-ref-tab" :class="{ 'is-active': activeTab === 'activity' }" role="tab" type="button" :aria-selected="activeTab === 'activity'" aria-controls="gl-ref-tabpanel" :tabindex="activeTab === 'activity' ? 0 : -1" @click="activeTab = 'activity'">Activity <span>3</span></button>
      </div>
      <div id="gl-ref-tabpanel" class="gl-ref-panel" role="tabpanel" :aria-label="activePanelLabel" :aria-labelledby="`gl-ref-tab-${activeTab}`">
        {{ activeTab === "overview" ? "Review details and changed files." : "Recent discussion activity." }}
      </div>
      <div class="gl-ref-accordion">
        <h3><button type="button" :aria-expanded="accordionOpen" aria-controls="gl-ref-accordion-content" @click="accordionOpen = !accordionOpen"><span aria-hidden="true">{{ accordionOpen ? "⌄" : "›" }}</span> Changed files <span class="gl-ref-count">12</span></button></h3>
        <div v-show="accordionOpen" id="gl-ref-accordion-content">Secondary content stays within this context.</div>
      </div>
    </div>

    <article v-else-if="kind === 'work-item'" class="gl-ref-work-item" aria-label="Merge request 482">
      <span class="gl-ref-rail" aria-hidden="true" />
      <div class="gl-ref-work-main"><span class="gl-ref-badge gl-ref-badge--opened">Opened</span><strong>!482 Improve review file navigation</strong><span class="gl-ref-muted">group / review-tools · updated 4 minutes ago</span></div>
      <span class="gl-ref-avatar gl-ref-avatar--small" aria-label="Assigned to Otata Reviewer">OR</span>
    </article>

    <div v-else-if="kind === 'tree'" class="gl-ref-tree" role="tree" aria-label="Changed files">
      <button class="gl-ref-treeitem gl-ref-treeitem--folder" role="treeitem" type="button" :aria-expanded="treeOpen" tabindex="0" @click="treeOpen = !treeOpen" @keydown.right.prevent="treeOpen = true" @keydown.left.prevent="treeOpen = false"><span aria-hidden="true">{{ treeOpen ? "⌄" : "›" }}</span> <span aria-hidden="true">▣</span> webview</button>
      <div v-show="treeOpen" role="group" class="gl-ref-tree-group">
        <button class="gl-ref-treeitem gl-ref-treeitem--file" :class="{ 'is-selected': selectedTreeItem === 'App.vue' }" role="treeitem" type="button" :aria-selected="selectedTreeItem === 'App.vue'" @click="selectedTreeItem = 'App.vue'"><span aria-hidden="true">⌘</span> App.vue <small><b>+12</b> −3 · 2</small></button>
      </div>
    </div>

    <div v-else-if="kind === 'diff'" class="gl-ref-diff">
      <header class="gl-ref-diff-header"><div><strong>webview/review-file/App.vue</strong><span class="gl-ref-muted">Modified · +12 −3 · 2 discussions</span></div><div class="gl-ref-button-group" role="group" aria-label="Diff range"><button type="button" :aria-pressed="diffScope === 'changes'" @click="diffScope = 'changes'">Changes</button><button type="button" :aria-pressed="diffScope === 'file'" @click="diffScope = 'file'">File</button></div></header>
      <table aria-label="GitLab changes"><tbody><tr><td>8</td><td>8</td><td>const state = ready;</td></tr><tr class="gl-ref-deleted"><td>9</td><td></td><td>-return legacyView;</td></tr><tr class="gl-ref-added"><td></td><td>9</td><td>+return reviewView;</td></tr></tbody></table>
    </div>

    <article v-else-if="kind === 'discussion'" class="gl-ref-discussion" :class="{ 'is-resolved': resolved }">
      <span class="gl-ref-avatar gl-ref-avatar--small" aria-label="Otata Reviewer">OR</span><div class="gl-ref-comment"><header><strong>otataker</strong><span class="gl-ref-muted">2m ago · edited</span><button class="gl-ref-resolve" type="button" :aria-pressed="resolved" @click="resolved = !resolved">{{ resolved ? "Reopen" : "Resolve thread" }}</button></header><p><strong>Review note:</strong> keep the selected line visible when this thread collapses.</p></div>
    </article>

    <div v-else-if="kind === 'editor'" class="gl-ref-editor">
      <div class="gl-ref-toolbar" role="toolbar" aria-label="Rich text formatting"><button type="button" aria-label="Bold"><b>B</b></button><button type="button" aria-label="Italic"><i>I</i></button><button type="button" aria-label="Insert link">⌁</button><button type="button" aria-label="Code">&lt;/&gt;</button><button type="button" aria-label="Attach image">▧</button></div>
      <div class="gl-ref-editable" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Write a review comment">Please keep <strong>comment anchors</strong> stable.</div>
      <footer><span class="gl-ref-muted">Markdown supported · ⌘ Enter to comment</span><button class="gl-ref-button gl-ref-button--confirm" type="button">Comment</button></footer>
    </div>

    <div v-else-if="kind === 'markdown'" class="gl-ref-markdown">
      <p><strong>Rendered review</strong></p><blockquote>Keep the GitLab meaning, even inside VS Code.</blockquote><ul><li>safe links</li><li>semantic lists</li><li>inline <code>code</code></li></ul><pre><code>return reviewView;</code></pre><div class="gl-ref-image-placeholder" role="img" aria-label="Uploaded review screenshot placeholder">▧<span>review-evidence.png</span></div>
    </div>

    <div v-else-if="kind === 'empty'" class="gl-ref-empty-grid">
      <div class="gl-ref-empty"><span class="gl-ref-empty-icon" aria-hidden="true">☷</span><strong>No review threads</strong><p>Open a changed file and select a line to start a discussion.</p><button class="gl-ref-button" type="button">Open changed files</button></div>
      <div class="gl-ref-empty"><span class="gl-ref-spinner gl-ref-spinner--large" aria-hidden="true" /><strong>Refreshing review</strong><p role="status">Cached content stays visible while GitLab is contacted.</p></div>
    </div>

    <div v-else-if="kind === 'popover'" class="gl-ref-popover-anchor">
      <button ref="popoverTrigger" class="gl-ref-button" type="button" :aria-expanded="popoverOpen" aria-controls="gl-ref-popover" @click="popoverOpen = !popoverOpen">Open local actions</button>
      <div v-if="popoverOpen" id="gl-ref-popover" ref="popover" class="gl-ref-popover" role="dialog" aria-modal="false" aria-label="Local workspace actions"><strong>Local workspace</strong><span>feature/review-ui · Clean</span><button class="gl-ref-button" type="button">Open existing worktree</button></div>
    </div>
  </section>
</template>

<style scoped>
.gl-ref { --ref-bg:light-dark(#fff,#252329); --ref-surface:light-dark(#fbfafd,#302e34); --ref-text:light-dark(#2f2e35,#f1eff4); --ref-muted:light-dark(#737278,#b8b5bd); --ref-border:light-dark(#d1d0d5,#5a575f); --ref-subtle:light-dark(#f0eff3,#3b3940); --ref-focus:light-dark(#1f75cb,#63a6e9); --ref-orange:#e24329; --ref-green:light-dark(#108548,#2f9b5f); --ref-red:light-dark(#c91c30,#e45b68); --ref-blue:light-dark(#1f75cb,#63a6e9); --ref-confirm-fill:light-dark(#108548,#176a3a); --ref-danger-fill:light-dark(#c91c30,#a52a39); --ref-selected-fill:light-dark(#1f75cb,#2868a9); --ref-add:light-dark(#e1f5e7,#163d2a); --ref-del:light-dark(#fbe5e7,#48242b); box-sizing:border-box; width:100%; max-width:640px; color-scheme:inherit; color:var(--ref-text); background:var(--ref-bg); border:1px solid var(--ref-border); border-radius:4px; font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.gl-ref *, .gl-ref *::before, .gl-ref *::after { box-sizing:border-box; }.gl-ref button { font:inherit; cursor:pointer; }.gl-ref button:focus-visible { outline:2px solid var(--ref-focus); outline-offset:2px; }
.gl-ref-row { display:flex; align-items:center; gap:8px; padding:14px; flex-wrap:wrap; }.gl-ref-button,.gl-ref-icon-button { min-height:32px; border:1px solid var(--ref-border); border-radius:4px; color:var(--ref-text); background:var(--ref-bg); padding:5px 10px; font-weight:600; }.gl-ref-button:hover,.gl-ref-icon-button:hover { background:var(--ref-subtle); }.gl-ref-button--confirm { color:#fff; background:var(--ref-confirm-fill); border-color:var(--ref-confirm-fill); }.gl-ref-button--danger { color:#fff; background:var(--ref-danger-fill); border-color:var(--ref-danger-fill); }.gl-ref-button--link { border-color:transparent; color:var(--ref-blue); background:transparent; }.gl-ref-icon-button { width:32px; padding:0; font-size:18px; }.gl-ref-spinner { display:inline-block; width:13px; height:13px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; vertical-align:-2px; animation:gl-ref-spin .75s linear infinite; }.gl-ref-spinner--large { width:24px; height:24px; border-width:3px; color:var(--ref-blue); } @keyframes gl-ref-spin { to { transform:rotate(360deg); } }
.gl-ref-avatar { display:grid; place-items:center; width:32px; height:32px; border-radius:50%; color:#fff; background:#6b4fbb; font-size:10px; font-weight:700; }.gl-ref-avatar--small { width:24px; height:24px; background:#167a89; font-size:8px; }.gl-ref-badge { display:inline-flex; align-items:center; min-height:22px; padding:2px 7px; border-radius:10px; font-size:11px; font-weight:600; background:var(--ref-subtle); }.gl-ref-badge--opened { color:light-dark(#175ec0,#b7d8ff); background:light-dark(#e5f0ff,#263e62); }.gl-ref-badge--merged { color:light-dark(#14713d,#b8edc9); background:light-dark(#dff3e7,#214a32); }.gl-ref-badge--warning { color:light-dark(#7b5000,#ffe1a3); background:light-dark(#fff1d2,#57421f); }.gl-ref-badge--info { color:light-dark(#195e9f,#b9e0ff); background:light-dark(#e3f1fb,#244563); }
.gl-ref-navigation { padding:12px; }.gl-ref-tabs { display:flex; gap:18px; border-bottom:1px solid var(--ref-border); }.gl-ref-tab { position:relative; padding:7px 0; border:0; color:var(--ref-muted); background:transparent; font-weight:600; }.gl-ref-tab span,.gl-ref-count { margin-left:3px; color:var(--ref-muted); font-size:11px; }.gl-ref-tab.is-active { color:var(--ref-text); }.gl-ref-tab.is-active::after { position:absolute; right:0; bottom:-1px; left:0; height:2px; background:var(--ref-orange); content:""; }.gl-ref-panel { padding:10px 0; color:var(--ref-muted); }.gl-ref-accordion { border-top:1px solid var(--ref-border); }.gl-ref-accordion h3 { margin:0; }.gl-ref-accordion h3 button { display:flex; width:100%; gap:7px; padding:9px 0; border:0; color:var(--ref-text); background:transparent; text-align:left; font-weight:600; }.gl-ref-accordion h3 button .gl-ref-count { margin-left:auto; }.gl-ref-accordion > div { padding:0 0 8px 19px; color:var(--ref-muted); }
.gl-ref-work-item { display:flex; gap:10px; align-items:flex-start; min-height:74px; padding:12px; }.gl-ref-rail { width:3px; align-self:stretch; border-radius:2px; background:var(--ref-orange); }.gl-ref-work-main { display:grid; gap:4px; min-width:0; flex:1; }.gl-ref-work-main strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.gl-ref-muted { display:block; color:var(--ref-muted); font-size:11px; }.gl-ref-tree { padding:8px; }.gl-ref-treeitem { display:flex; align-items:center; gap:6px; width:100%; min-height:30px; border:0; color:var(--ref-text); background:transparent; text-align:left; }.gl-ref-treeitem:hover { background:var(--ref-subtle); }.gl-ref-tree-group { margin-left:13px; padding-left:9px; border-left:1px solid var(--ref-border); }.gl-ref-treeitem--file.is-selected { border-left:3px solid var(--ref-orange); background:var(--ref-subtle); }.gl-ref-treeitem small { margin-left:auto; color:var(--ref-muted); }.gl-ref-treeitem small b { color:var(--ref-green); }
.gl-ref-diff-header { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:9px 10px; border-bottom:1px solid var(--ref-border); }.gl-ref-diff-header strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.gl-ref-button-group { display:flex; flex:none; }.gl-ref-button-group button { min-height:28px; border:1px solid var(--ref-border); color:var(--ref-text); background:var(--ref-bg); padding:3px 7px; }.gl-ref-button-group button + button { margin-left:-1px; }.gl-ref-button-group button[aria-pressed="true"] { position:relative; z-index:1; color:#fff; background:var(--ref-selected-fill); border-color:var(--ref-selected-fill); }.gl-ref-diff table { width:100%; border-collapse:collapse; font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace; }.gl-ref-diff td { padding:2px 7px; }.gl-ref-diff td:nth-child(-n+2) { width:34px; color:var(--ref-muted); text-align:right; user-select:none; }.gl-ref-added { background:var(--ref-add); }.gl-ref-deleted { background:var(--ref-del); }
.gl-ref-discussion { display:flex; gap:9px; padding:12px; }.gl-ref-comment { min-width:0; flex:1; border:1px solid var(--ref-border); border-radius:4px; }.gl-ref-comment header { display:flex; flex-wrap:wrap; gap:7px; align-items:center; padding:7px 9px; background:var(--ref-surface); }.gl-ref-comment header .gl-ref-muted { display:inline; }.gl-ref-comment p { margin:0; padding:9px; }.gl-ref-resolve { margin-left:auto; border:0; color:var(--ref-blue); background:transparent; font-weight:600; }.gl-ref-discussion.is-resolved .gl-ref-comment { border-color:var(--ref-green); }.gl-ref-editor { padding:10px; }.gl-ref-toolbar { display:flex; gap:2px; padding:4px; border:1px solid var(--ref-border); border-bottom:0; border-radius:4px 4px 0 0; background:var(--ref-surface); }.gl-ref-toolbar button { width:28px; height:26px; border:0; border-radius:3px; color:var(--ref-text); background:transparent; }.gl-ref-toolbar button:hover { background:var(--ref-subtle); }.gl-ref-editable { min-height:72px; padding:9px; border:1px solid var(--ref-border); outline:0; }.gl-ref-editor footer { display:flex; justify-content:space-between; align-items:center; gap:8px; padding-top:8px; }
.gl-ref-markdown { padding:12px 15px; }.gl-ref-markdown p { margin:0 0 8px; }.gl-ref-markdown blockquote { margin:8px 0; padding:5px 10px; border-left:3px solid var(--ref-border); color:var(--ref-muted); }.gl-ref-markdown ul { margin:8px 0; padding-left:20px; }.gl-ref-markdown code { padding:1px 3px; border-radius:2px; background:var(--ref-subtle); font-family:ui-monospace,monospace; }.gl-ref-markdown pre { margin:8px 0; padding:8px; overflow:auto; border-radius:3px; background:var(--ref-subtle); }.gl-ref-image-placeholder { display:grid; place-items:center; height:70px; border:1px dashed var(--ref-border); border-radius:3px; color:var(--ref-muted); background:var(--ref-surface); font-size:22px; }.gl-ref-image-placeholder span { font-size:11px; }
.gl-ref-empty-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:12px; }.gl-ref-empty { display:grid; justify-items:center; gap:6px; padding:12px; border:1px solid var(--ref-border); border-radius:4px; text-align:center; }.gl-ref-empty p { margin:0; color:var(--ref-muted); font-size:11px; }.gl-ref-empty-icon { color:var(--ref-blue); font-size:25px; }.gl-ref-popover-anchor { position:relative; padding:18px; min-height:116px; }.gl-ref-popover { position:absolute; z-index:2; top:58px; left:18px; display:grid; gap:5px; width:225px; padding:11px; border:1px solid var(--ref-border); border-radius:4px; box-shadow:0 4px 12px rgb(0 0 0 / 20%); background:var(--ref-bg); }.gl-ref-popover span { color:var(--ref-muted); font-size:11px; }.gl-ref-popover .gl-ref-button { justify-self:start; margin-top:3px; }
@media (max-width:390px) { .gl-ref { border-radius:0; }.gl-ref-actions { gap:6px; padding:10px; }.gl-ref-button { padding:4px 8px; }.gl-ref-diff-header { align-items:flex-start; flex-direction:column; }.gl-ref-empty-grid { grid-template-columns:1fr; }.gl-ref-work-item { padding:10px; }.gl-ref-editor footer { align-items:flex-end; flex-direction:column; }.gl-ref-popover { right:10px; left:auto; width:calc(100% - 20px); } }
</style>
