import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, within } from "storybook/test";
import { ref } from "vue";
import type { ReviewReaction } from "../../../src/reviewTypes";
import GlReactionBar from "./GlReactionBar.vue";

const meta = {
  title: "Review/Reaction bar",
  component: GlReactionBar,
  decorators: [
    () => ({ template: '<div class="storybook-frame editor-wide" style="min-height:0"><story /></div>' })
  ],
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof GlReactionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReactionsLoadOnDemand: Story = {
  render: () => ({
    components: { GlReactionBar },
    setup() {
      const reactions = ref<ReviewReaction[]>([]);
      const loaded = ref(false);
      const loading = ref(false);
      const loadCount = ref(0);

      function load(): void {
        loadCount.value += 1;
        loading.value = true;
      }

      function finishLoad(): void {
        reactions.value = [{ name: "thumbsup", count: 1, users: [] }];
        loaded.value = true;
        loading.value = false;
      }

      return { reactions, loaded, loading, loadCount, load, finishLoad };
    },
    template: `
      <div class="gl-comment">
        <GlReactionBar
          :reactions="reactions"
          :loaded="loaded"
          :loading="loading"
          @load="load"
        />
      </div>
      <p>Load requests: {{ loadCount }}</p>
      <button type="button" @click="finishLoad">Complete reaction load</button>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const addButton = canvas.getByRole("button", { name: "Add reaction" });

    await expect(addButton).toBeInTheDocument();
    await expect(canvas.getByText("Load requests: 0")).toBeVisible();
    await userEvent.tab();
    await expect(addButton).toBeVisible();
    await expect(addButton).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByText("Load requests: 1")).toBeVisible();
    await expect(canvas.getByText("Loading reactions…")).toBeVisible();
    await expect(addButton).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Rocket" })).toBeDisabled();

    await userEvent.click(canvas.getByRole("button", { name: "Complete reaction load" }));
    await expect(canvas.getByRole("button", { name: "Add thumbsup reaction, 1" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Rocket" })).not.toBeDisabled();
    await expect(canvas.getByText("Load requests: 1")).toBeVisible();
  }
};
