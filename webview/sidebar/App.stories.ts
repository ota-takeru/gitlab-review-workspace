import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, within } from "storybook/test";
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
      lastComment: { author: "reviewer", createdAt: "2026-07-13T10:00:00.000Z" }
    }],
    totalComments: 1,
    unresolvedThreads: 1,
    additions: 4,
    deletions: 1
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
    await userEvent.click(editor);
    await userEvent.type(editor, "Please review the overall approach.");
    await expect(canvas.getByRole("button", { name: "Add review" })).toBeEnabled();
  }
};

export const DistinctStatusAndActions: Story = {
  render: () => renderState(threadState),
  play: async ({ canvasElement }) => {
    const thread = canvasElement.querySelector<HTMLElement>(".thread");
    await expect(thread).not.toBeNull();
    const canvas = within(thread!);
    await expect(canvas.getByText("Open", { exact: true })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Go to diff for src/review.ts at line 42" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Resolve thread" })).toBeVisible();
  }
};

export const ManyChangedFiles: Story = {
  render: () => renderState(manyFilesState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Changed files/ }));
    await expect(canvas.getByRole("button", { name: "Show 200 more" })).toBeVisible();
    await expect(canvas.queryByText("src/generated/module-201.ts")).toBeNull();
  }
};
