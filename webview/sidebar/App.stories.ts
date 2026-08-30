import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { onMounted, onUnmounted } from "vue";
import type { SidebarMessage, SidebarViewState } from "../../src/webviewProtocol";
import { threadCollapseKey } from "../../src/webviewViewModels";
import { vscode } from "../common/vscode";
import { populatedMyWorkState } from "../stories/myWorkFixtures";
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
      createdAt: "2026-07-13T10:00:00.000Z",
      reactionsLoaded: true,
      reactions: [
        {
          name: "thumbsup",
          count: 2,
          currentUserAwardId: "award-1",
          users: [{ id: "me", name: "You" }, { id: "reviewer", name: "Reviewer" }]
        },
        { name: "party_parrot", count: 1, users: [{ id: "reviewer", name: "Reviewer" }] }
      ]
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

const initialLoadingState: SidebarViewState = {
  ...state,
  overview: { ...state.overview, loadState: "loading", selectedMergeRequest: undefined, title: "" }
};

const cachedRefreshState: SidebarViewState = {
  ...progressState,
  activeTab: "review",
  overview: { ...progressState.overview, isRefreshing: true },
  myWork: populatedMyWorkState({ phase: "loading" })
};

const partialErrorState: SidebarViewState = {
  ...progressState,
  activeTab: "review",
  overview: {
    ...progressState.overview,
    errorMessage: "GitLab could not refresh this merge request. Cached review is still available."
  },
  myWork: populatedMyWorkState({ phase: "partial", failedSources: ["todo", "candidates"] })
};

const emptyReviewState: SidebarViewState = {
  ...state,
  overview: { ...state.overview, loadState: "empty", selectedMergeRequest: undefined, title: "" }
};

const signedOutState: SidebarViewState = {
  ...state,
  auth: { phase: "signedOut", hostname: "gitlab.example.com" }
};

const authUnavailableState: SidebarViewState = {
  ...state,
  auth: { phase: "unavailable", hostname: "gitlab.example.com" }
};

const longTitle = "Keep unresolved review context visible while navigating exceptionally long generated integration paths";
const longPath = "packages/review-workspace/src/generated/integrations/gitlab/discussions/ReviewDiscussionNavigationController.ts";
const longSourceBranch = "feature/preserve-review-discussion-context-across-navigation";
const longTargetBranch = "release/2026-07-stabilization";
const narrowLongContentState: SidebarViewState = {
  ...progressState,
  activeFilePath: longPath,
  threadDetails: [{
    ...progressState.threadDetails[0]!,
    filePath: longPath,
    comments: [{
      ...progressState.threadDetails[0]!.comments[0]!,
      body: "Keep the selected discussion anchored while this unusually long path wraps, the Sidebar narrows, and the refresh remains pending."
    }]
  }],
  overview: {
    ...progressState.overview,
    selectedMergeRequest: {
      ...progressState.overview.selectedMergeRequest!,
      title: longTitle,
      sourceBranch: longSourceBranch,
      targetBranch: longTargetBranch
    },
    title: longTitle,
    sourceBranch: longSourceBranch,
    targetBranch: longTargetBranch,
    files: progressState.overview.files?.map((file, index) => ({
      ...file,
      path: index === 0 ? longPath : file.path
    })),
    threads: progressState.overview.threads?.map((thread) => ({
      ...thread,
      filePath: longPath,
      searchText: `${longPath}\nreviewer\nKeep the selected discussion anchored while this unusually long path wraps.`
    })),
    progress: progressState.overview.progress ? {
      ...progressState.overview.progress,
      nextUnresolvedThread: { id: "discussion-1", filePath: longPath, line: 42 }
    } : undefined,
    newChanges: progressState.overview.newChanges ? {
      ...progressState.overview.newChanges,
      changedPaths: [longPath]
    } : undefined
  }
};

const highDensityFiles = [
  "src/review/overview.ts",
  "src/review/navigation.ts",
  "src/review/discussions/thread-list.ts",
  "src/review/discussions/thread-state.ts",
  "src/review/fixtures/merge-request.ts",
  "src/review/fixtures/review-progress.ts",
  "webview/sidebar/App.vue",
  "webview/sidebar/App.stories.ts",
  "tests/review/sidebar-state.test.ts"
].map((path, index) => ({
  path,
  language: path.endsWith(".vue") ? "vue" : path.endsWith(".ts") ? "typescript" : "text",
  additions: 8 + index * 3,
  deletions: index % 3,
  threadCount: index < 6 ? 1 + (index % 3) : 0,
  unresolvedThreadCount: index < 4 ? 1 : 0,
  resolvedThreadCount: index === 4 || index === 5 ? 1 : 0,
  hasLocalEdit: index === 6,
  viewed: index < 3,
  newSinceLastReview: index >= 3
}));

const highDensityCommitIds = ["a1b2c3d", "d4e5f6a", "b7c8d9e", "f0a1b2c"];
const highDensityCommits = highDensityCommitIds.map((shortId, index) => ({
  id: `commit-${index + 1}`,
  shortId,
  title: [
    "Preserve review context while navigating the Sidebar",
    "Expose progress and recovery state for active reviews",
    "Keep discussion selection attached to changed files",
    "Add deterministic fixtures for dense review workflows"
  ][index],
  authorName: index % 2 === 0 ? "Review author" : "Contributor",
  authoredAt: `2026-07-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`,
  committedAt: `2026-07-${String(10 + index).padStart(2, "0")}T09:30:00.000Z`
}));

const highDensityCommitDiffFiles: SidebarViewState["commitDiff"]["files"] = highDensityFiles.slice(0, 3).map((file, index) => ({
  path: file.path,
  oldPath: file.path,
  newPath: file.path,
  status: index === 1 ? "new" : "modified",
  newFile: index === 1,
  deletedFile: false,
  renamedFile: false,
  collapsed: false,
  tooLarge: false
}));

const highDensityThreadRecords = [
  { id: "pressure-thread-1", filePath: highDensityFiles[0]!.path, line: 42, resolved: false, commentCount: 3, authors: [{ name: "Reviewer" }, { name: "Contributor" }], body: "Keep the selected discussion anchored while the review sections are expanded." },
  { id: "pressure-thread-2", filePath: highDensityFiles[1]!.path, line: 86, resolved: false, commentCount: 2, authors: [{ name: "Reviewer" }], body: "Could this navigation state remain visible after refresh?" },
  { id: "pressure-thread-3", filePath: highDensityFiles[2]!.path, line: 18, resolved: false, commentCount: 2, authors: [{ name: "Contributor" }], body: "The thread summary should retain its file context." },
  { id: "pressure-thread-4", filePath: highDensityFiles[3]!.path, line: 64, resolved: false, commentCount: 1, authors: [{ name: "Reviewer" }], body: "Please clarify the pending-state transition." },
  { id: "pressure-thread-5", filePath: highDensityFiles[4]!.path, line: 12, resolved: true, commentCount: 2, authors: [{ name: "Reviewer" }], body: "This fixture now uses a stable synthetic review state." },
  { id: "pressure-thread-6", filePath: highDensityFiles[5]!.path, line: 27, resolved: true, commentCount: 1, authors: [{ name: "Contributor" }], body: "Progress totals are now represented explicitly." }
];

const highDensityThreads = highDensityThreadRecords.map((thread) => ({
  id: thread.id,
  filePath: thread.filePath,
  line: thread.line,
  newLine: thread.line,
  resolved: thread.resolved,
  resolvable: true,
  commentCount: thread.commentCount,
  authors: thread.authors,
  lastComment: { author: thread.authors.at(-1)?.name ?? "Reviewer", createdAt: "2026-07-15T11:00:00.000Z" },
  searchText: `${thread.filePath}\n${thread.authors.map((author) => author.name).join(" ")}\n${thread.body}`
}));

const highDensityThreadDetails = highDensityThreadRecords.map((thread) => ({
  id: thread.id,
  filePath: thread.filePath,
  line: thread.line,
  newLine: thread.line,
  resolved: thread.resolved,
  resolvable: true,
  comments: Array.from({ length: thread.commentCount }, (_, index) => ({
    id: `${thread.id}-comment-${index + 1}`,
    author: thread.authors[index % thread.authors.length]?.name ?? "Reviewer",
    body: index === 0 ? thread.body : "The surrounding review context remains available for the next action.",
    createdAt: `2026-07-1${5 + index}T11:00:00.000Z`
  }))
}));

const highDensityMrKey = "202!84";
const highDensityState: SidebarViewState = {
  ...state,
  activeFilePath: highDensityFiles[0]!.path,
  localWorkspace: {
    phase: "ready",
    remoteMatch: "matched",
    currentBranch: "feature/review-context",
    detached: false,
    dirty: { total: 822, modified: 614, untracked: 208 },
    worktrees: [],
    target: { kind: "missing" }
  },
  threadDetails: highDensityThreadDetails,
  overview: {
    ...state.overview,
    selectedMergeRequest: {
      projectId: "202",
      iid: 84,
      title: "Preserve review context across dense navigation states",
      state: "opened",
      sourceBranch: "feature/review-context",
      targetBranch: "main",
      author: "Review author"
    },
    title: "Preserve review context across dense navigation states",
    sourceBranch: "feature/review-context",
    targetBranch: "main",
    author: "Review author",
    commits: highDensityCommits,
    files: highDensityFiles,
    threads: highDensityThreads,
    totalComments: highDensityThreads.reduce((sum, thread) => sum + thread.commentCount, 0),
    unresolvedThreads: 4,
    resolvedThreads: 2,
    additions: highDensityFiles.reduce((sum, file) => sum + file.additions, 0),
    deletions: highDensityFiles.reduce((sum, file) => sum + file.deletions, 0),
    progress: {
      totalFiles: highDensityFiles.length,
      viewedFiles: 3,
      unviewedFiles: highDensityFiles.length - 3,
      totalDiscussions: highDensityThreads.length,
      resolvedDiscussions: 2,
      unresolvedDiscussions: 4,
      completionPercent: 34,
      completionState: "in-progress",
      nextUnresolvedThread: { id: highDensityThreads[0]!.id, filePath: highDensityThreads[0]!.filePath, line: highDensityThreads[0]!.line },
      newSinceLastReview: true,
      newCommitCount: 4
    },
    newChanges: {
      projectId: "202",
      mergeRequestIid: 84,
      fromSha: "base-sha",
      toSha: "head-sha",
      commitCount: 4,
      changedPaths: highDensityFiles.slice(3, 7).map((file) => file.path)
    }
  }
};

const highDensityCollapsedThreads = Object.fromEntries(
  highDensityThreadRecords.slice(1).map((thread) => [threadCollapseKey(highDensityMrKey, thread.id), true])
);

function renderState(nextState: SidebarViewState, savedState: Record<string, unknown> = {}) {
  return {
    components: { SidebarApp: App },
    setup() {
      vscode.setState(savedState);
      onMounted(() => {
        window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state: nextState } }));
      });
    },
    template: "<SidebarApp />"
  };
}

function renderHighDensityState(savedState: Record<string, unknown>) {
  return {
    components: { SidebarApp: App },
    setup() {
      vscode.setState(savedState);
      let readyTimer: number | undefined;
      const pushCommitDiff = (commitDiff: SidebarViewState["commitDiff"]) => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "state", state: { ...highDensityState, commitDiff } }
        }));
      };
      const clearReadyTimer = () => {
        if (readyTimer === undefined) return;
        window.clearTimeout(readyTimer);
        readyTimer = undefined;
      };
      const onStorybookVsCodeMessage = (event: Event) => {
        const message = (event as CustomEvent<SidebarMessage>).detail;
        if (message.type === "toggleCommit" && highDensityCommits.some((commit) => commit.id === message.commitId)) {
          clearReadyTimer();
          pushCommitDiff({ phase: "loading", mrKey: highDensityMrKey, commitId: message.commitId, files: [] });
          readyTimer = window.setTimeout(() => {
            readyTimer = undefined;
            pushCommitDiff({
              phase: "ready",
              mrKey: highDensityMrKey,
              commitId: message.commitId,
              files: highDensityCommitDiffFiles
            });
          }, 240);
        } else if (message.type === "collapseCommit") {
          clearReadyTimer();
          pushCommitDiff({ phase: "hidden", files: [] });
        }
      };
      onMounted(() => {
        window.addEventListener("storybook-vscode-message", onStorybookVsCodeMessage);
        pushCommitDiff({ phase: "hidden", files: [] });
      });
      onUnmounted(() => {
        clearReadyTimer();
        window.removeEventListener("storybook-vscode-message", onStorybookVsCodeMessage);
      });
    },
    template: "<SidebarApp />"
  };
}

function renderMyWorkReviewWorkflow() {
  return {
    components: { SidebarApp: App },
    setup() {
      const firstMergeRequest = populatedMyWorkState().buckets.attention.find((item) => item.kind === "merge-request");
      let currentState: SidebarViewState = {
        ...state,
        activeTab: "my-work",
        myWork: populatedMyWorkState()
      };
      const publish = () => window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state: currentState } }));
      const onStorybookVsCodeMessage = (event: Event) => {
        const message = (event as CustomEvent<SidebarMessage>).detail;
        if (message.type === "setSidebarTab") {
          currentState = { ...currentState, activeTab: message.tab };
        } else if (message.type === "openMyWorkMergeRequest" && firstMergeRequest) {
          currentState = {
            ...currentState,
            activeTab: "review",
            overview: {
              ...currentState.overview,
              selectedMergeRequest: {
                projectId: firstMergeRequest.projectId,
                iid: firstMergeRequest.iid,
                title: firstMergeRequest.title,
                state: firstMergeRequest.state,
                sourceBranch: firstMergeRequest.sourceBranch,
                targetBranch: firstMergeRequest.targetBranch,
                author: firstMergeRequest.author
              },
              title: firstMergeRequest.title,
              sourceBranch: firstMergeRequest.sourceBranch,
              targetBranch: firstMergeRequest.targetBranch,
              author: firstMergeRequest.author
            }
          };
        } else {
          return;
        }
        publish();
      };
      onMounted(() => {
        window.addEventListener("storybook-vscode-message", onStorybookVsCodeMessage);
        publish();
      });
      onUnmounted(() => window.removeEventListener("storybook-vscode-message", onStorybookVsCodeMessage));
    },
    template: "<SidebarApp />"
  };
}

const meta = {
  title: "Review/Sidebar",
  component: App,
  decorators: [
    () => ({ template: '<div class="storybook-frame sidebar-surface" style="min-height:0"><story /></div>' })
  ],
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyReview: Story = {
  render: () => renderState(progressState, { changedFilesExpanded: true }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Add review threads from the sidebar" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Review progress" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /Changed files/ })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("search", { name: "Changed file filters" })).toBeVisible();
    await expect(canvas.getByText("Select a file to open its diff")).toBeVisible();
    const changedDirectory = canvasElement.querySelector<HTMLElement>(".changed-tree-list .tree-directory > summary");
    if (!changedDirectory) throw new Error("Changed file directory is not rendered");
    await userEvent.click(changedDirectory);
    const changedFile = canvas.getByRole("button", { name: "Open changed file src/review.ts in diff" });
    await expect(changedFile).toBeVisible();
    const messages = (canvasElement.ownerDocument.defaultView as Window & { __storybookVsCodeMessages?: unknown[] }).__storybookVsCodeMessages ?? [];
    const messageCount = messages.length;
    await userEvent.click(changedFile);
    await waitFor(() => expect(messages.slice(messageCount)).toContainEqual({ type: "openFile", filePath: "src/review.ts" }));
    await expect(canvas.getByTitle("src/review.ts:42")).toBeVisible();
    await expect(canvas.getByText(":party_parrot:")).toBeVisible();
    const reactionCount = messages.length;
    await userEvent.click(canvas.getByRole("button", { name: "Remove thumbsup reaction, 2" }));
    await waitFor(() => expect(messages.slice(reactionCount)).toContainEqual({
      type: "toggleCommentReaction",
      threadId: "discussion-1",
      commentId: "comment-1",
      name: "thumbsup"
    }));
  }
};

export const HighDensityReview: Story = {
  render: () => renderHighDensityState({
    changedFilesExpanded: true,
    commitsExpanded: true,
    collapsedThreads: highDensityCollapsedThreads
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrollingElement = canvasElement.ownerDocument.scrollingElement;
    const initialScrollTop = scrollingElement?.scrollTop ?? 0;
    await expect(canvas.getByRole("heading", { name: "Preserve review context across dense navigation states" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /Changed files/ })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("button", { name: /Commits/ })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("region", { name: "Local workspace" })).toHaveTextContent("No matching local or remote branch is available.");
    await expect(canvas.getByRole("progressbar", { name: "Review completion" })).toHaveAttribute("aria-valuenow", "34");
    await expect(canvas.getByRole("button", { name: "Collapse discussion at src/review/overview.ts:42" })).toBeVisible();
    await expect(canvas.getByText("Keep the selected discussion anchored while the review sections are expanded.")).toBeVisible();
    await expect(canvasElement.querySelectorAll(".commit-row")).toHaveLength(highDensityCommits.length);
    await expect(canvasElement.querySelectorAll("[data-review-thread-id]")).toHaveLength(highDensityThreads.length);
    const commitRows = Array.from(canvasElement.querySelectorAll<HTMLElement>(".commit-row"));
    await expect(commitRows.map((row) => row.querySelector("code")?.textContent)).toEqual(highDensityCommits.map((commit) => commit.shortId));
    const selectedCommitRow = commitRows[2]!;
    const selectedCommitItem = selectedCommitRow.closest<HTMLElement>(".commit-item")!;
    await expect(selectedCommitRow).toHaveAttribute("aria-label", "Show changes for commit b7c8d9e: Keep discussion selection attached to changed files");
    await expect(within(selectedCommitRow).getByText("Show changes")).toBeVisible();
    const messages = (canvasElement.ownerDocument.defaultView as Window & { __storybookVsCodeMessages?: unknown[] }).__storybookVsCodeMessages ?? [];
    const messageCount = messages.length;
    await userEvent.click(selectedCommitRow);
    await waitFor(() => {
      const rows = Array.from(canvasElement.querySelectorAll<HTMLElement>(".commit-row"));
      expect(rows).toHaveLength(highDensityCommits.length);
      expect(rows.map((row) => row.querySelector("code")?.textContent)).toEqual(highDensityCommits.map((commit) => commit.shortId));
      expect(rows[2]).toBe(selectedCommitRow);
      expect(selectedCommitRow).toHaveClass(/active/);
      expect(selectedCommitRow).toHaveAttribute("aria-pressed", "true");
      expect(selectedCommitRow).toHaveFocus();
      expect(messages.slice(messageCount)).toContainEqual({ type: "toggleCommit", commitId: highDensityCommits[2]!.id });
    });
    await waitFor(() => expect(within(selectedCommitItem).getByText("Loading diff…")).toBeVisible());
    await waitFor(() => {
      expect(within(selectedCommitItem).getByText(`${highDensityCommitDiffFiles.length} changed files`)).toBeVisible();
      expect(within(selectedCommitItem).getByText(highDensityCommitDiffFiles[0]!.path)).toBeVisible();
    });
    await expect(selectedCommitRow).toHaveTextContent("Hide changes");
    await expect(selectedCommitRow).toHaveAttribute("aria-label", "Hide changes for commit b7c8d9e: Keep discussion selection attached to changed files");
    const allChangesButton = canvas.getByRole("button", { name: "All changes" });
    await userEvent.click(allChangesButton);
    await waitFor(() => {
      expect(canvas.getByRole("button", { name: "All changes" })).toHaveAttribute("aria-pressed", "true");
      expect(canvasElement.querySelectorAll(".commit-row.active")).toHaveLength(0);
      expect(selectedCommitItem.querySelector(".commit-detail-shell")).toBeNull();
    });
    const resolvedThread = canvasElement.querySelector<HTMLElement>('[data-review-thread-id="pressure-thread-5"]');
    await expect(resolvedThread).toHaveClass(/resolved/);
    await expect(resolvedThread).toHaveClass(/collapsed/);
    await expect(within(resolvedThread!).getByText("Resolved", { exact: true })).toBeVisible();
    await expect(within(resolvedThread!).getByRole("button", { name: "Go to diff for src/review/fixtures/merge-request.ts at line 12" })).toBeVisible();
    allChangesButton.blur();
    if (scrollingElement) scrollingElement.scrollTop = initialScrollTop;
  }
};

export const NarrowLongContent: Story = {
  render: () => renderState(narrowLongContentState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: longTitle })).toBeVisible();
    const goToDiff = canvas.getByRole("button", { name: `Go to diff for ${longPath} at line 42` });
    await expect(goToDiff).toBeVisible();
    await expect(canvas.getByRole("progressbar", { name: "Review completion" })).toBeVisible();
    const sourceBranch = canvas.getByTitle(longSourceBranch);
    await expect(sourceBranch).toHaveAttribute("title", longSourceBranch);
    await expect(sourceBranch.querySelector(".gl-technical-identifier-tail")).toHaveTextContent("context-across-navigation");
    const targetBranch = canvas.getByTitle(longTargetBranch);
    await expect(targetBranch.querySelector(".gl-technical-identifier-tail")).toHaveTextContent(longTargetBranch);
    const threadLocation = canvas.getByTitle(`${longPath}:42`);
    await expect(threadLocation).toHaveAttribute("title", `${longPath}:42`);
    const threadTail = threadLocation.querySelector<HTMLElement>(".gl-technical-identifier-tail");
    await expect(threadTail).toHaveTextContent("NavigationController.ts:42");
    await waitFor(() => {
      const tailBounds = threadTail!.getBoundingClientRect();
      const identifierBounds = threadLocation.getBoundingClientRect();
      expect(tailBounds.right).toBeLessThanOrEqual(identifierBounds.right + 1);
    });
    const storyWindow = canvasElement.ownerDocument.defaultView;
    if (storyWindow?.matchMedia("(max-width: 360px)").matches) {
      const toggleBounds = threadLocation.closest(".thread-toggle")!.getBoundingClientRect();
      const actionBounds = goToDiff.closest(".thread-actions")!.getBoundingClientRect();
      expect(actionBounds.top).toBeGreaterThanOrEqual(toggleBounds.bottom - 1);
    }
  }
};

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

    await waitFor(() => {
      const formBounds = canvasElement.querySelector<HTMLElement>(".new-thread-form")?.getBoundingClientRect();
      const trayBounds = tray.getBoundingClientRect();
      const spacing = Number.parseFloat(canvasElement.ownerDocument.defaultView?.getComputedStyle(tray).getPropertyValue("--gl-spacing-8") ?? "");
      expect(formBounds).toBeDefined();
      expect(formBounds!.bottom).toBeLessThanOrEqual(trayBounds.top - (Number.isFinite(spacing) ? spacing : 0) + 1);
    });

    const reviewMode = canvas.getByRole("button", { name: "Post as review" });
    const editor = canvas.getByRole("textbox", { name: "Add review thread" });
    await userEvent.click(reviewMode);
    await expect(reviewMode).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(editor);
    await userEvent.type(editor, "Document the migration note.");
    const addToReview = canvas.getByRole("button", { name: "Add to review" });
    await expect(editor).toHaveTextContent("Document the migration note.");
    await expect(editor).toHaveFocus();
    await expect(addToReview).toBeEnabled();
    await waitFor(() => {
      const trayBounds = tray.getBoundingClientRect();
      const addBounds = addToReview.getBoundingClientRect();
      const spacing = Number.parseFloat(canvasElement.ownerDocument.defaultView?.getComputedStyle(tray).getPropertyValue("--gl-spacing-8") ?? "");
      expect(addBounds.bottom).toBeLessThanOrEqual(trayBounds.top - (Number.isFinite(spacing) ? spacing : 0) + 1);
    });

    await userEvent.clear(editor);
    const modeGroup = canvas.getByRole("group", { name: "Choose comment or review" });
    const commentMode = within(modeGroup).getByRole("button", { name: "Post as comment" });
    await userEvent.click(commentMode);
    await expect(commentMode).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(editor).not.toHaveFocus();
      expect(canvasElement.querySelector(".new-thread-form footer")).toBeNull();
    });
    const scrollingElement = canvasElement.ownerDocument.scrollingElement;
    if (scrollingElement) scrollingElement.scrollTop = 0;
    canvasElement.dataset.storyReady = "pending-review";
  }
};

export const InitialLoading: Story = {
  render: () => renderState(initialLoadingState),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Loading merge request…")).toBeVisible();
  }
};

export const CachedRefresh: Story = {
  render: () => renderState(cachedRefreshState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tabpanel", { name: "Review" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Add review threads from the sidebar" })).toBeVisible();
    const refreshBanner = canvas.getByText("Refreshing merge request… Showing cached review until it finishes.");
    await expect(refreshBanner).toBeVisible();
    expect(canvasElement.querySelector(".review-status-banner")?.getAttribute("role")).toBe("status");
    await expect(canvas.getByRole("button", { name: "Reload merge request" })).toBeDisabled();
  }
};

export const PartialError: Story = {
  render: () => renderState(partialErrorState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tabpanel", { name: "Review" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Add review threads from the sidebar" })).toBeVisible();
    await expect(canvas.getByRole("alert")).toHaveTextContent("Cached review is still available.");
  }
};

export const EmptyReview: Story = {
  render: () => renderState(emptyReviewState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No merge request available")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible();
  }
};

export const SignedOut: Story = {
  render: () => renderState(signedOutState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Sign in to GitLab")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Sign in" })).toBeEnabled();
  }
};

export const AuthUnavailable: Story = {
  render: () => renderState(authUnavailableState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("glab unavailable. Check CLI setup, then retry.")).toBeVisible();
    const retry = canvas.getByRole("button", { name: "Retry" });
    await expect(retry).toBeEnabled();
    retry.focus();
    await expect(retry).toHaveFocus();
    const messages = (window as Window & { __storybookVsCodeMessages?: unknown[] }).__storybookVsCodeMessages ?? [];
    const messageCount = messages.length;
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(messages.slice(messageCount)).toContainEqual({ type: "refreshAuth" }));
  }
};

export const MyWorkToReviewKeyboardWorkflow: Story = {
  render: () => renderMyWorkReviewWorkflow(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const myWorkTab = canvas.getByRole("tab", { name: /My work/ });
    await expect(myWorkTab).toHaveAttribute("aria-selected", "true");
    const firstMergeRequest = canvas.getByRole("button", { name: /Refine the GitLab review workspace navigation/ });
    firstMergeRequest.focus();
    await expect(firstMergeRequest).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(canvas.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true"));
    await expect(canvas.getByRole("tabpanel", { name: "Review" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Refine the GitLab review workspace navigation" })).toBeVisible();
    await expect(canvas.getByText("!42", { exact: true })).toBeVisible();
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
    await expect(progressRegion.getByRole("button", { name: "Next unresolved" })).toHaveClass(/review-progress-next-action/);
    await expect(canvasElement.querySelectorAll(".review-progress-actions > button")).toHaveLength(1);
    await expect(progressRegion.getByRole("progressbar", { name: "Review completion" })).toHaveAttribute("aria-valuenow", "25");
    await userEvent.click(canvas.getByRole("button", { name: /Changed files/ }));
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Filter changed files by status" }), "new");
    await waitFor(() => {
      expect(canvas.getByText("1 file")).toBeVisible();
      expect(canvas.getByText("NEW")).toBeVisible();
    });
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
    await waitFor(() => expect(canvas.getByRole("button", { name: "Show 200 more" })).toBeVisible());
    await expect(canvas.queryByText("src/generated/module-201.ts")).toBeNull();
  }
};
