import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, within } from "storybook/test";
import { mergeRequest, populatedMyWorkState } from "../stories/myWorkFixtures";
import type { MyWorkMergeRequest } from "../../src/myWorkTypes";
import MyWorkView from "./MyWorkView.vue";

const meta = {
  title: "Workspace/My work",
  component: MyWorkView,
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-typical"><story /></div>' })
  ],
  parameters: { layout: "centered" }
} satisfies Meta<typeof MyWorkView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {
  args: { state: populatedMyWorkState() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "My work" })).toBeVisible();
    await expect(canvas.getByText("Action required")).toBeVisible();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Refresh My work" })).toHaveFocus();
  }
};

export const Narrow: Story = {
  args: { state: populatedMyWorkState() },
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-narrow"><story /></div>' })
  ]
};

export const HighDensityPressure: Story = {
  args: {
    state: populatedMyWorkState({
      buckets: {
        attention: Array.from({ length: 4 }, (_, index) => mergeWorkItem(index, "attention")),
        active: Array.from({ length: 4 }, (_, index) => mergeWorkItem(index + 4, "active")),
        waiting: Array.from({ length: 3 }, (_, index) => mergeWorkItem(index + 8, "waiting"))
      },
      attentionCount: 4
    })
  },
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-narrow"><story /></div>' })
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "My work" })).toBeVisible();
    await expect(canvas.getByText("Action required")).toBeVisible();
    await expect(canvas.getAllByRole("button")).toHaveLength(12);
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Refresh My work" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getAllByRole("button")[1]).toHaveFocus();
  }
};

export const RefreshingCachedContent: Story = {
  args: {
    state: populatedMyWorkState({ phase: "loading" })
  }
};

export const PartialFailure: Story = {
  args: {
    state: populatedMyWorkState({
      phase: "partial",
      failedSources: ["todo", "candidates"]
    })
  }
};

export const Empty: Story = {
  args: {
    state: {
      phase: "ready",
      buckets: { attention: [], active: [], waiting: [] },
      attentionCount: 0,
      lastSuccessfulAt: new Date().toISOString(),
      failedSources: []
    }
  }
};

export const InitialLoading: Story = {
  args: {
    state: {
      phase: "loading",
      buckets: { attention: [], active: [], waiting: [] },
      attentionCount: 0,
      failedSources: []
    }
  }
};

function mergeWorkItem(index: number, bucket: "attention" | "active" | "waiting"): MyWorkMergeRequest {
  return {
    ...mergeRequest(),
    key: `pressure:${bucket}:${index}`,
    iid: 100 + index,
    bucket,
    projectPath: "platform/review-workspace",
    title: `Keep dense review context visible in queue item ${index + 1}`,
    sourceBranch: `feature/review-queue-${index + 1}`,
    attentionReasons: bucket === "attention" ? ["review-requested"] : [],
    roles: bucket === "attention" ? ["reviewer"] : ["author"],
    hasPendingTodo: bucket === "attention"
  };
}
