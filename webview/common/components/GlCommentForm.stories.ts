import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ref } from "vue";
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
      return { args, value };
    },
    template: '<GlCommentForm v-model="value" v-bind="args" />'
  };
}

function renderImageForm(args: Record<string, unknown>) {
  return {
    components: { GlCommentForm },
    setup() {
      const value = ref(String(args.modelValue ?? ""));
      const projectId = `storybook-comment-form-${crypto.randomUUID()}`;
      return { args, projectId, value };
    },
    template: '<GlCommentForm v-model="value" v-bind="args" :project-id="projectId" />'
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
