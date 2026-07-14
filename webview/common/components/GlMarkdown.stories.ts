import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { installCommentImageHostMock } from "../../stories/commentImageHostMock";
import GlMarkdown from "./GlMarkdown.vue";

const meta = {
  title: "Review/Markdown comment images",
  component: GlMarkdown,
  parameters: { layout: "centered" },
  decorators: [
    () => ({ template: '<div class="storybook-frame editor-compact" style="min-width:420px;padding:24px"><story /></div>' })
  ]
} satisfies Meta<typeof GlMarkdown>;

export default meta;
type Story = StoryObj<typeof meta>;

function renderPrivateMarkdown(args: Record<string, unknown>) {
  return {
    components: { GlMarkdown },
    setup() {
      const projectId = `storybook-markdown-${crypto.randomUUID()}`;
      return { args, projectId };
    },
    template: '<GlMarkdown v-bind="args" :project-id="projectId" />'
  };
}

export const EscapedPunctuation: Story = {
  args: { source: String.raw`\[メモ\] \*装飾しない\*` },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("[メモ] *装飾しない*", { exact: true })).toBeVisible();
    await expect(canvas.queryByText(String.raw`\[メモ\]`)).toBeNull();
  }
};

export const PrivateImageResolveAndLightbox: Story = {
  args: { source: "![Private review image](/uploads/story/private.png)" },
  render: renderPrivateMarkdown,
  beforeEach: () => installCommentImageHostMock({ resolve: () => ({ ok: true }) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const image = await canvas.findByRole("button", { name: "Private review imageを原寸表示" });
    await expect(image).toHaveAttribute("src");
    await userEvent.click(image);
    await expect(await within(document.body).findByRole("dialog", { name: "Private review imageの原寸表示" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: "Private review imageの原寸表示" })).toBeNull());
  }
};

export const ResolveFailureRetryAndGitLabFallback: Story = {
  args: { source: "![Unavailable image](/uploads/story/unavailable.png)" },
  render: renderPrivateMarkdown,
  beforeEach: () => installCommentImageHostMock({
    resolve: (_message, attempt) => attempt === 1
      ? { ok: false, message: "Storybook resolve failed.", fallbackUrl: "https://gitlab.example.com/group/project/uploads/story/unavailable.png" }
      : { ok: true }
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText(/Storybook resolve failed/)).toBeVisible());
    const fallback = canvas.getByRole("link", { name: "Open in GitLab" });
    await expect(fallback).toHaveAttribute("href", "https://gitlab.example.com/group/project/uploads/story/unavailable.png");
    await expect(fallback).toHaveAttribute("target", "_blank");
    await expect(fallback).toHaveAttribute("rel", "noopener noreferrer");

    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(await canvas.findByRole("button", { name: "Unavailable imageを原寸表示" })).toHaveAttribute("src");
  }
};
