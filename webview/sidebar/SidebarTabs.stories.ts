import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import SidebarTabs from "./SidebarTabs.vue";

const select = fn();
const meta = {
  title: "Sidebar/Navigation tabs",
  component: SidebarTabs,
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-typical" style="min-height:0"><story /></div>' })
  ],
  parameters: { layout: "centered" }
} satisfies Meta<typeof SidebarTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewSelected: Story = {
  args: { activeTab: "review", attentionCount: 3 },
  render: (args) => ({
    components: { SidebarTabs },
    setup: () => ({ args, select }),
    template: '<SidebarTabs v-bind="args" @select="select" />'
  }),
  play: async ({ canvasElement }) => {
    select.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: /My work/ }));
    await expect(select).toHaveBeenCalledWith("my-work");
  }
};

export const MyWorkSelected: Story = {
  args: { activeTab: "my-work", attentionCount: 3 }
};

export const NoAttention: Story = {
  args: { activeTab: "my-work", attentionCount: 0 }
};
