import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, within } from "storybook/test";
import type { FileSummary } from "../../src/reviewTypes";
import { buildChangedFileTree, compactChangedFileTree } from "../../src/reviewTreeUtils";
import TreeItem from "./TreeItem.vue";

const meta = {
  title: "Sidebar/Changed file tree",
  component: TreeItem,
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-narrow" style="min-height:0;padding:8px"><story /></div>' })
  ],
  parameters: { layout: "centered" }
} satisfies Meta<typeof TreeItem>;

export default meta;
type Story = StoryObj<typeof meta>;

const files: FileSummary[] = [
  { path: "src/features/review/panel/App.vue", language: "vue", additions: 12, deletions: 3, threadCount: 2, unresolvedThreadCount: 1, resolvedThreadCount: 1, hasLocalEdit: false },
  { path: "src/features/review/panel/style.css", language: "css", additions: 4, deletions: 1, threadCount: 0, unresolvedThreadCount: 0, resolvedThreadCount: 0, hasLocalEdit: false },
  { path: "src/features/review/shared.ts", language: "typescript", additions: 2, deletions: 0, threadCount: 0, unresolvedThreadCount: 0, resolvedThreadCount: 0, hasLocalEdit: false },
  { path: "src/README.md", language: "markdown", additions: 1, deletions: 0, threadCount: 0, unresolvedThreadCount: 0, resolvedThreadCount: 0, hasLocalEdit: false },
  { path: "package.json", language: "json", additions: 1, deletions: 1, threadCount: 0, unresolvedThreadCount: 0, resolvedThreadCount: 0, hasLocalEdit: false }
];

export const CompactDirectoryChains: Story = {
  args: {
    node: compactChangedFileTree(buildChangedFileTree(files))[0],
    kind: "changed",
    activeFilePath: "src/features/review/panel/App.vue"
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("src"));
    await expect(canvas.getByText("features/review")).toBeVisible();
    await userEvent.click(canvas.getByText("features/review"));
    await userEvent.click(canvas.getByText("panel"));
    await expect(canvas.getByText("App.vue")).toBeVisible();
    await expect(canvas.getByText("src")).toBeVisible();
  }
};
