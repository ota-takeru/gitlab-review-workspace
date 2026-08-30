import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { onMounted, onUnmounted } from "vue";
import type { CommitDiffViewState } from "../../src/webviewProtocol";
import App from "./App.vue";

const state: CommitDiffViewState = {
  commit: {
    id: "commit-1",
    shortId: "abc1234",
    title: "Update answer",
    authorName: "Reviewer One",
    authoredAt: "2026-01-01T00:00:00.000Z",
    committedAt: "2026-01-01T00:00:00.000Z"
  },
  file: {
    path: "src/review.ts",
    oldPath: "src/review.ts",
    newPath: "src/review.ts",
    diff: "@@ -1 +1 @@\n-const answer = 41;\n+const answer = 42;",
    status: "modified",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    collapsed: false,
    tooLarge: false
  }
};

const compactErrorState: CommitDiffViewState = {
  ...state,
  commit: {
    ...state.commit,
    title: "Preserve review discussion anchors while navigating long generated integration files"
  },
  file: {
    ...state.file,
    path: "packages/review-workspace/src/generated/integrations/gitlab/discussions/ReviewDiscussionNavigationController.ts",
    oldPath: "packages/review-workspace/src/generated/integrations/gitlab/discussions/ReviewDiscussionNavigationController.ts",
    newPath: "packages/review-workspace/src/generated/integrations/gitlab/discussions/ReviewDiscussionNavigationController.ts"
  },
  fullFileError: "The entire file could not be loaded. The changed-lines diff remains available."
};

const collapsedState: CommitDiffViewState = {
  ...state,
  file: { ...state.file, diff: "", collapsed: true }
};

const tooLargeState: CommitDiffViewState = {
  ...state,
  file: { ...state.file, diff: "", tooLarge: true }
};

const noDisplayableChangesState: CommitDiffViewState = {
  ...state,
  file: { ...state.file, diff: "" }
};

const fullFileLoadingState: CommitDiffViewState = {
  ...state,
  fullFileLoading: true
};

function renderWithoutState() {
  return {
    components: { CommitDiffApp: App },
    template: "<CommitDiffApp />"
  };
}

function renderFullFileRetryWorkflow() {
  return {
    components: { CommitDiffApp: App },
    setup() {
      let timer: number | undefined;
      const onMessage = (event: Event) => {
        const message = (event as CustomEvent<{ type?: string }>).detail;
        if (message?.type !== "loadFullFile") return;
        window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state: { ...state, fullFileLoading: true } } }));
        timer = window.setTimeout(() => {
          window.dispatchEvent(new MessageEvent("message", {
            data: {
              type: "state",
              state: {
                ...state,
                fullFileLoading: false,
                fullFile: { oldText: "const answer = 41;\n", newText: "const answer = 42;\n" }
              }
            }
          }));
        }, 80);
      };
      onMounted(() => {
        window.addEventListener("storybook-vscode-message", onMessage);
        window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state } }));
      });
      onUnmounted(() => {
        if (timer !== undefined) window.clearTimeout(timer);
        window.removeEventListener("storybook-vscode-message", onMessage);
      });
    },
    template: "<CommitDiffApp />"
  };
}

function renderState(nextState: CommitDiffViewState) {
  return {
    components: { CommitDiffApp: App },
    setup() {
      onMounted(() => {
        window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state: nextState } }));
      });
    },
    template: "<CommitDiffApp />"
  };
}

const meta = {
  title: "Review/Commit diff",
  component: App,
  parameters: { layout: "fullscreen" },
  decorators: [
    () => ({ template: '<div class="storybook-frame editor-wide" style="min-height:0"><story /></div>' })
  ]
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadySideBySide: Story = {
  render: () => renderState(state),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("region", { name: "src/review.ts commit diff" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Commit file diff" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Changed lines" })).toHaveAttribute("aria-pressed", "true");
    await expect(canvasElement.querySelector('[data-syntax-language="typescript"] [data-token-kind="keyword"]')).toHaveTextContent("const");
  }
};

export const CompactFullFileError: Story = {
  render: () => renderState(compactErrorState),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Entire file" }));
    await expect(canvas.getByRole("button", { name: "Entire file" })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByText("Entire file unavailable")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Show changed lines" }));
    await expect(canvas.getByRole("button", { name: "Changed lines" })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("region", { name: "Commit file diff" })).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Entire file" }));
    await expect(canvas.getByText("Entire file unavailable")).toBeVisible();
    const storyWindow = canvasElement.ownerDocument.defaultView as Window & { __storybookVsCodeMessages?: unknown[] };
    const messages = storyWindow.__storybookVsCodeMessages ?? [];
    const messageCount = messages.length;
    const retry = canvas.getByRole("button", { name: "Retry entire file" });
    retry.focus();
    await expect(retry).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(messages.slice(messageCount)).toContainEqual({ type: "loadFullFile" }));
  }
};

export const SideBySideDiff: Story = {
  render: () => renderState(state),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Before")).toBeVisible();
    await expect(canvas.getByText("After")).toBeVisible();
    await expect(codeLine(canvasElement, "const answer = 41;")).toBeVisible();
    await expect(codeLine(canvasElement, "const answer = 42;")).toBeVisible();
  }
};

export const InitialLoading: Story = {
  render: () => renderWithoutState(),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status", { name: "" })).toHaveTextContent("Loading diff…");
  }
};

export const EntireFileLoading: Story = {
  render: () => renderState(fullFileLoadingState),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Loading entire file…")).toBeVisible();
  }
};

export const CollapsedDiff: Story = {
  render: () => renderState(collapsedState),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Diff is collapsed")).toBeVisible();
  }
};

export const TooLargeDiff: Story = {
  render: () => renderState(tooLargeState),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Unable to display diff")).toBeVisible();
  }
};

export const NoDisplayableChanges: Story = {
  render: () => renderState(noDisplayableChangesState),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("No displayable changes")).toBeVisible();
  }
};

export const FullFileRetryReachesReady: Story = {
  render: () => renderFullFileRetryWorkflow(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const entireFile = canvas.getByRole("button", { name: "Entire file" });
    entireFile.focus();
    await expect(entireFile).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(entireFile).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getAllByText("Loading entire file…")).toHaveLength(2);
    await waitFor(() => expect(canvas.getByRole("region", { name: "Commit file diff" })).toBeVisible());
    await expect(codeLine(canvasElement, "const answer = 42;")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Entire file" })).toHaveAttribute("aria-pressed", "true");
  }
};

function codeLine(canvasElement: HTMLElement, text: string): Element | null {
  return Array.from(canvasElement.querySelectorAll("[data-syntax-language]"))
    .find((element) => element.textContent === text) ?? null;
}
