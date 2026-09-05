import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
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
      createdAt: "2026-01-01T00:00:00.000Z",
      reactionsLoaded: true,
      reactions: [
        {
          name: "thumbsup",
          count: 2,
          currentUserAwardId: "award-1",
          users: [{ id: "me", name: "You" }, { id: "reviewer-1", name: "Reviewer One" }]
        },
        { name: "party_parrot", count: 1, users: [{ id: "reviewer-2", name: "Reviewer Two" }] }
      ]
    },
    {
      id: "comment-2",
      author: "Reviewer Two",
      authorId: "reviewer-2",
      body: "I agree with this suggestion.",
      createdAt: "2026-01-01T00:01:00.000Z",
      reactionsLoaded: true,
      reactions: []
    }
  ]
};

const reviewContext = {
  instanceUrl: "https://gitlab.example.com",
  projectId: "101",
  mergeRequestIid: 42,
  baseSha: "0000000000000000000000000000000000000000",
  startSha: "1111111111111111111111111111111111111111",
  headSha: "2222222222222222222222222222222222222222"
} as const;

const state: ReviewFileViewState = {
  reviewContext,
  liveReviewContext: reviewContext,
  stale: false,
  canComment: true,
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

const historicalCommitState: ReviewFileViewState = {
  ...sideBySideState,
  source: "commit",
  stale: false,
  canComment: false,
  commentUnavailableReason: "Historical commit diffs are read-only. Open the current MR diff to comment.",
  commit: {
    id: "3333333333333333333333333333333333333333",
    shortId: "33333333",
    title: "Historical implementation",
    authorName: "Reviewer One",
    authoredAt: "2025-12-01T00:00:00.000Z",
    committedAt: "2025-12-01T00:00:00.000Z"
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

const editableCommentState: ReviewFileViewState = {
  ...state,
  mode: "review",
  canEditLocally: false,
  viewModel: {
    ...editState.viewModel!,
    threads: [{
      ...thread,
      comments: [{ ...thread.comments[0]!, canEdit: true }, ...thread.comments.slice(1)]
    }]
  }
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

const emptyDiffState: ReviewFileViewState = {
  ...state,
  viewModel: {
    ...state.viewModel!,
    lines: [],
    threads: [],
    fullFileState: "loaded",
    lineWindow: { start: 0, end: 0, total: 0, hasPrevious: false, hasNext: false }
  }
};

const fullFileLoadingState: ReviewFileViewState = {
  ...state,
  viewModel: {
    ...state.viewModel!,
    fullFileState: "loading",
    fullFileMessage: "Loading the full file…"
  }
};

const fullFileErrorState: ReviewFileViewState = {
  ...state,
  viewModel: {
    ...state.viewModel!,
    fullFileState: "error",
    fullFileMessage: "The full file could not be loaded. The changed-lines patch remains available."
  }
};

const unavailableState: ReviewFileViewState = { ...state, viewModel: undefined };

const tooLargeState: ReviewFileViewState = {
  ...emptyDiffState,
  viewModel: {
    ...emptyDiffState.viewModel!,
    file: { ...emptyDiffState.viewModel!.file, tooLarge: true },
    fullFileState: "too-large",
    fullFileMessage: "GitLab omitted this patch because the file is too large."
  }
};

const compactPath = "packages/review-workspace/src/generated/integrations/gitlab/discussions/ReviewDiscussionNavigationController.ts";
const compactPendingThread = {
  ...thread,
  filePath: compactPath,
  pending: true,
  comments: [{
    ...thread.comments[0]!,
    id: "comment-pending-1",
    body: "Keep this pending review note attached to the selected line even when the editor is compact and the file path is unusually long.",
    pending: true
  }]
};
const compactPendingDiscussionState: ReviewFileViewState = {
  ...sideBySideState,
  filePath: compactPath,
  targetThreadId: compactPendingThread.id,
  submissionMode: "review",
  viewModel: {
    ...sideBySideState.viewModel!,
    file: {
      ...sideBySideState.viewModel!.file,
      path: compactPath,
      oldPath: compactPath,
      newPath: compactPath
    },
    summary: {
      ...sideBySideState.viewModel!.summary,
      path: compactPath
    },
    threads: [compactPendingThread],
    lines: sideBySideState.viewModel!.lines.map((line) => ({
      ...line,
      threadIds: line.kind === "mr-added" ? [compactPendingThread.id] : []
    }))
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

export const ReadyOpenDiscussion: Story = {
  render: () => renderState(state),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Collapse discussion on line 10" })).toBeVisible();
    await expect(canvas.getByText("Could we make this branch easier to follow?")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Resolve discussion" })).toBeVisible();
    await expect(canvasElement.querySelector('[data-syntax-language="typescript"] [data-token-kind="keyword"]')).toHaveTextContent("const");
    await expect(canvas.getByText(":party_parrot:")).toBeVisible();
    const storyWindow = canvasElement.ownerDocument.defaultView as Window & { __storybookVsCodeMessages?: unknown[] };
    const messages = storyWindow.__storybookVsCodeMessages ?? [];
    const messageCount = messages.length;
    await userEvent.click(canvas.getByRole("button", { name: "Remove thumbsup reaction, 2" }));
    await expect(messages.slice(messageCount)).toContainEqual({
      type: "toggleCommentReaction",
      threadId: "discussion-1",
      commentId: "comment-1",
      name: "thumbsup",
      requestId: expect.any(String),
      reviewContext
    });
    const addButtons = canvas.getAllByRole("button", { name: "Add reaction" });
    const addMessageCount = messages.length;
    await userEvent.click(addButtons[0]!);
    await userEvent.click(canvas.getByRole("button", { name: "Rocket" }));
    await expect(messages.slice(addMessageCount)).toContainEqual({
      type: "toggleCommentReaction",
      threadId: "discussion-1",
      commentId: "comment-1",
      name: "rocket",
      requestId: expect.any(String),
      reviewContext
    });
  }
};

export const CompactPendingDiscussion: Story = {
  render: () => renderState(compactPendingDiscussionState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Sending…")).toBeVisible();
    await expect(canvas.getByTitle(compactPath)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Updating discussion status" })).toBeDisabled();
  }
};

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
    await expect(codeLine(canvasElement, "const answer = 41;")).toBeVisible();
    await expect(codeLine(canvasElement, "const answer = 42;")).toBeVisible();
  }
};

export const RangeCommentMutationLifecycle: Story = {
  render: () => renderState(state),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyWindow = canvasElement.ownerDocument.defaultView as Window & { __storybookVsCodeMessages?: unknown[] };
    const messages = storyWindow.__storybookVsCodeMessages ?? [];
    const row = canvas.getByRole("button", { name: "Merge request addition, line 10" });
    row.focus();
    await userEvent.keyboard("{Enter}");
    const editor = await canvas.findByRole("textbox", { name: "New comment" });
    const form = editor.closest("form");
    if (!form) throw new Error("Range composer form was not rendered");
    const submit = within(form).getByRole("button", { name: "Comment" });
    await userEvent.type(editor, "Keep the original range draft.");

    const beforeSubmit = messages.length;
    await userEvent.click(submit);
    const request = await waitFor(() => {
      const candidate = findMutationRequest(messages, "addThread", beforeSubmit);
      if (!candidate) throw new Error("Range comment request was not emitted");
      return candidate;
    });
    await expect(canvas.getByRole("status")).toHaveTextContent("Sending…");
    await expect(submit).toBeDisabled();

    const pendingMessageCount = messages.length;
    await userEvent.click(submit);
    await expect(messages.slice(pendingMessageCount)).toHaveLength(0);

    await userEvent.clear(editor);
    await userEvent.type(editor, "Keep the newer range draft.");
    sendMutationResult(storyWindow, request.requestId, { ok: false, errorMessage: "GitLab rejected this discussion." });
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("GitLab rejected this discussion."));
    await expect(editor).toHaveTextContent("Keep the newer range draft.");

    const beforeRetry = messages.length;
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    const retry = await waitFor(() => {
      const candidate = findMutationRequest(messages, "addThread", beforeRetry);
      if (!candidate) throw new Error("Range comment retry was not emitted");
      return candidate;
    });
    await expect(retry.body).toBe("Keep the newer range draft.");
    sendMutationResult(storyWindow, retry.requestId, { ok: true });
    await waitFor(() => expect(canvas.queryByRole("textbox", { name: "New comment" })).toBeNull());
  }
};

export const HistoricalCommitIsReadOnly: Story = {
  render: () => renderState(historicalCommitState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Historical commit diffs are read-only. Open the current MR diff to comment.")).toBeVisible();
    const messages = (canvasElement.ownerDocument.defaultView as Window & { __storybookVsCodeMessages?: unknown[] }).__storybookVsCodeMessages ?? [];
    const before = messages.length;
    await userEvent.click(canvas.getByRole("button", { name: "Open current MR diff" }));
    await expect(messages.slice(before)).toContainEqual({
      type: "openCurrentReviewFile",
      filePath: "src/review.ts",
      requestId: expect.any(String),
      reviewContext
    });
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

export const ReplyAndEditMutationLifecycle: Story = {
  render: () => renderState(editableCommentState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyWindow = canvasElement.ownerDocument.defaultView as Window & { __storybookVsCodeMessages?: unknown[] };
    const messages = storyWindow.__storybookVsCodeMessages ?? [];

    const collapsedDiscussion = canvas.queryByRole("button", { name: "Expand discussion on line 10" });
    if (collapsedDiscussion) await userEvent.click(collapsedDiscussion);
    const replyEditor = await canvas.findByRole("textbox", { name: "Reply to discussion" });
    const replyForm = replyEditor.closest("form");
    if (!replyForm) throw new Error("Reply composer form was not rendered");
    await userEvent.type(replyEditor, "Keep this reply after failure.");
    const beforeReply = messages.length;
    await userEvent.click(within(replyForm).getByRole("button", { name: "Comment" }));
    const replyRequest = await waitFor(() => {
      const candidate = findMutationRequest(messages, "addComment", beforeReply);
      if (!candidate) throw new Error("Reply request was not emitted");
      return candidate;
    });
    sendMutationResult(storyWindow, replyRequest.requestId, { ok: false, errorMessage: "GitLab rejected this reply." });
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("GitLab rejected this reply."));
    await expect(replyEditor).toHaveTextContent("Keep this reply after failure.");

    const beforeReplyRetry = messages.length;
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    const replyRetry = await waitFor(() => {
      const candidate = findMutationRequest(messages, "addComment", beforeReplyRetry);
      if (!candidate) throw new Error("Reply retry was not emitted");
      return candidate;
    });
    sendMutationResult(storyWindow, replyRetry.requestId, { ok: true });
    await waitFor(() => expect(replyEditor).not.toHaveTextContent("Keep this reply after failure."));

    await userEvent.click(canvas.getByRole("button", { name: "Edit comment" }));
    const editEditor = await canvas.findByRole("textbox", { name: "Edit comment" });
    await userEvent.clear(editEditor);
    await userEvent.type(editEditor, "Keep this edit after failure.");
    const editForm = editEditor.closest("form");
    if (!editForm) throw new Error("Comment edit form was not rendered");
    const beforeEdit = messages.length;
    await userEvent.click(within(editForm).getByRole("button", { name: "Save changes" }));
    const editRequest = await waitFor(() => {
      const candidate = findMutationRequest(messages, "editComment", beforeEdit);
      if (!candidate) throw new Error("Edit request was not emitted");
      return candidate;
    });
    sendMutationResult(storyWindow, editRequest.requestId, { ok: false, errorMessage: "GitLab rejected this edit." });
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("GitLab rejected this edit."));
    await expect(editEditor).toHaveTextContent("Keep this edit after failure.");
    await expect(editEditor).toBeVisible();

    const beforeEditRetry = messages.length;
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    const editRetry = await waitFor(() => {
      const candidate = findMutationRequest(messages, "editComment", beforeEditRetry);
      if (!candidate) throw new Error("Edit retry was not emitted");
      return candidate;
    });
    sendMutationResult(storyWindow, editRetry.requestId, { ok: true });
    await waitFor(() => expect(canvas.queryByRole("textbox", { name: "Edit comment" })).toBeNull());
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
    await expect(canvas.getAllByText("1–1200 / 50000")).toHaveLength(2);
    await expect(canvas.getAllByRole("button", { name: "Next lines" })).toHaveLength(2);
    await expect(canvas.getAllByRole("button", { name: "Previous lines" })).toHaveLength(2);
    await expect(canvas.getByText("Other lines are omitted from this window.")).toBeVisible();
  }
};

function codeLine(canvasElement: HTMLElement, text: string): Element | null {
  return Array.from(canvasElement.querySelectorAll("[data-syntax-language]"))
    .find((element) => element.textContent === text) ?? null;
}

function findMutationRequest(
  messages: readonly unknown[],
  type: string,
  start = 0
): { type: string; requestId: string; [key: string]: unknown } | undefined {
  return messages.slice(start).find((message): message is { type: string; requestId: string; [key: string]: unknown } => (
    typeof message === "object"
      && message !== null
      && (message as { type?: unknown }).type === type
      && typeof (message as { requestId?: unknown }).requestId === "string"
  ));
}

function sendMutationResult(
  storyWindow: Window,
  requestId: string,
  result: { ok: true } | { ok: false; errorMessage: string }
): void {
  const StoryMessageEvent = (storyWindow as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent;
  storyWindow.dispatchEvent(new StoryMessageEvent("message", {
    data: { type: "reviewMutationResult", requestId, ...result }
  }));
}

export const FullFileLoading: Story = {
  render: () => renderState(fullFileLoadingState),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Loading full file…")).toBeVisible();
  }
};

export const FullFileError: Story = {
  render: () => renderState(fullFileErrorState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("The full file could not be loaded. The changed-lines patch remains available.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Load full file" })).toBeVisible();
  }
};

export const FileUnavailable: Story = {
  render: () => renderState(unavailableState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("File unavailable")).toBeVisible();
    await expect(canvas.getByText("src/review.ts was not found in this merge request.")).toBeVisible();
  }
};

export const EmptyDiff: Story = {
  render: () => renderState(emptyDiffState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No displayable changes")).toBeVisible();
    await expect(canvas.getByText("GitLab returned no displayable patch for this file.")).toBeVisible();
  }
};

export const TooLargeOrUnsupported: Story = {
  render: () => renderState(tooLargeState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Diff too large to display")).toBeVisible();
    await expect(canvas.getAllByText("GitLab omitted this patch because the file is too large.")).toHaveLength(1);
  }
};

export const EditSavingPending: Story = {
  render: () => renderState(editState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("textbox", { name: "File contents" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "const answer = 44;");
    await userEvent.click(canvas.getByRole("button", { name: "Save local changes" }));
    await expect(editor).toHaveAttribute("readonly");
    await expect(canvas.getByText("Saving local draft…")).toBeVisible();
  }
};
