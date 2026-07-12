import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import GlThreadStatusAction from "./GlThreadStatusAction.vue";

const toggle = fn();
const meta = {
  title: "Review/Thread status action",
  component: GlThreadStatusAction,
  parameters: { layout: "centered" }
} satisfies Meta<typeof GlThreadStatusAction>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: { resolved: false },
  render: (args) => ({
    components: { GlThreadStatusAction },
    setup: () => ({ args, toggle }),
    template: '<GlThreadStatusAction v-bind="args" @toggle="toggle" />'
  }),
  play: async ({ canvasElement }) => {
    toggle.mockClear();
    const canvas = within(canvasElement);
    const action = canvas.getByRole("button", { name: "Resolve discussion" });
    await userEvent.click(action);
    await expect(toggle).toHaveBeenCalledOnce();
  }
};

export const Resolved: Story = { args: { resolved: true } };
export const Pending: Story = { args: { resolved: false, pending: true } };
export const NotResolvable: Story = { args: { resolved: false, resolvable: false } };
