import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { candidate, mergeRequest } from "../stories/myWorkFixtures";
import WorkItemRow from "./WorkItemRow.vue";

const openMr = fn();

const meta = {
  title: "Sidebar/Work item row",
  component: WorkItemRow,
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-typical" style="min-height:0;padding:8px"><story /></div>' })
  ],
  parameters: { layout: "centered" }
} satisfies Meta<typeof WorkItemRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewRequested: Story = {
  args: { item: mergeRequest() },
  render: (args) => ({
    components: { WorkItemRow },
    setup: () => ({ args, openMr }),
    template: '<WorkItemRow v-bind="args" @open-mr="openMr" />'
  }),
  play: async ({ canvasElement }) => {
    openMr.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button"));
    await expect(openMr).toHaveBeenCalledOnce();
  }
};

export const PipelineFailed: Story = {
  args: {
    item: mergeRequest({
      iid: 51,
      key: "101:51",
      title: "Fix pipeline failures in comment image uploads",
      attentionReasons: ["pipeline-failed"],
      roles: ["author"]
    })
  }
};

export const Draft: Story = {
  args: {
    item: mergeRequest({
      iid: 45,
      key: "101:45",
      draft: true,
      roles: ["author"],
      attentionReasons: [],
      hasPendingTodo: false,
      bucket: "active"
    })
  }
};

export const MergeRequestCandidate: Story = {
  args: { item: candidate() }
};

export const LongContent: Story = {
  args: {
    item: mergeRequest({
      projectPath: "very-long-platform-group/review-workspace-extension",
      title: "Keep changed files, commits, discussions, local workspace state, and responsive actions readable in a narrow sidebar",
      sourceBranch: "feature/a-very-long-source-branch-name-that-must-truncate",
      targetBranch: "release/a-very-long-target-branch-name"
    })
  },
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-narrow" style="min-height:0;padding:8px"><story /></div>' })
  ]
};
