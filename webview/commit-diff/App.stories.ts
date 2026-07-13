import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, within } from "storybook/test";
import { onMounted } from "vue";
import type { CommitDiffViewState } from "../../src/webviewProtocol";
import App from "./App.vue";

const state: CommitDiffViewState = {
  commit: {
    id: "commit-1",
    shortId: "abc1234",
    title: "Update answer",
    authorName: "Reviewer One",
    authoredAt: "2026-01-01T00:00:00.000Z",
    committedAt: "2026-01-01T00:00:00.000Z"
  },
  file: {
    path: "src/review.ts",
    oldPath: "src/review.ts",
    newPath: "src/review.ts",
    diff: "@@ -1 +1 @@\n-const answer = 41;\n+const answer = 42;",
    status: "modified",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    collapsed: false,
    tooLarge: false
  }
};

const meta = {
  title: "Review/Commit diff",
  component: App,
  parameters: { layout: "fullscreen" },
  decorators: [
    () => ({ template: '<div class="storybook-frame editor-wide" style="min-height:0"><story /></div>' })
  ]
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SideBySideDiff: Story = {
  render: () => ({
    components: { CommitDiffApp: App },
    setup() {
      onMounted(() => {
        window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state } }));
      });
    },
    template: "<CommitDiffApp />"
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("変更前")).toBeVisible();
    await expect(canvas.getByText("変更後")).toBeVisible();
    await expect(canvas.getByText("const answer = 41;")).toBeVisible();
    await expect(canvas.getByText("const answer = 42;")).toBeVisible();
  }
};
