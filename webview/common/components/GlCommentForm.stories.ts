import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { computed, ref } from "vue";
import type { ReviewContext } from "../../../src/reviewContext";
import { installCommentImageHostMock } from "../../stories/commentImageHostMock";
import GlCommentForm from "./GlCommentForm.vue";

const meta = {
  title: "Review/Comment form",
  component: GlCommentForm,
  parameters: { layout: "centered" },
  decorators: [
    () => ({ template: '<div class="storybook-frame editor-compact" style="min-height:0;padding:24px"><story /></div>' })
  ]
} satisfies Meta<typeof GlCommentForm>;

export default meta;
type Story = StoryObj<typeof meta>;

function renderForm(args: Record<string, unknown>) {
  return {
    components: { GlCommentForm },
    setup() {
      const value = ref(String(args.modelValue ?? ""));
      const lineEnding = computed(() => value.value.includes("\r")
        ? (value.value.includes("\n") ? "crlf" : "cr")
        : (value.value.includes("\n") ? "lf" : "none"));
      return { args, value, lineEnding };
    },
    template: '<GlCommentForm v-model="value" v-bind="args" /><textarea data-testid="comment-value" :value="value" aria-hidden="true" tabindex="-1" readonly style="display:none" /><span data-testid="comment-line-ending" :data-line-ending="lineEnding" aria-hidden="true" style="display:none" />'
  };
}

function renderImageForm(args: Record<string, unknown>) {
  return {
    components: { GlCommentForm },
    setup() {
      const value = ref(String(args.modelValue ?? ""));
      const reviewContext = ref(storyReviewContext(`storybook-comment-form-${crypto.randomUUID()}`));
      return { args, reviewContext, value };
    },
    template: '<GlCommentForm v-model="value" v-bind="args" :review-context="reviewContext" />'
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

function renderContextSwitchImageForm(args: Record<string, unknown>) {
  return {
    components: { GlCommentForm },
    setup() {
      const value = ref(String(args.modelValue ?? ""));
      const projectId = `storybook-comment-form-${crypto.randomUUID()}`;
      const reviewContext = ref(storyReviewContext(projectId, "https://gitlab-a.example.com"));
      const switchContext = () => {
        reviewContext.value = storyReviewContext(projectId, "https://gitlab-b.example.com");
      };
      return { args, reviewContext, switchContext, value };
    },
    template: '<div><GlCommentForm v-model="value" v-bind="args" :review-context="reviewContext" /><button type="button" @click="switchContext">Switch review context</button></div>'
  };
}

function pngFile(name = "review-image.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "image/png" });
}

export const CompactIdle: Story = {
  args: {
    modelValue: "",
    compact: true,
    ariaLabel: "Review comment",
    placeholder: "Reply…",
    submitLabel: "Reply"
  },
  render: renderForm,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("textbox", { name: "Review comment" });
    await userEvent.click(editor);
    await userEvent.type(editor, "Looks good");
    await expect(editor).toHaveTextContent("Looks good");
  }
};

export const MultilineEntry: Story = {
  args: {
    modelValue: "",
    ariaLabel: "Multiline review comment",
    submitLabel: "Comment"
  },
  render: renderForm,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("textbox", { name: "Multiline review comment" });
    const value = canvas.getByTestId("comment-value");
    const lineEnding = canvas.getByTestId("comment-line-ending");
    await userEvent.click(editor);
    await userEvent.type(editor, "first line");
    await userEvent.keyboard("{Enter}");
    await userEvent.type(editor, "second line");
    await expect(lineEnding).toHaveAttribute("data-line-ending", "lf");
    await expect(value).toHaveValue("first line\nsecond line");
  }
};

export const MarkdownContent: Story = {
  args: {
    modelValue: "**Review note**\n\n> Please keep this behavior.\n\n- keyboard accessible\n- compact in the sidebar",
    ariaLabel: "Review comment",
    submitLabel: "Comment"
  },
  render: renderForm
};

export const LongComment: Story = {
  args: {
    modelValue: Array.from({ length: 8 }, (_, index) => `Line ${index + 1}: verify the rendered comment remains visible as the editor grows.`).join("\n"),
    ariaLabel: "Review comment",
    submitLabel: "Comment"
  },
  render: renderForm
};

export const PasteWithoutFormatting: Story = {
  args: {
    modelValue: "",
    ariaLabel: "Plain text paste comment",
    submitLabel: "Comment"
  },
  render: renderForm,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("textbox", { name: "Plain text paste comment" });
    await userEvent.click(editor);

    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "Bold review text");
    clipboard.setData("text/html", "<strong>Bold review text</strong>");
    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true
    }));
    editor.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: clipboard,
      bubbles: true,
      cancelable: true
    }));

    await expect(editor).toHaveTextContent("Bold review text");
    await expect(editor.querySelector("strong")).toBeNull();
  }
};

export const PickerUploadSuccessAndRemove: Story = {
  args: {
    modelValue: "Attach evidence:",
    ariaLabel: "Comment with image",
    submitLabel: "Comment"
  },
  render: renderImageForm,
  beforeEach: () => installCommentImageHostMock({ upload: () => ({ ok: true }) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const picker = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    await expect(picker).not.toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Upload image" }));
    await userEvent.upload(picker!, pngFile());

    await expect(await canvas.findByText("Attached: review-image.png")).toBeVisible();
    const editor = canvas.getByRole("textbox", { name: "Comment with image" });
    await waitFor(() => expect(editor.querySelector('img[data-comment-image-path="/uploads/story/upload.png"]')).not.toBeNull());
    await expect(canvas.getByRole("button", { name: "Comment" })).toBeEnabled();

    await userEvent.click(canvas.getByRole("button", { name: "Remove image" }));
    await expect(canvas.queryByText("Attached: review-image.png")).toBeNull();
    await expect(editor.querySelector('img[data-comment-image-path="/uploads/story/upload.png"]')).toBeNull();
  }
};

export const UploadFailureRetryAndRemove: Story = {
  args: {
    modelValue: "Retry this attachment:",
    ariaLabel: "Comment with failed image",
    submitLabel: "Comment"
  },
  render: renderImageForm,
  beforeEach: () => installCommentImageHostMock({
    upload: (_message, attempt) => attempt === 1
      ? { ok: false, message: "Storybook upload failed." }
      : { ok: true, imagePath: "/uploads/story/retried.png" }
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const picker = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    await userEvent.click(canvas.getByRole("button", { name: "Upload image" }));
    await userEvent.upload(picker!, pngFile("retry-image.png"));

    await expect(await canvas.findByText("Storybook upload failed.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Comment" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    await expect(await canvas.findByText("Attached: retry-image.png")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Comment" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Remove image" }));
    await expect(canvas.queryByText("Attached: retry-image.png")).toBeNull();
    await expect(canvas.getByRole("textbox", { name: "Comment with failed image" }).querySelector('img[data-comment-image-path="/uploads/story/retried.png"]')).toBeNull();
  }
};

export const PickerSelectionRejectsChangedContext: Story = {
  args: {
    modelValue: "Keep this draft on its original review:",
    ariaLabel: "Context-bound image comment",
    submitLabel: "Comment"
  },
  render: renderContextSwitchImageForm,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const picker = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    let uploadRequests = 0;
    const observeUpload = (event: Event) => {
      const message = (event as CustomEvent<{ type?: string }>).detail;
      if (message?.type === "uploadCommentImage") uploadRequests += 1;
    };
    window.addEventListener("storybook-vscode-message", observeUpload);
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Upload image" }));
      await userEvent.click(canvas.getByRole("button", { name: "Switch review context" }));
      await userEvent.upload(picker!, pngFile("old-context.png"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await expect(uploadRequests).toBe(0);
      await expect(canvas.queryByText("Attached: old-context.png")).toBeNull();
    } finally {
      window.removeEventListener("storybook-vscode-message", observeUpload);
    }
  }
};
