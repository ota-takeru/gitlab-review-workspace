import {
  MergeRequestState,
  CommitDiffFile,
  ReviewComment,
  ReviewCommit,
  ReviewNotification,
  ReviewThread
} from "./reviewTypes";
import type { MyWorkSource, MyWorkSourceItem } from "./myWorkTypes";

export interface GitLabCommit {
  id?: string;
  short_id?: string;
  title?: string;
  message?: string;
  author_name?: string;
  authored_date?: string;
  committed_date?: string;
  web_url?: string;
  parent_ids?: string[];
}

export interface GitLabCommitDiff {
  old_path?: string;
  new_path?: string;
  diff?: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  collapsed?: boolean;
  too_large?: boolean;
}

export interface GitLabDiscussion {
  id: string;
  resolvable?: boolean;
  resolved?: boolean;
  notes?: GitLabDiscussionNote[];
}

export interface GitLabDiscussionNote {
  id: number | string;
  body?: string;
  author?: { id?: number | string; username?: string; name?: string; avatar_url?: string };
  created_at?: string;
  updated_at?: string;
  system?: boolean;
  resolved?: boolean;
  position?: {
    new_path?: string;
    old_path?: string;
    new_line?: number | null;
    old_line?: number | null;
  };
}

export interface GitLabTodo {
  id: number | string;
  project?: { id?: number | string; path_with_namespace?: string };
  author?: { username?: string; name?: string };
  action_name?: string;
  target_type?: string;
  target_project_id?: number | string;
  target?: {
    iid?: number;
    project_id?: number | string;
    title?: string;
    state?: MergeRequestState;
    source_branch?: string;
    target_branch?: string;
    updated_at?: string;
    draft?: boolean;
    work_in_progress?: boolean;
    author?: { username?: string; name?: string };
  };
  target_url?: string;
  created_at?: string;
}

export interface GitLabMyWorkMergeRequest {
  iid?: number;
  project_id?: number | string;
  title?: string;
  state?: MergeRequestState;
  source_branch?: string;
  target_branch?: string;
  author?: { username?: string; name?: string };
  web_url?: string;
  updated_at?: string;
  draft?: boolean;
  work_in_progress?: boolean;
  source_project_id?: number | string;
  target_project_id?: number | string;
}

export function mapGitLabDiscussions(
  discussions: GitLabDiscussion[],
  currentUserId?: number | string
): ReviewThread[] {
  return discussions.flatMap((discussion) => {
    const notes = (discussion.notes ?? [])
      .filter((note) => !note.system)
      .map((note) => mapGitLabNote(note, currentUserId));
    if (notes.length === 0) {
      return [];
    }

    const position = (discussion.notes ?? []).find((note) => note.position)?.position;
    const filePath = position?.new_path ?? position?.old_path;
    const line = position?.new_line ?? position?.old_line ?? undefined;
    const resolvedFromNote = (discussion.notes ?? []).some((note) => note.resolved === true);

    return [
      {
        id: discussion.id,
        filePath,
        line,
        oldLine: position?.old_line ?? undefined,
        newLine: position?.new_line ?? undefined,
        resolved: discussion.resolved ?? resolvedFromNote,
        resolvable: Boolean(discussion.resolvable),
        comments: notes
      }
    ];
  });
}

export function mapGitLabTodos(todos: GitLabTodo[]): ReviewNotification[] {
  return todos.flatMap((todo) => {
    if (todo.target_type !== "MergeRequest") {
      return [];
    }

    const projectId = todo.target?.project_id ?? todo.target_project_id ?? todo.project?.id;
    const iid = todo.target?.iid;
    if (projectId === undefined || iid === undefined || !todo.target?.title || !todo.target.state) {
      return [];
    }

    return [
      {
        id: String(todo.id),
        projectId: String(projectId),
        mergeRequestIid: iid,
        title: todo.target.title,
        state: todo.target.state,
        actionName: todo.action_name ?? "marked",
        author: todo.author?.username ?? todo.author?.name ?? "GitLab user",
        createdAt: todo.created_at ?? new Date(0).toISOString(),
        webUrl: todo.target_url
      }
    ];
  });
}

export function mapGitLabMyWorkMergeRequests(
  mergeRequests: readonly GitLabMyWorkMergeRequest[],
  source: Exclude<MyWorkSource, "todo" | "candidates">
): MyWorkSourceItem[] {
  return mergeRequests.flatMap((mergeRequest) => {
    if (mergeRequest.project_id === undefined || !mergeRequest.iid || !mergeRequest.title || !mergeRequest.state) {
      return [];
    }
    return [{
      projectId: String(mergeRequest.project_id),
      projectPath: projectPathFromWebUrl(mergeRequest.web_url) ?? String(mergeRequest.project_id),
      iid: mergeRequest.iid,
      title: mergeRequest.title,
      state: mergeRequest.state,
      sourceBranch: mergeRequest.source_branch ?? "",
      targetBranch: mergeRequest.target_branch ?? "",
      author: mergeRequest.author?.username ?? mergeRequest.author?.name ?? "GitLab user",
      webUrl: mergeRequest.web_url,
      updatedAt: mergeRequest.updated_at,
      draft: mergeRequest.draft === true || mergeRequest.work_in_progress === true,
      roles: source === "created_by_me" ? ["author"] : source === "assigned_to_me" ? ["assignee"] : ["reviewer"],
      attentionReasons: [],
      hasPendingTodo: false
    }];
  });
}

export function mapGitLabMyWorkTodos(todos: readonly GitLabTodo[]): MyWorkSourceItem[] {
  return todos.flatMap((todo) => {
    if (todo.target_type !== "MergeRequest") return [];
    const projectId = todo.target?.project_id ?? todo.target_project_id ?? todo.project?.id;
    const iid = todo.target?.iid;
    if (projectId === undefined || iid === undefined || !todo.target?.title || !todo.target.state) return [];
    return [{
      projectId: String(projectId),
      projectPath: todo.project?.path_with_namespace ?? projectPathFromWebUrl(todo.target_url) ?? String(projectId),
      iid,
      title: todo.target.title,
      state: todo.target.state,
      sourceBranch: todo.target.source_branch ?? "",
      targetBranch: todo.target.target_branch ?? "",
      author: todo.target.author?.username ?? todo.target.author?.name ?? todo.author?.username ?? todo.author?.name ?? "GitLab user",
      webUrl: todo.target_url,
      updatedAt: todo.target.updated_at ?? todo.created_at,
      draft: todo.target.draft === true || todo.target.work_in_progress === true,
      roles: todoRoles(todo.action_name),
      attentionReasons: todoAttentionReasons(todo.action_name),
      hasPendingTodo: true
    }];
  });
}

function todoAttentionReasons(actionName: string | undefined): MyWorkSourceItem["attentionReasons"] {
  switch (actionName?.toLowerCase().replace(/_/g, "-")) {
    case "conflict":
    case "merge-conflict":
    case "unmergeable": return ["conflict"];
    case "build-failed":
    case "pipeline-failed": return ["pipeline-failed"];
    case "approval-required": return ["approval-required"];
    case "review-requested": return ["review-requested"];
    case "mentioned":
    case "directly-addressed": return ["mentioned"];
    case "assigned": return ["assigned"];
    default: return ["todo"];
  }
}

function todoRoles(actionName: string | undefined): MyWorkSourceItem["roles"] {
  switch (actionName?.toLowerCase().replace(/_/g, "-")) {
    case "assigned": return ["assignee"];
    case "review-requested": return ["reviewer"];
    default: return [];
  }
}

export function mapGitLabCommits(commits: readonly GitLabCommit[]): ReviewCommit[] {
  return commits
    .map((commit, index) => {
      const id = nonEmpty(commit.id) ?? nonEmpty(commit.short_id) ?? `commit-${index + 1}`;
      const authoredAt = nonEmpty(commit.authored_date) ?? nonEmpty(commit.committed_date) ?? new Date(0).toISOString();
      const committedAt = nonEmpty(commit.committed_date) ?? authoredAt;
      return {
        commit: {
          id,
          shortId: (nonEmpty(commit.short_id) ?? id.slice(0, 8)) || "unknown",
          title: nonEmpty(commit.title) ?? firstMessageLine(commit.message) ?? "(untitled commit)",
          authorName: nonEmpty(commit.author_name) ?? "GitLab user",
          authoredAt,
          committedAt,
          webUrl: nonEmpty(commit.web_url)
        } satisfies ReviewCommit,
        index,
        timestamp: commitTimestamp(committedAt, authoredAt)
      };
    })
    .sort((left, right) => {
      if (left.timestamp !== undefined && right.timestamp !== undefined) {
        return left.timestamp - right.timestamp || left.index - right.index;
      }
      if (left.timestamp !== undefined) return -1;
      if (right.timestamp !== undefined) return 1;
      return left.index - right.index;
    })
    .map(({ commit }) => commit);
}

export function mapGitLabCommitDiffs(diffs: readonly GitLabCommitDiff[]): CommitDiffFile[] {
  return diffs.map((diff) => {
    const oldPath = nonEmpty(diff.old_path) ?? nonEmpty(diff.new_path) ?? "(unknown path)";
    const newPath = nonEmpty(diff.new_path) ?? oldPath;
    const newFile = diff.new_file === true;
    const deletedFile = diff.deleted_file === true;
    const renamedFile = diff.renamed_file === true;
    return {
      path: deletedFile ? oldPath : newPath,
      oldPath,
      newPath,
      diff: diff.diff ?? "",
      status: newFile ? "new" : deletedFile ? "deleted" : renamedFile ? "renamed" : "modified",
      newFile,
      deletedFile,
      renamedFile,
      collapsed: diff.collapsed === true,
      tooLarge: diff.too_large === true
    };
  });
}

export function inferLanguage(filePath: string): string {
  const extension = filePath.split(".").at(-1)?.toLowerCase();
  const languages: Record<string, string> = {
    css: "css",
    html: "html",
    js: "javascript",
    json: "json",
    jsx: "javascriptreact",
    md: "markdown",
    ts: "typescript",
    tsx: "typescriptreact",
    yml: "yaml",
    yaml: "yaml"
  };

  return (extension && languages[extension]) || "plaintext";
}

export function mapGitLabNote(note: GitLabDiscussionNote, currentUserId?: number | string): ReviewComment {
  const authorId = note.author?.id;
  return {
    id: String(note.id),
    author: note.author?.username ?? note.author?.name ?? "GitLab user",
    authorId: authorId === undefined ? undefined : String(authorId),
    avatarUrl: nonEmpty(note.author?.avatar_url),
    body: note.body ?? "",
    createdAt: note.created_at ?? new Date(0).toISOString(),
    updatedAt: note.updated_at,
    canEdit: currentUserId !== undefined && authorId !== undefined && String(currentUserId) === String(authorId)
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function projectPathFromWebUrl(webUrl: string | undefined): string | undefined {
  if (!webUrl) return undefined;
  try {
    const parts = new URL(webUrl).pathname.split("/-/merge_requests/", 1)[0]?.split("/").filter(Boolean);
    return parts?.join("/") || undefined;
  } catch {
    return undefined;
  }
}

function firstMessageLine(message: string | undefined): string | undefined {
  return nonEmpty(message?.split(/\r?\n/, 1)[0]);
}

function commitTimestamp(committedAt: string, authoredAt: string): number | undefined {
  const committed = Date.parse(committedAt);
  if (Number.isFinite(committed)) return committed;
  const authored = Date.parse(authoredAt);
  return Number.isFinite(authored) ? authored : undefined;
}
