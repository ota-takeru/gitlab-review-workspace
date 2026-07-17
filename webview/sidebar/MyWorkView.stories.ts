import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, within } from "storybook/test";
import { populatedMyWorkState } from "../stories/myWorkFixtures";
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
