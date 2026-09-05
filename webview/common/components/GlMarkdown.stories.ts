import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { ReviewContext } from "../../../src/reviewContext";
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
      const reviewContext = storyReviewContext(`storybook-markdown-${crypto.randomUUID()}`);
      return { args, reviewContext };
    },
    template: '<GlMarkdown v-bind="args" :review-context="reviewContext" />'
  };
}

function storyReviewContext(projectId: string, instanceUrl = "https://gitlab.example.com"): ReviewContext {
  return {
    instanceUrl,
    projectId,
    mergeRequestIid: 17,
    baseSha: "base",
    startSha: "start",
    headSha: "head",
    currentUserId: "7"
  };
}

const resolvedInstances: string[] = [];

function renderCrossInstanceMarkdown(args: Record<string, unknown>) {
  return {
    components: { GlMarkdown },
    setup() {
      const projectId = `storybook-markdown-${crypto.randomUUID()}`;
      const contextA = storyReviewContext(projectId, "https://gitlab.example.com/instance-a");
      const contextB = storyReviewContext(projectId, "https://gitlab.example.com/instance-b");
      return { args, contextA, contextB };
    },
    template: '<div><GlMarkdown v-bind="args" :review-context="contextA" /><GlMarkdown v-bind="args" :review-context="contextB" /></div>'
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

export const PlainTextCopy: Story = {
  args: { source: "**Styled** text and `code`.\n\nSecond paragraph." },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>(".gl-markdown");
    if (!root) throw new Error("Markdown container was not rendered.");
    const selection = window.getSelection();
    if (!selection) throw new Error("Selection API is unavailable.");
    const range = document.createRange();
    range.selectNodeContents(root);
    selection.removeAllRanges();
    selection.addRange(range);

    const clipboard = new DataTransfer();
    const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: clipboard });
    root.dispatchEvent(copy);

    await expect(copy.defaultPrevented).toBe(true);
    await expect(clipboard.getData("text/plain")).toContain("Styled text and code.");
    await expect(clipboard.getData("text/html")).toBe("");
    selection.removeAllRanges();
  }
};

export const FencedCodeBlock: Story = {
  args: {
    source: "GetBumonCodeNameを、汎化したメソッドが組めるはずです。\n\n```csharp\nTValue GetCodeName<TValue>(Dictionary<int, TValue> dic, int id)\n{\n    return dic[id];\n}\n```\n\nコードブロックの中身はMarkdownとして解釈されません。"
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const code = canvas.getByText(/TValue GetCodeName/);
    await expect(code).toBeVisible();
    await expect(code).toHaveClass("language-csharp");
    await expect(canvas.queryByText("```csharp", { exact: true })).toBeNull();
  }
};

export const PrivateImageResolveAndLightbox: Story = {
  args: { source: "![Private review image](/uploads/story/private.png)" },
  render: renderPrivateMarkdown,
  beforeEach: () => installCommentImageHostMock({ resolve: () => ({ ok: true }) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const image = await canvas.findByRole("button", { name: "View Private review image at full size" });
    await expect(image).toHaveAttribute("src");
    await userEvent.click(image);
    await expect(await within(document.body).findByRole("dialog", { name: "View Private review image at full size" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: "View Private review image at full size" })).toBeNull());
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
    await expect(await canvas.findByRole("button", { name: "View Unavailable image at full size" })).toHaveAttribute("src");
  }
};

export const ResolutionCacheIsScopedByInstanceContext: Story = {
  args: { source: "![Scoped private image](/uploads/story/same-path.png)" },
  render: renderCrossInstanceMarkdown,
  beforeEach: () => {
    resolvedInstances.length = 0;
    return installCommentImageHostMock({
      resolve: (message) => {
        resolvedInstances.push(message.reviewContext.instanceUrl);
        return {
          ok: true,
          displayUri: message.reviewContext.instanceUrl.endsWith("instance-a")
            ? "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
            : "data:image/gif;base64,R0lGODlhAQABAIAAAAD/AP///ywAAAAAAQABAAACAUwAOw=="
        };
      }
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(resolvedInstances).toHaveLength(2));
    await expect([...resolvedInstances].sort()).toEqual([
      "https://gitlab.example.com/instance-a",
      "https://gitlab.example.com/instance-b"
    ]);
    const images = await canvas.findAllByRole("button", { name: "View Scoped private image at full size" });
    await expect(images).toHaveLength(2);
    await expect(images[0].getAttribute("src")).not.toBe(images[1].getAttribute("src"));
  }
};
