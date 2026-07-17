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
      oldPath: "src/review.ts",
      newPath: "src/review.ts",
      status: "modified",
      newFile: false,
      deletedFile: false,
      renamedFile: false,
      collapsed: false,
      tooLarge: false,
      generatedFile: false
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
        threadIds: [thread.id]
      }
    ],
    editableText: "const answer = 42;\n",
    hasLocalEdit: false,
    contentMode: "full",
    fullFileState: "loaded",
    lineWindow: { start: 0, end: 1, total: 1, hasPrevious: false, hasNext: false }
  }
};

const noReplyThread = { ...thread, comments: [thread.comments[0]!] };
const noReplyState: ReviewFileViewState = {
  ...state,
  viewModel: {
    ...state.viewModel!,
    threads: [noReplyThread],
    lines: state.viewModel!.lines.map((line) => ({ ...line, threadIds: [noReplyThread.id] }))
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
        threadIds: []
      },
      state.viewModel!.lines[0]!
    ]
  }
};

const newChangesState: ReviewFileViewState = {
  ...sideBySideState,
  source: "new-changes",
  newChanges: {
    projectId: "101",
    mergeRequestIid: 42,
    fromSha: "1111111111111111111111111111111111111111",
    toSha: "2222222222222222222222222222222222222222",
    commitCount: 2,
    selected: "new",
    loading: false,
    fileChanged: true
  }
};

const noNewFileChangesState: ReviewFileViewState = {
  ...state,
  source: "review",
  newChanges: {
    projectId: "101",
    mergeRequestIid: 42,
    fromSha: "1111111111111111111111111111111111111111",
    toSha: "2222222222222222222222222222222222222222",
    commitCount: 2,
    selected: "new",
    loading: false,
    fileChanged: false
  }
};

const editState: ReviewFileViewState = {
  ...state,
  mode: "edit",
  canEditLocally: true
};

const ordinaryCommentEditState: ReviewFileViewState = {
  ...editState,
  viewModel: {
    ...editState.viewModel!,
    threads: [{
      ...thread,
      id: "comment-1",
      resolvable: false,
      comments: [{
        ...thread.comments[0]!,
        id: "note-1",
        body: "This is an ordinary file comment."
      }]
    }]
  }
};

const largeWindowState: ReviewFileViewState = {
  ...state,
  viewModel: {
    ...state.viewModel!,
    threads: [],
    lines: Array.from({ length: 1_200 }, (_, index) => ({
      id: `large-${index + 1}`,
      kind: index % 100 === 0 ? "mr-added" as const : "context" as const,
      text: `const generatedLine${index + 1} = ${index + 1};`,
      oldLine: index % 100 === 0 ? undefined : index + 1,
      mrLine: index + 1,
      localLine: index + 1,
      threadIds: []
    })),
    lineWindow: { start: 0, end: 1_200, total: 50_000, hasPrevious: false, hasNext: true }
  }
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
    await expect(canvas.getByText("Before")).toBeVisible();
    await expect(canvas.getByText("Merge request")).toBeVisible();
    await expect(canvas.getByText("const answer = 41;")).toBeVisible();
    await expect(canvas.getByText("const answer = 42;")).toBeVisible();
  }
};

export const NewChangesFromLatestPush: Story = {
  render: () => renderState(newChangesState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Merge request change range" })).toHaveValue("new");
    await expect(canvas.getAllByText("Latest push", { exact: true })).toHaveLength(2);
    await expect(canvas.getByText("New addition", { exact: true })).toBeVisible();
    await expect(canvas.getByText("New deletion", { exact: true })).toBeVisible();
  }
};

export const FileUnchangedInLatestPush: Story = {
  render: () => renderState(noNewFileChangesState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No new changes in this file")).toBeVisible();
    await expect(canvas.getByText("Switch to All changes to view the complete merge request diff.")).toBeVisible();
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

export const EditSaveFailureKeepsDraft: Story = {
  render: () => renderState(editState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("textbox", { name: "File contents" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "const answer = 43;");
    await userEvent.click(canvas.getByRole("button", { name: "Save local changes" }));
    await expect(editor).toHaveAttribute("readonly");

    const storyWindow = canvasElement.ownerDocument.defaultView as Window & { __storybookVsCodeMessages?: unknown[] };
    const messages = storyWindow.__storybookVsCodeMessages ?? [];
    const request = [...messages].reverse().find((message): message is { type: "saveLocalEdit"; requestId: string } => (
      Boolean(message) && typeof message === "object" && (message as { type?: string }).type === "saveLocalEdit"
    ));
    await expect(request).toBeDefined();
    const StoryMessageEvent = (storyWindow as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent;
    storyWindow.dispatchEvent(new StoryMessageEvent("message", {
      data: {
        type: "localEditSaveResult",
        requestId: request!.requestId,
        ok: false,
        errorMessage: "Workspace storage is unavailable."
      }
    }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent("Workspace storage is unavailable.");
    await expect(editor).toHaveValue("const answer = 43;");
    await expect(editor).not.toHaveAttribute("readonly");
  }
};

export const EditModeOrdinaryCommentHasNoReviewStatus: Story = {
  render: () => renderState(ordinaryCommentEditState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("This is an ordinary file comment.")).toBeVisible();
    await expect(canvas.queryByText("Open", { exact: true })).toBeNull();
  }
};

export const LargeFileWindow: Story = {
  render: () => renderState(largeWindowState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("1–1200 / 50000")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Next lines" })).toBeVisible();
  }
};
