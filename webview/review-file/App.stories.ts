import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, within } from "storybook/test";
import { onMounted } from "vue";
import type { ReviewFileViewState } from "../../src/webviewProtocol";
import App from "./App.vue";

const thread = {
  id: "discussion-1",
  filePath: "src/review.ts",
  line: 10,
  newLine: 10,
  resolved: false,
  resolvable: true,
  comments: [
    {
      id: "comment-1",
      author: "Reviewer One",
      authorId: "reviewer-1",
      body: "Could we make this branch easier to follow?",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "comment-2",
      author: "Reviewer Two",
      authorId: "reviewer-2",
      body: "I agree with this suggestion.",
      createdAt: "2026-01-01T00:01:00.000Z"
    }
  ]
};

const state: ReviewFileViewState = {
  mode: "review",
  canEditLocally: false,
  projectId: "101",
  filePath: "src/review.ts",
  threadScope: "101!42:src/review.ts",
  viewModel: {
    file: {
      path: "src/review.ts",
      language: "typescript",
      oldText: "const answer = 41;\n",
      mrText: "const answer = 42;\n",
      oldPath: "src/review.ts",
      newPath: "src/review.ts"
    },
    summary: {
      path: "src/review.ts",
      language: "typescript",
      additions: 1,
      deletions: 1,
      threadCount: 1,
      unresolvedThreadCount: 1,
      resolvedThreadCount: 0,
      hasLocalEdit: false
    },
    threads: [thread],
    lines: [
      {
        id: "line-1",
        kind: "mr-added",
        text: "const answer = 42;",
        mrLine: 10,
        localLine: 10,
        threads: [thread]
      }
    ],
    editableText: "const answer = 42;\n",
    hasLocalEdit: false
  }
};

const noReplyThread = { ...thread, comments: [thread.comments[0]!] };
const noReplyState: ReviewFileViewState = {
  ...state,
  viewModel: {
    ...state.viewModel!,
    threads: [noReplyThread],
    lines: state.viewModel!.lines.map((line) => ({ ...line, threads: [noReplyThread] }))
  }
};

const sideBySideState: ReviewFileViewState = {
  ...state,
  viewModel: {
    ...state.viewModel!,
    lines: [
      {
        id: "line-removed",
        kind: "mr-removed",
        text: "const answer = 41;",
        oldLine: 10,
        threads: []
      },
      state.viewModel!.lines[0]!
    ]
  }
};

const editState: ReviewFileViewState = {
  ...state,
  mode: "edit",
  canEditLocally: true
};

function renderState(nextState: ReviewFileViewState) {
  return {
    components: { ReviewFileApp: App },
    setup() {
      onMounted(() => {
        window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state: nextState } }));
      });
      return { state: nextState };
    },
    template: "<ReviewFileApp />"
  };
}

const meta = {
  title: "Review/Review file",
  component: App,
  decorators: [
    () => ({ template: '<div class="storybook-frame editor-wide" style="min-height:0"><story /></div>' })
  ],
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultipleReplyAuthors: Story = {
  render: () => renderState(state),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTitle("Reviewer One")).toBeVisible();
    await expect(canvas.getByTitle("Reviewer Two")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Collapse discussion on line 10/ }));
    await expect(canvas.getByTitle("Reviewer One")).toBeVisible();
    await expect(canvas.getByTitle("Reviewer Two")).toBeVisible();
  }
};

export const NoReplies: Story = {
  render: () => renderState(noReplyState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("0 replies")).toBeNull();
  }
};

export const SideBySideDiff: Story = {
  render: () => renderState(sideBySideState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("変更前")).toBeVisible();
    await expect(canvas.getByText("Merge request")).toBeVisible();
    await expect(canvas.getByText("const answer = 41;")).toBeVisible();
    await expect(canvas.getByText("const answer = 42;")).toBeVisible();
  }
};

export const EditModeShowsAllReplyBodies: Story = {
  render: () => renderState(editState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Could we make this branch easier to follow?")).toBeVisible();
    await expect(canvas.getByText("I agree with this suggestion.")).toBeVisible();
  }
};
