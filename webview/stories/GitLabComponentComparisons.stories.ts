import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, within } from "storybook/test";
import { ref, type Component } from "vue";
import type { ChangedFileTreeNode } from "../../src/reviewTreeUtils";
import GlAvatar from "../common/components/GlAvatar.vue";
import GlBadge from "../common/components/GlBadge.vue";
import GlButton from "../common/components/GlButton.vue";
import GlComment from "../common/components/GlComment.vue";
import GlCommentForm from "../common/components/GlCommentForm.vue";
import GlDiffHeader from "../common/components/GlDiffHeader.vue";
import GlDiffScopeToggle from "../common/components/GlDiffScopeToggle.vue";
import GlDiffTable, { type GlDiffLine } from "../common/components/GlDiffTable.vue";
import GlEmptyState from "../common/components/GlEmptyState.vue";
import GlIconButton from "../common/components/GlIconButton.vue";
import GlMarkdown from "../common/components/GlMarkdown.vue";
import GlPopover from "../common/components/GlPopover.vue";
import GlSection from "../common/components/GlSection.vue";
import GlStatusBadge from "../common/components/GlStatusBadge.vue";
import GlThreadStatusAction from "../common/components/GlThreadStatusAction.vue";
import SidebarTabs from "../sidebar/SidebarTabs.vue";
import TreeItem from "../sidebar/TreeItem.vue";
import WorkItemRow from "../sidebar/WorkItemRow.vue";
import ComponentComparisonFrame, { type ComponentReferenceLink } from "./ComponentComparisonFrame.vue";
import { mergeRequest } from "./myWorkFixtures";

type Comparison = {
  comparisonId: string;
  title: string;
  extensionComponents: string[];
  gitlabComponents: string[];
  referenceSummary: string;
  references: ComponentReferenceLink[];
  aligned: string[];
  differences: string[];
  gaps?: string[];
};

const comparisons = {
  actions: {
    comparisonId: "actions",
    title: "Buttons and icon actions",
    extensionComponents: ["GlButton", "GlIconButton", "GlIcon"],
    gitlabComponents: ["Button", "Tooltip"],
    referenceSummary: "Pajamas Button defines action hierarchy, loading behavior, accessible icon-only controls, and the distinction between actions and links.",
    references: [
      { label: "Pajamas Button", href: "https://design.gitlab.com/components/button/" },
      { label: "Pajamas Tooltip", href: "https://design.gitlab.com/components/tooltip/" }
    ],
    aligned: ["default / confirm / danger / link variants", "small and medium sizes", "spinner replaces or precedes content while loading", "icon-only buttons always have an accessible label"],
    differences: ["Extension colors come from the active VS Code theme", "Compact sidebar actions use 24px targets where Pajamas prefers medium targets when space allows"],
    gaps: ["Extension disabled buttons use native disabled; Pajamas keeps controls focusable with aria-disabled so the reason can remain discoverable", "Pajamas generally discourages combining an icon and text when either alone is sufficient"]
  },
  identity: {
    comparisonId: "identity-status",
    title: "Avatar, badge, and status identity",
    extensionComponents: ["GlAvatar", "GlBadge", "GlStatusBadge"],
    gitlabComponents: ["Avatar", "Badge"],
    referenceSummary: "GitLab uses avatars for people or projects and badges for concise, non-interactive metadata with semantic variants.",
    references: [
      { label: "Pajamas Avatar", href: "https://design.gitlab.com/components/avatar/" },
      { label: "Pajamas Badge", href: "https://design.gitlab.com/components/badge/" }
    ],
    aligned: ["Circular person identity and deterministic fallback", "Short status text with semantic success, warning, danger, and info tones", "Pill treatment for lifecycle status"],
    differences: ["Extension fallback colors are generated from the user name and tuned for VS Code", "Extension exposes only compact 24px and 28px avatar sizes"],
    gaps: ["Pajamas supports a wider 16–96px size scale and separate square project avatars", "Adjacent avatar text should determine whether image alt text is descriptive or empty"]
  },
  navigation: {
    comparisonId: "navigation-grouping",
    title: "Tabs and section grouping",
    extensionComponents: ["SidebarTabs", "GlSection"],
    gitlabComponents: ["Tabs", "Accordion"],
    referenceSummary: "Pajamas Tabs switch substantial related sections; Accordion progressively discloses secondary content without changing context.",
    references: [
      { label: "Pajamas Tabs", href: "https://design.gitlab.com/components/tabs/" },
      { label: "Pajamas Accordion", href: "https://design.gitlab.com/components/accordion/" }
    ],
    aligned: ["One active tab with an indicator and optional count", "Concise section labels and compact actions", "Visual hierarchy stays restrained in a dense sidebar"],
    differences: ["Review / My work changes the sidebar workspace context rather than a page URL", "GlSection is a layout primitive; collapse behavior is owned by the consuming view"],
    gaps: ["SidebarTabs does not yet implement tabpanel relationships or arrow-key tab navigation", "Pajamas advises navigation instead of tabs when changing application context"]
  },
  workItem: {
    comparisonId: "work-item-row",
    title: "Merge request work item row",
    extensionComponents: ["WorkItemRow", "GlBadge", "GlIcon"],
    gitlabComponents: ["Attribute list", "Badge", "MR list item"],
    referenceSummary: "GitLab list rows prioritize object identity, title, assignee or reviewer metadata, status badges, and updated time.",
    references: [
      { label: "Pajamas Attribute list", href: "https://design.gitlab.com/components/attribute-list/" },
      { label: "GitLab merge requests", href: "https://gitlab.com/gitlab-org/gitlab/-/merge_requests" }
    ],
    aligned: ["Reason and role badges precede secondary metadata", "Project and MR identity remain distinct from the title", "Long branches and paths truncate without hiding the action"],
    differences: ["Extension adds a colored left rail for queue state", "Rows are optimized for a 320–400px VS Code sidebar rather than a full-width GitLab list"],
    gaps: ["GitLab list filtering, bulk actions, pipeline details, and assignee avatars are intentionally outside this row"]
  },
  tree: {
    comparisonId: "file-tree",
    title: "Changed-file and branch tree",
    extensionComponents: ["TreeItem", "GlSection", "GlIcon"],
    gitlabComponents: ["Tree", "Accordion"],
    referenceSummary: "Pajamas Tree represents parent-child hierarchy with chevrons, icons, labels, connectors, selection, and keyboard semantics.",
    references: [
      { label: "Pajamas Tree", href: "https://design.gitlab.com/components/tree/" },
      { label: "Pajamas Accordion", href: "https://design.gitlab.com/components/accordion/" }
    ],
    aligned: ["Chevron and folder icon communicate expansion", "Indentation and connector lines show hierarchy", "Selected file, diff statistics, discussions, and local edits remain visible"],
    differences: ["Extension uses native details elements for folders and buttons for files", "Selection uses an orange left rail to fit the review workspace language"],
    gaps: ["The current tree does not expose role=tree / treeitem or roving keyboard navigation required by the full Pajamas pattern"]
  },
  diff: {
    comparisonId: "diff-controls",
    title: "Diff header, range toggle, and table",
    extensionComponents: ["GlDiffHeader", "GlDiffScopeToggle", "GlDiffTable"],
    gitlabComponents: ["Merge request Changes", "Button group"],
    referenceSummary: "GitLab Changes keeps file identity and actions attached to the diff; Pajamas Button group is used for mutually exclusive local views.",
    references: [
      { label: "GitLab MR reviews", href: "https://docs.gitlab.com/user/project/merge_requests/reviews/" },
      { label: "Pajamas Button group", href: "https://design.gitlab.com/components/button-group/" }
    ],
    aligned: ["File path, status, metadata, and actions share a sticky header", "Old and new line numbers remain separate", "aria-pressed communicates the selected diff range"],
    differences: ["Changes / full file is an extension-specific mode that preserves comment anchors", "The table is optimized for VS Code editor fonts and theme diff colors"],
    gaps: ["No side-by-side diff mode", "Shared primitive does not itself provide syntax highlighting, collapsed-hunk controls, or per-line comment buttons"]
  },
  discussion: {
    comparisonId: "discussion-thread",
    title: "Comment and thread lifecycle",
    extensionComponents: ["GlComment", "GlThreadStatusAction", "GlAvatar", "GlMarkdown"],
    gitlabComponents: ["Discussion thread", "Button", "Avatar"],
    referenceSummary: "GitLab discussions anchor comments to review context and let eligible users reply, resolve, and reopen without losing history.",
    references: [
      { label: "GitLab Discussions", href: "https://docs.gitlab.com/user/discussions/" },
      { label: "GitLab MR reviews", href: "https://docs.gitlab.com/user/project/merge_requests/reviews/" }
    ],
    aligned: ["Avatar, author, timestamp, edited state, actions, and body follow the same reading order", "Resolve and Reopen share one stable control position", "Pending mutations keep existing content visible"],
    differences: ["Extension swaps the visible status label to the action on hover or focus", "Resolved threads collapse to a compact summary suited to the editor rail"],
    gaps: ["Pending review batches, suggestions, emoji reactions, and system notes are not represented by these primitives"]
  },
  editor: {
    comparisonId: "comment-editor",
    title: "Review comment editor",
    extensionComponents: ["GlCommentForm", "GlIconButton", "GlButton"],
    gitlabComponents: ["Rich text editor", "Button", "GLFM"],
    referenceSummary: "GitLab comment fields support rich-text and Markdown workflows, formatting actions, uploads, shortcuts, and rendered GLFM output.",
    references: [
      { label: "GitLab Flavored Markdown", href: "https://docs.gitlab.com/user/markdown/" },
      { label: "GitLab MR reviews", href: "https://docs.gitlab.com/user/project/merge_requests/reviews/" }
    ],
    aligned: ["Formatting is applied at the current selection", "Compact idle state expands when editing", "Submit, cancel, shortcut, loading, and image attachment states stay near the field"],
    differences: ["Extension uses one contenteditable surface with immediate visual formatting", "Toolbar is deliberately limited to frequent review formats"],
    gaps: ["No plain-text / rich-text mode switch", "Mentions, quick actions, suggestions, tables, task lists, and non-image attachments are not yet available"]
  },
  markdown: {
    comparisonId: "markdown-images",
    title: "Rendered Markdown and comment images",
    extensionComponents: ["GlMarkdown", "commentImages"],
    gitlabComponents: ["GLFM renderer", "Modal", "User uploads"],
    referenceSummary: "GitLab renders GLFM semantically, resolves project uploads with access control, and opens images in an overlay.",
    references: [
      { label: "GitLab Flavored Markdown", href: "https://docs.gitlab.com/user/markdown/" },
      { label: "Pajamas Modal", href: "https://design.gitlab.com/components/modal/" },
      { label: "GitLab user uploads", href: "https://docs.gitlab.com/security/user_file_uploads/" }
    ],
    aligned: ["Safe links, quotes, lists, inline code, code blocks, and images render as semantic content", "Private image resolution stays authenticated", "Image activation opens a labeled overlay and Escape closes it"],
    differences: ["Extension renderer is a deliberately small allowlist rather than GitLab's complete GLFM pipeline", "Image overlay is optimized for review evidence and VS Code webviews"],
    gaps: ["Tables, task lists, diagrams, math, references, audio, video, and advanced image sizing are not supported"]
  },
  empty: {
    comparisonId: "empty-loading",
    title: "Empty, loading, and retry states",
    extensionComponents: ["GlEmptyState", "GlButton", "GlIcon"],
    gitlabComponents: ["Empty state", "Spinner"],
    referenceSummary: "GitLab empty states explain what is missing and the next useful action; spinners communicate short asynchronous waits.",
    references: [
      { label: "Pajamas Empty states", href: "https://design.gitlab.com/patterns/empty-states/" },
      { label: "Pajamas Spinner", href: "https://design.gitlab.com/components/spinner/" }
    ],
    aligned: ["Concise title, explanatory sentence, optional action", "Loading icon has an accessible textual state", "Compact variant avoids wasting sidebar space"],
    differences: ["Developer-tool empty states omit promotional illustrations", "One primitive covers blank, loading, error, and retry states through content"],
    gaps: ["No skeleton-loader primitive for preserving the shape of complex cached content"]
  },
  popover: {
    comparisonId: "popover",
    title: "Context popover",
    extensionComponents: ["GlPopover", "GlIconButton"],
    gitlabComponents: ["Popover"],
    referenceSummary: "Pajamas Popover provides short supplemental information and actions without forcing the user to leave the current context.",
    references: [{ label: "Pajamas Popover", href: "https://design.gitlab.com/components/popover/" }],
    aligned: ["Labeled dialog content appears next to a deliberate trigger", "Escape and outside pointer interaction dismiss it", "Opening moves focus into the popover"],
    differences: ["Extension supports start / end alignment within the narrow webview", "Content and dismissal controls are supplied by the caller"],
    gaps: ["No arrow tip, collision-aware placement, or automatic return of focus to the trigger"]
  }
} satisfies Record<string, Comparison>;

const meta = {
  title: "References/Component comparisons",
  parameters: { layout: "fullscreen" }
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type SetupFactory = () => Record<string, unknown>;

function renderComparison(
  comparison: Comparison,
  components: Record<string, Component>,
  specimen: string,
  setupFactory: SetupFactory = () => ({})
) {
  return () => ({
    components: { ComponentComparisonFrame, ...components },
    setup() { return { comparison, ...setupFactory() }; },
    template: `<ComponentComparisonFrame v-bind="comparison">${specimen}</ComponentComparisonFrame>`
  });
}

function comparisonPlay(comparison: Comparison) {
  return async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector(`[data-comparison-id="${comparison.comparisonId}"]`) as HTMLElement;
    await expect(root).toBeVisible();
    await expect(canvas.getByRole("heading", { name: comparison.title })).toBeVisible();
    await expect(canvas.getByLabelText("Extension component specimen")).toBeVisible();
    const links = canvas.getAllByRole("link");
    await expect(links).toHaveLength(comparison.references.length);
    for (const link of links) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  };
}

export const Actions: Story = {
  render: renderComparison(comparisons.actions, { GlButton, GlIconButton }, `
    <div class="comparison-demo-row">
      <GlButton>Default</GlButton>
      <GlButton variant="confirm" icon="check">Save review</GlButton>
      <GlButton variant="danger">Discard</GlButton>
      <GlButton variant="link">Open in GitLab</GlButton>
      <GlButton loading>Saving</GlButton>
      <GlIconButton icon="retry" label="Refresh review" variant="default" />
    </div>`),
  play: comparisonPlay(comparisons.actions)
};

export const IdentityAndStatus: Story = {
  render: renderComparison(comparisons.identity, { GlAvatar, GlBadge, GlStatusBadge }, `
    <div class="comparison-demo-row">
      <GlAvatar name="Otata Reviewer" />
      <GlAvatar name="GitLab User" size="medium" />
      <GlStatusBadge status="opened" />
      <GlStatusBadge status="merged" />
      <GlBadge tone="warning" icon="warning">Review requested</GlBadge>
      <GlBadge tone="info" pill>reviewer</GlBadge>
    </div>`),
  play: comparisonPlay(comparisons.identity)
};

export const NavigationAndGrouping: Story = {
  render: renderComparison(comparisons.navigation, { SidebarTabs, GlSection, GlIconButton }, `
    <div class="comparison-sidebar-demo">
      <SidebarTabs :active-tab="activeTab" :attention-count="3" @select="activeTab = $event" />
      <div style="padding:12px">
        <GlSection title="Changed files" :count="12">
          <template #actions><GlIconButton icon="retry" label="Refresh changed files" size="small" /></template>
          <p style="margin:0;color:var(--vscode-descriptionForeground)">Section content remains owned by the review view.</p>
        </GlSection>
      </div>
    </div>`,
    () => ({ activeTab: ref<"review" | "my-work">("review") })),
  play: async (context) => {
    await comparisonPlay(comparisons.navigation)(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: /My work/ }));
    await expect(canvas.getByRole("tab", { name: /My work/ })).toHaveAttribute("aria-selected", "true");
  }
};

export const WorkQueueRow: Story = {
  render: renderComparison(comparisons.workItem, { WorkItemRow }, `
    <div class="comparison-sidebar-demo" style="padding:12px">
      <WorkItemRow :item="item" @open-mr="opened = true" />
      <p v-if="opened" aria-live="polite" style="margin:8px 0 0">MR selected without checkout.</p>
    </div>`,
    () => ({ item: mergeRequest(), opened: ref(false) })),
  play: comparisonPlay(comparisons.workItem)
};

const changedTree: ChangedFileTreeNode = {
  name: "webview",
  path: "webview",
  type: "tree",
  children: [{
    name: "App.vue",
    path: "webview/App.vue",
    type: "file",
    children: [],
    file: { path: "webview/App.vue", language: "vue", additions: 12, deletions: 3, threadCount: 2, unresolvedThreadCount: 1, resolvedThreadCount: 1, hasLocalEdit: true }
  }]
};

export const FileTree: Story = {
  render: renderComparison(comparisons.tree, { TreeItem }, `
    <div class="comparison-sidebar-demo" style="padding:12px">
      <TreeItem :node="tree" kind="changed" active-file-path="webview/App.vue" />
    </div>`,
    () => ({ tree: changedTree })),
  play: comparisonPlay(comparisons.tree)
};

const diffLines: GlDiffLine[] = [
  { key: "context", kind: "context", oldLine: 8, newLine: 8, text: " const state = ready;" },
  { key: "removed", kind: "deleted", oldLine: 9, text: "-return legacyView;" },
  { key: "added", kind: "added", newLine: 9, text: "+return reviewView;" }
];

export const DiffControls: Story = {
  render: renderComparison(comparisons.diff, { GlDiffHeader, GlDiffScopeToggle, GlDiffTable }, `
    <div class="comparison-demo-stack">
      <GlDiffHeader path="webview/review-file/App.vue" status="modified" status-label="M">
        <template #meta>+12 −3 · 2 discussions</template>
        <template #actions><GlDiffScopeToggle v-model="scope" /></template>
      </GlDiffHeader>
      <GlDiffTable :lines="lines" aria-label="Component comparison diff" />
    </div>`,
    () => ({ scope: ref<"changes" | "file">("changes"), lines: diffLines })),
  play: async (context) => {
    await comparisonPlay(comparisons.diff)(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "ファイル全体" }));
    await expect(canvas.getByRole("button", { name: "ファイル全体" })).toHaveAttribute("aria-pressed", "true");
  }
};

export const DiscussionThread: Story = {
  render: renderComparison(comparisons.discussion, { GlComment, GlThreadStatusAction, GlMarkdown }, `
    <div class="comparison-demo-stack">
      <GlComment author="otataker" date="2m ago" edited>
        <template #actions><GlThreadStatusAction :resolved="resolved" @toggle="resolved = !resolved" /></template>
        <GlMarkdown source="**Review note:** keep the selected line visible when this thread collapses." />
      </GlComment>
    </div>`,
    () => ({ resolved: ref(false) })),
  play: comparisonPlay(comparisons.discussion)
};

export const CommentEditor: Story = {
  render: renderComparison(comparisons.editor, { GlCommentForm }, `
    <GlCommentForm v-model="comment" aria-label="Comparison review comment" placeholder="Write a comment…" submit-label="Comment" />`,
    () => ({ comment: ref("Please keep **comment anchors** stable.") })),
  play: async (context) => {
    await comparisonPlay(comparisons.editor)(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole("textbox", { name: "Comparison review comment" }));
    await expect(canvas.getByRole("toolbar", { name: "Markdown書式" })).toBeVisible();
  }
};

export const MarkdownAndImages: Story = {
  render: renderComparison(comparisons.markdown, { GlMarkdown }, `
    <div class="comparison-demo-stack">
      <GlMarkdown :source="markdown" />
    </div>`,
    () => ({ markdown: "**Rendered review**\n\n> Keep the GitLab meaning, even inside VS Code.\n\n- safe links\n- semantic lists\n- inline `code`" })),
  play: comparisonPlay(comparisons.markdown)
};

export const EmptyAndLoading: Story = {
  render: renderComparison(comparisons.empty, { GlEmptyState, GlButton }, `
    <div class="comparison-demo-stack" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      <GlEmptyState title="No review threads" description="Open a changed file and select a line to start a discussion." compact>
        <template #actions><GlButton size="small">Open changed files</GlButton></template>
      </GlEmptyState>
      <GlEmptyState title="Refreshing review" description="Cached content stays visible while GitLab is contacted." icon="spinner" compact />
    </div>`),
  play: comparisonPlay(comparisons.empty)
};

export const ContextPopover: Story = {
  render: renderComparison(comparisons.popover, { GlButton, GlPopover }, `
    <div class="comparison-popover-anchor">
      <GlButton size="small" @click="popoverOpen = true">Open local actions</GlButton>
      <GlPopover :open="popoverOpen" label="Local workspace actions" align="start" @close="popoverOpen = false">
        <div class="comparison-popover-content">
          <strong>Local workspace</strong>
          <span>feature/review-ui · Clean</span>
          <GlButton size="small">Open existing worktree</GlButton>
        </div>
      </GlPopover>
    </div>`,
    () => ({ popoverOpen: ref(true) })),
  play: async (context) => {
    await comparisonPlay(comparisons.popover)(context);
    await expect(within(context.canvasElement).getByRole("dialog", { name: "Local workspace actions" })).toBeVisible();
  }
};
