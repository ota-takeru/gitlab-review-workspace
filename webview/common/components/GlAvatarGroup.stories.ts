import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, within } from "storybook/test";
import GlAvatarGroup from "./GlAvatarGroup.vue";

const meta = {
  title: "Review/Reply authors",
  component: GlAvatarGroup,
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-typical" style="min-height:0;padding:16px"><story /></div>' })
  ],
  parameters: { layout: "centered" }
} satisfies Meta<typeof GlAvatarGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultipleAuthors: Story = {
  args: {
    ariaLabel: "Reply authors",
    items: [
      { id: "reviewer-1", name: "Reviewer One" },
      { id: "reviewer-2", name: "Reviewer Two" }
    ]
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTitle("Reviewer One")).toBeVisible();
    await expect(canvas.getByTitle("Reviewer Two")).toBeVisible();
  }
};
