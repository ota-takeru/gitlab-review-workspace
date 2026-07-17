import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { onMounted } from "vue";
import type { SidebarViewState } from "../../src/webviewProtocol";
import App from "./App.vue";

const state: SidebarViewState = {
  activeTab: "review",
  auth: { phase: "available", hostname: "gitlab.example.com" },
  branchTree: { phase: "hidden", entries: [] },
  commitDiff: { phase: "hidden", files: [] },
  threadDetails: [],
  localWorkspace: {
    phase: "ready",
    remoteMatch: "matched",
    currentBranch: "feature/review-thread",
    detached: false,
    dirty: { total: 0, modified: 0, untracked: 0 },
    worktrees: [],
    target: { kind: "current-workspace", branch: "feature/review-thread" }
  },
  myWork: {
    phase: "idle",
    buckets: { attention: [], active: [], waiting: [] },
    attentionCount: 0,
    failedSources: []
  },
  overview: {
    loadState: "ready",
    isRefreshing: false,
    selectedMergeRequest: {
      projectId: "101",
      iid: 42,
      title: "Add review threads from the sidebar",
      state: "opened",
      sourceBranch: "feature/review-thread",
      targetBranch: "main",
      author: "author"
    },
    threadSortOrder: "open-first",
    title: "Add review threads from the sidebar",
    sourceBranch: "feature/review-thread",
    targetBranch: "main",
    author: "author",
    reviewers: [],
    commits: [],
    files: [],
    threads: [],
    draftNotes: [],
    totalComments: 0,
    unresolvedThreads: 0,
    resolvedThreads: 0,
    additions: 0,
    deletions: 0
  }
};

const threadState: SidebarViewState = {
  ...state,
  threadDetails: [{
    id: "discussion-1",
    filePath: "src/review.ts",
    line: 42,
    newLine: 42,
    resolved: false,
    resolvable: true,
    comments: [{
      id: "comment-1",
      author: "reviewer",
      body: "Could we simplify this branch?",
      createdAt: "2026-07-13T10:00:00.000Z"
    }]
  }],
  overview: {
    ...state.overview,
    files: [{
      path: "src/review.ts",
      language: "typescript",
      additions: 4,
      deletions: 1,
      threadCount: 1,
      unresolvedThreadCount: 1,
      resolvedThreadCount: 0,
      hasLocalEdit: false
    }],
    threads: [{
      id: "discussion-1",
      filePath: "src/review.ts",
      line: 42,
      newLine: 42,
      resolved: false,
      resolvable: true,
      commentCount: 1,
      authors: [{ name: "reviewer" }],
      lastComment: { author: "reviewer", createdAt: "2026-07-13T10:00:00.000Z" },
      searchText: "src/review.ts\nreviewer\nCould we simplify this branch?"
    }],
    totalComments: 1,
    unresolvedThreads: 1,
    additions: 4,
    deletions: 1
  }
};

const ordinaryCommentState: SidebarViewState = {
  ...state,
  threadDetails: [{
    id: "comment-1",
    resolved: false,
    resolvable: false,
    comments: [{
      id: "note-1",
      author: "reviewer",
      body: "This is an ordinary merge request comment.",
      createdAt: "2026-07-13T10:00:00.000Z"
    }]
  }],
  overview: {
    ...state.overview,
    threads: [{
      id: "comment-1",
      resolved: false,
      resolvable: false,
      commentCount: 1,
      authors: [{ name: "reviewer" }],
      lastComment: { author: "reviewer", createdAt: "2026-07-13T10:00:00.000Z" },
      searchText: "reviewer\nThis is an ordinary merge request comment."
    }],
    totalComments: 1
  }
};

const manyFilesState: SidebarViewState = {
  ...state,
  overview: {
    ...state.overview,
    files: Array.from({ length: 500 }, (_, index) => ({
      path: `src/generated/module-${String(index + 1).padStart(3, "0")}.ts`,
      language: "typescript",
      additions: 1,
      deletions: 0,
      threadCount: 0,
      unresolvedThreadCount: 0,
      resolvedThreadCount: 0,
      hasLocalEdit: false
    })),
    additions: 500
  }
};

const pendingReviewState: SidebarViewState = {
  ...state,
  overview: {
    ...state.overview,
    draftNotes: [
      { id: "draft-1", body: "Please keep the public API backwards compatible." },
      { id: "draft-2", body: "Could we add coverage for this branch?", filePath: "src/review.ts", line: 42 }
    ]
  }
};

const progressState: SidebarViewState = {
  ...threadState,
  overview: {
    ...threadState.overview,
    files: [
      ...(threadState.overview.files ?? []).map((file) => ({
        ...file,
        viewed: true,
        newSinceLastReview: true
      })),
      {
        path: "src/untouched.ts",
        language: "typescript",
        additions: 0,
        deletions: 0,
        threadCount: 0,
        unresolvedThreadCount: 0,
        resolvedThreadCount: 0,
        hasLocalEdit: false,
        viewed: false
      }
    ],
    progress: {
      totalFiles: 2,
      viewedFiles: 1,
      unviewedFiles: 1,
      totalDiscussions: 1,
      resolvedDiscussions: 0,
      unresolvedDiscussions: 1,
      completionPercent: 25,
      completionState: "in-progress",
      nextUnresolvedThread: { id: "discussion-1", filePath: "src/review.ts", line: 42 },
      newSinceLastReview: true,
      newCommitCount: 2
    },
    newChanges: {
      projectId: "101",
      mergeRequestIid: 42,
      fromSha: "head-1",
      toSha: "head-2",
      commitCount: 2,
      changedPaths: ["src/review.ts"]
    }
  }
};

function renderState(nextState: SidebarViewState) {
  return {
    components: { SidebarApp: App },
    setup() {
      onMounted(() => {
        window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state: nextState } }));
      });
    },
    template: "<SidebarApp />"
  };
}

const meta = {
  title: "Review/Sidebar",
  component: App,
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-narrow" style="min-height:0"><story /></div>' })
  ],
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AddReviewThread: Story = {
  render: () => renderState(state),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("textbox", { name: "Add review thread" });
    await expect(editor).toBeVisible();
    const commentMode = canvas.getByRole("button", { name: "Post as comment" });
    const reviewMode = canvas.getByRole("button", { name: "Post as review" });
    await expect(commentMode).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(editor);
    await userEvent.type(editor, "Keep this text.");
    await expect(canvas.getByRole("button", { name: "Comment" })).toBeEnabled();
    await userEvent.click(reviewMode);
    await expect(reviewMode).toHaveAttribute("aria-pressed", "true");
    await expect(editor).toHaveTextContent("Keep this text.");
    await expect(canvas.getByRole("button", { name: "Add to review" })).toBeEnabled();
    await userEvent.click(commentMode);
    await expect(commentMode).toHaveAttribute("aria-pressed", "true");
    await expect(editor).toHaveTextContent("Keep this text.");
    const messages = (window as Window & { __storybookVsCodeMessages?: unknown[] }).__storybookVsCodeMessages ?? [];
    const messageCount = messages.length;
    await userEvent.click(canvas.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(messages.slice(messageCount)).toContainEqual({
      type: "addOverviewThread",
      body: "Keep this text.",
      mode: "comment"
    }));
  }
};

export const PendingReview: Story = {
  render: () => renderState(pendingReviewState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pendingReview = canvas.getByRole("region", { name: "Pending review" });
    const pending = within(pendingReview);
    await expect(pendingReview).toBeVisible();
    const tray = canvas.getByRole("region", { name: "Review submission" });
    const submission = within(tray);
    await expect(submission.getByRole("button", { name: "Submit review" })).toBeEnabled();
    await expect(pending.getAllByRole("button", { name: "Post as comment" })).toHaveLength(2);
    await expect(pending.getByText("src/review.ts:42")).toBeVisible();
  }
};

export const ReviewProgress: Story = {
  render: () => renderState(progressState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const progress = canvas.getByRole("region", { name: "Review progress" });
    const progressRegion = within(progress);
    await expect(progress).toBeVisible();
    await expect(progressRegion.getByText("New since last review")).toBeVisible();
    await expect(progressRegion.getByText("1/2")).toBeVisible();
    await expect(progressRegion.getByRole("button", { name: "Next unresolved" })).toBeEnabled();
    await expect(progressRegion.getByRole("progressbar", { name: "Review completion" })).toHaveAttribute("aria-valuenow", "25");
    await userEvent.click(canvas.getByRole("button", { name: /Changed files/ }));
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Filter changed files by status" }), "new");
    await expect(canvas.getByText("1 file")).toBeVisible();
    await expect(canvas.getByText("NEW")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Changed files/ }));
  }
};

export const DistinctStatusAndActions: Story = {
  render: () => renderState(threadState),
  play: async ({ canvasElement }) => {
    const thread = canvasElement.querySelector<HTMLElement>(".thread");
    await expect(thread).not.toBeNull();
    await expect(thread!.querySelector(".thread-header .gl-avatar-group")).toBeNull();
    await expect(thread!.querySelectorAll(".thread-content .gl-avatar")).toHaveLength(1);
    const canvas = within(thread!);
    await expect(canvas.getByText("Open", { exact: true })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Go to diff for src/review.ts at line 42" })).toBeVisible();
    const status = canvas.getByRole("button", { name: "Resolve discussion" });
    await userEvent.hover(status);
    await expect(canvas.getByText("Resolve", { exact: true })).toBeVisible();
    await userEvent.unhover(status);
    await expect(canvas.getByText("Open", { exact: true })).toBeVisible();
  }
};

export const OrdinaryCommentHasNoReviewStatus: Story = {
  render: () => renderState(ordinaryCommentState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("This is an ordinary merge request comment.")).toBeVisible();
    await expect(canvas.queryByText("Open", { exact: true })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Resolve discussion" })).toBeNull();
  }
};

export const SearchReviewComments: Story = {
  render: () => renderState({ ...threadState, threadDetails: [] }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("searchbox", { name: "Search review comments, authors, and files" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Search review comments and files" }));
    const search = canvas.getByRole("searchbox", { name: "Search review comments, authors, and files" });
    await expect(canvasElement.ownerDocument.activeElement).toBe(search);
    await userEvent.type(search, "simplify");
    await expect(canvas.getByText("1 of 1 threads")).toBeVisible();
    await expect(canvasElement.querySelectorAll(".thread")).toHaveLength(1);
    await userEvent.clear(search);
    await userEvent.type(search, "reviewer");
    await expect(canvas.getByText("1 of 1 threads")).toBeVisible();
    await expect(canvasElement.querySelectorAll(".thread")).toHaveLength(1);
    await userEvent.clear(search);
    await userEvent.type(search, "src/review.ts");
    await expect(canvas.getByText("1 of 1 threads")).toBeVisible();
    await expect(canvasElement.querySelectorAll(".thread")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "Clear review search" }));
    await expect(search).toHaveValue("");
    await expect(canvasElement.querySelectorAll(".thread")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "Close review search" }));
    await expect(canvas.queryByRole("searchbox", { name: "Search review comments, authors, and files" })).toBeNull();
  }
};

export const ManyChangedFiles: Story = {
  render: () => renderState(manyFilesState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const changedFilesToggle = canvas.getByRole("button", { name: /Changed files/ });
    if (changedFilesToggle.getAttribute("aria-expanded") !== "true") await userEvent.click(changedFilesToggle);
    await expect(canvas.getByRole("button", { name: "Show 200 more" })).toBeVisible();
    await expect(canvas.queryByText("src/generated/module-201.ts")).toBeNull();
  }
};
