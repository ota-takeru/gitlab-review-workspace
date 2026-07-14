import { runGlab } from "./glabCommand";
import {
  GitLabDiscussion,
  GitLabDiscussionNote,
  GitLabCommit,
  GitLabCommitDiff,
  GitLabTodo,
  GitLabMyWorkMergeRequest,
  GitLabUserSummary,
  inferLanguage,
  mapGitLabDiscussions,
  mapGitLabCommits,
  mapGitLabCommitDiffs,
  mapGitLabNote,
  mapGitLabTodos,
  mapGitLabMyWorkMergeRequests,
  mapGitLabMyWorkTodos,
  mapGitLabReviewDiffs,
  mapGitLabReviewers
} from "./gitlabMappers";
import type { MyWorkSource, MyWorkSourceItem } from "./myWorkTypes";
import {
  BranchFileContent,
  CommitDiffFile,
  CommitFileContents,
  MergeRequestState,
  MergeRequestOption,
  RepositoryTreeEntry,
  ReviewComment,
  ReviewCommit,
  ReviewDraftNote,
  ReviewFile,
  ReviewFileContents,
  ReviewNotification,
  ReviewState,
  ReviewThread
} from "./reviewTypes";

export interface GitLabMergeRequest {
  iid: number;
  project_id: number | string;
  title: string;
  state: MergeRequestState;
  source_branch: string;
  target_branch: string;
  author?: { username?: string; name?: string };
  reviewers?: GitLabUserSummary[];
  web_url?: string;
  updated_at?: string;
  diff_refs?: {
    base_sha?: string;
    start_sha?: string;
    head_sha?: string;
  };
}

export interface GitLabProject {
  id: number | string;
  path_with_namespace?: string;
  web_url?: string;
  default_branch?: string;
  forked_from_project?: {
    id?: number | string;
    path_with_namespace?: string;
    web_url?: string;
    default_branch?: string;
  };
}

export interface GitLabCompareResult {
  commits?: unknown[];
  diffs?: unknown[];
}

export interface GitLabBranch {
  name?: string;
  commit?: { committed_date?: string; created_at?: string };
}

interface GitLabRepositoryTreeEntry {
  name: string;
  path: string;
  type: "tree" | "blob";
}

export type GitLabFileContentErrorCode = "too-large" | "binary" | "unavailable";

export class GitLabFileContentError extends Error {
  constructor(readonly code: GitLabFileContentErrorCode, message: string) {
    super(message);
    this.name = "GitLabFileContentError";
  }
}

class AsyncLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const rawFileLimiter = new AsyncLimiter(4);
const maxReviewFileBytes = 8 * 1024 * 1024;

interface GitLabUser {
  id: number | string;
}

interface GitLabDraftNote {
  id: number | string;
  note?: string;
  position?: {
    old_path?: string;
    new_path?: string;
    old_line?: number;
    new_line?: number;
  };
}

export class GitLabReviewClient {
  constructor(private readonly hostname: string) {}

  getHostname(): string {
    return this.hostname;
  }

  async listMyOpenMergeRequests(): Promise<MergeRequestOption[]> {
    const mergeRequests = await this.getJson<GitLabMergeRequest[]>(
      "merge_requests?scope=created_by_me&state=opened&order_by=updated_at&sort=desc&per_page=50"
    );

    return mergeRequests.map(toMergeRequestOption);
  }

  async listPendingTodos(): Promise<ReviewNotification[]> {
    const todos = await this.getJson<GitLabTodo[]>("todos?state=pending&per_page=50");
    return mapGitLabTodos(todos);
  }

  async listMyWorkTodos(): Promise<MyWorkSourceItem[]> {
    const todos = await this.getPaginatedJson<GitLabTodo[]>("todos?state=pending&type=MergeRequest&per_page=100");
    return mapGitLabMyWorkTodos(todos).slice(0, 100);
  }

  async listMyWorkMergeRequests(source: Exclude<MyWorkSource, "todo" | "candidates">): Promise<MyWorkSourceItem[]> {
    const mergeRequests = await this.getPaginatedJson<GitLabMyWorkMergeRequest[]>(
      `merge_requests?scope=${source}&state=opened&order_by=updated_at&sort=desc&per_page=100`
    );
    return mapGitLabMyWorkMergeRequests(mergeRequests, source).slice(0, 100);
  }

  async getProject(projectId: string): Promise<GitLabProject> {
    return this.getJson<GitLabProject>(`projects/${projectSegment(projectId)}`);
  }

  async listProjectOpenMergeRequests(projectId: string): Promise<GitLabMyWorkMergeRequest[]> {
    const mergeRequests = await this.getPaginatedJson<GitLabMyWorkMergeRequest[]>(
      `projects/${projectSegment(projectId)}/merge_requests?state=opened&per_page=100`
    );
    return mergeRequests;
  }

  async listProjectBranches(projectId: string): Promise<GitLabBranch[]> {
    const branches = await this.getPaginatedJson<GitLabBranch[]>(
      `projects/${projectSegment(projectId)}/repository/branches?per_page=100`
    );
    return branches;
  }

  async compareProjectBranches(
    projectId: string,
    from: string,
    to: string,
    fromProjectId: string
  ): Promise<GitLabCompareResult> {
    return this.getJson<GitLabCompareResult>(
      `projects/${projectSegment(projectId)}/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&from_project_id=${encodeURIComponent(fromProjectId)}`
    );
  }

  async listMergeRequestCommits(projectId: string, iid: number): Promise<ReviewCommit[]> {
    const commits = await this.getPaginatedJson<GitLabCommit[]>(
      `projects/${projectSegment(projectId)}/merge_requests/${iid}/commits?per_page=100`
    );
    return mapGitLabCommits(commits);
  }

  async loadCommitDiff(projectId: string, commitId: string): Promise<CommitDiffFile[]> {
    const diffs = await this.getPaginatedJson<GitLabCommitDiff[]>(
      `projects/${projectSegment(projectId)}/repository/commits/${encodeURIComponent(commitId)}/diff?per_page=100`
    );
    return mapGitLabCommitDiffs(diffs);
  }

  async loadCommitFileContents(
    projectId: string,
    commitId: string,
    file: Pick<CommitDiffFile, "oldPath" | "newPath" | "newFile" | "deletedFile">
  ): Promise<CommitFileContents> {
    const commit = await this.getJson<GitLabCommit>(
      `projects/${projectSegment(projectId)}/repository/commits/${encodeURIComponent(commitId)}`
    );
    const parentId = commit.parent_ids?.[0];
    const oldText = file.newFile || !parentId
      ? ""
      : await this.getRawFile(projectId, file.oldPath, parentId);
    const newText = file.deletedFile
      ? ""
      : await this.getRawFile(projectId, file.newPath, commitId);
    return { oldText, newText };
  }

  async listRepositoryTree(projectId: string, branch: string): Promise<RepositoryTreeEntry[]> {
    const entries = await this.getPaginatedJson<GitLabRepositoryTreeEntry[]>(
      `projects/${projectSegment(projectId)}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true&per_page=100`
    );

    return entries
      .filter((entry) => entry.type === "tree" || entry.type === "blob")
      .map((entry) => ({ name: entry.name, path: entry.path, type: entry.type }));
  }

  async readRepositoryFile(projectId: string, branch: string, filePath: string): Promise<BranchFileContent> {
    const result = await runGlab([
      "api",
      "--hostname",
      this.hostname,
      `projects/${projectSegment(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(branch)}`
    ]);
    if (!result.ok) {
      throw new Error("Could not read the GitLab file.");
    }

    return {
      projectId,
      branch,
      path: filePath,
      language: inferLanguage(filePath),
      content: result.stdout
    };
  }

  async loadMergeRequest(
    reference: Pick<MergeRequestOption, "projectId" | "iid">,
    fallbackCommits: readonly ReviewCommit[] = [],
    fallbackDraftNotes: readonly ReviewDraftNote[] = []
  ): Promise<ReviewState> {
    const project = projectSegment(reference.projectId);
    const mergeRequest = await this.getJson<GitLabMergeRequest>(
      `projects/${project}/merge_requests/${reference.iid}`
    );
    const projectId = String(mergeRequest.project_id);
    const [diffs, discussions, currentUser, commits, draftNotes] = await Promise.all([
      this.getPaginatedJson<GitLabCommitDiff[]>(
        `projects/${projectSegment(projectId)}/merge_requests/${mergeRequest.iid}/diffs?per_page=100`
      ),
      this.getPaginatedJson<GitLabDiscussion[]>(
        `projects/${projectSegment(projectId)}/merge_requests/${mergeRequest.iid}/discussions?per_page=100`
      ),
      this.getJson<GitLabUser>("user").catch(() => undefined),
      this.listMergeRequestCommits(projectId, mergeRequest.iid).catch(() => [...fallbackCommits]),
      this.getPaginatedJson<GitLabDraftNote[]>(
        `projects/${projectSegment(projectId)}/merge_requests/${mergeRequest.iid}/draft_notes?per_page=100`
      ).then((notes) => notes.map(toReviewDraftNote)).catch(() => [...fallbackDraftNotes])
    ]);
    const baseSha = mergeRequest.diff_refs?.base_sha;
    const startSha = mergeRequest.diff_refs?.start_sha;
    const headSha = mergeRequest.diff_refs?.head_sha;
    if (!baseSha || !startSha || !headSha) {
      throw new Error("The merge request does not have diff references yet.");
    }

    const files = mapGitLabReviewDiffs(diffs);

    return {
      id: `${projectId}!${mergeRequest.iid}`,
      projectId,
      mergeRequestIid: mergeRequest.iid,
      webUrl: mergeRequest.web_url,
      diffRefs: { baseSha, startSha, headSha },
      title: mergeRequest.title,
      state: mergeRequest.state,
      sourceBranch: mergeRequest.source_branch,
      targetBranch: mergeRequest.target_branch,
      author: mergeRequest.author?.username ?? mergeRequest.author?.name ?? "GitLab user",
      reviewers: mapGitLabReviewers(mergeRequest.reviewers),
      commits,
      files,
      threads: mapGitLabDiscussions(discussions, currentUser?.id),
      draftNotes
    };
  }

  async loadMergeRequestFileContents(review: ReviewState, file: ReviewFile): Promise<ReviewFileContents> {
    const diffRefs = review.diffRefs;
    if (!diffRefs) {
      throw new GitLabFileContentError("unavailable", "The merge request diff references are unavailable.");
    }
    if (file.tooLarge) {
      throw new GitLabFileContentError("too-large", "GitLab marked this file as too large to display.");
    }
    const [oldText, mrText] = await Promise.all([
      file.newFile ? Promise.resolve("") : this.getRawFile(review.projectId, file.oldPath, diffRefs.baseSha),
      file.deletedFile ? Promise.resolve("") : this.getRawFile(review.projectId, file.newPath, diffRefs.headSha)
    ]);
    return { oldText, mrText };
  }

  async addReply(
    review: ReviewState,
    discussionId: string,
    body: string
  ): Promise<ReviewComment> {
    const note = await this.requestJson<GitLabDiscussionNote>(
      [
        "api",
        "--hostname",
        this.hostname,
        "--method",
        "POST",
        `projects/${projectSegment(review.projectId)}/merge_requests/${review.mergeRequestIid}/discussions/${encodeURIComponent(discussionId)}/notes`,
        "--raw-field",
        `body=${body}`
      ],
      "Could not add the GitLab reply."
    );

    return toReviewComment(note);
  }

  async setResolved(review: ReviewState, discussionId: string, resolved: boolean): Promise<ReviewThread> {
    const discussion = await this.requestJson<GitLabDiscussion>(
      [
        "api",
        "--hostname",
        this.hostname,
        "--method",
        "PUT",
        `projects/${projectSegment(review.projectId)}/merge_requests/${review.mergeRequestIid}/discussions/${encodeURIComponent(discussionId)}`,
        "--field",
        `resolved=${resolved}`
      ],
      "Could not update the GitLab discussion status."
    );

    return toReviewThread(discussion, false);
  }

  async updateComment(
    review: ReviewState,
    discussionId: string,
    noteId: string,
    body: string
  ): Promise<ReviewComment> {
    const note = await this.requestJson<GitLabDiscussionNote>(
      [
        "api",
        "--hostname",
        this.hostname,
        "--method",
        "PUT",
        `projects/${projectSegment(review.projectId)}/merge_requests/${review.mergeRequestIid}/discussions/${encodeURIComponent(discussionId)}/notes/${encodeURIComponent(noteId)}`,
        "--raw-field",
        `body=${body}`
      ],
      "Could not update the GitLab comment."
    );

    return { ...mapGitLabNote(note), canEdit: true };
  }

  async createThread(
    review: ReviewState,
    file: ReviewFile,
    mrLine: number,
    oldLine: number | undefined,
    body: string
  ): Promise<ReviewThread> {
    const diffRefs = review.diffRefs;
    if (!diffRefs) {
      throw new Error("The merge request diff references are unavailable.");
    }

    const fields = [
      "--raw-field",
      `body=${body}`,
      "--raw-field",
      `position[base_sha]=${diffRefs.baseSha}`,
      "--raw-field",
      `position[start_sha]=${diffRefs.startSha}`,
      "--raw-field",
      `position[head_sha]=${diffRefs.headSha}`,
      "--raw-field",
      "position[position_type]=text",
      "--raw-field",
      `position[old_path]=${file.oldPath ?? file.path}`,
      "--raw-field",
      `position[new_path]=${file.newPath ?? file.path}`,
      "--raw-field",
      `position[new_line]=${mrLine}`
    ];
    if (typeof oldLine === "number") {
      fields.push("--raw-field", `position[old_line]=${oldLine}`);
    }

    const discussion = await this.requestJson<GitLabDiscussion>(
      [
        "api",
        "--hostname",
        this.hostname,
        "--method",
        "POST",
        `projects/${projectSegment(review.projectId)}/merge_requests/${review.mergeRequestIid}/discussions`,
        ...fields
      ],
      "Could not create the GitLab discussion."
    );

    return toReviewThread(discussion, true);
  }

  async createOverviewThread(review: ReviewState, body: string): Promise<ReviewThread> {
    const discussion = await this.requestJson<GitLabDiscussion>(
      [
        "api",
        "--hostname",
        this.hostname,
        "--method",
        "POST",
        `projects/${projectSegment(review.projectId)}/merge_requests/${review.mergeRequestIid}/discussions`,
        "--raw-field",
        `body=${body}`
      ],
      "Could not create the GitLab discussion."
    );

    return toReviewThread(discussion, true);
  }

  async createOverviewDraftNote(review: ReviewState, body: string): Promise<ReviewDraftNote> {
    const draftNote = await this.requestJson<GitLabDraftNote>(
      [
        "api",
        "--hostname",
        this.hostname,
        "--method",
        "POST",
        `projects/${projectSegment(review.projectId)}/merge_requests/${review.mergeRequestIid}/draft_notes`,
        "--raw-field",
        `note=${body}`
      ],
      "Could not add the comment to the GitLab review."
    );

    return toReviewDraftNote(draftNote);
  }

  async publishDraftNote(review: ReviewState, draftId: string): Promise<void> {
    await this.requestVoid(
      [
        "api",
        "--hostname",
        this.hostname,
        "--method",
        "PUT",
        `projects/${projectSegment(review.projectId)}/merge_requests/${review.mergeRequestIid}/draft_notes/${encodeURIComponent(draftId)}/publish`
      ],
      "Could not publish the GitLab review comment."
    );
  }

  async publishAllDraftNotes(review: ReviewState): Promise<void> {
    await this.requestVoid(
      [
        "api",
        "--hostname",
        this.hostname,
        "--method",
        "POST",
        `projects/${projectSegment(review.projectId)}/merge_requests/${review.mergeRequestIid}/draft_notes/bulk_publish`
      ],
      "Could not submit the GitLab review."
    );
  }

  private async getRawFile(projectId: string, filePath: string, ref: string): Promise<string> {
    return rawFileLimiter.run(async () => {
      const result = await runGlab([
        "api",
        "--hostname",
        this.hostname,
        `projects/${projectSegment(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`
      ], 30_000, maxReviewFileBytes);
      if (!result.ok) {
        throw new GitLabFileContentError(
          result.reason === "too-large" ? "too-large" : "unavailable",
          result.reason === "too-large"
            ? `The file exceeds the ${Math.round(maxReviewFileBytes / 1024 / 1024)} MiB review limit.`
            : "Could not read the GitLab file."
        );
      }
      if (result.stdout.includes("\0")) {
        throw new GitLabFileContentError("binary", "Binary files cannot be displayed as text.");
      }
      return result.stdout;
    });
  }

  private async getJson<T>(endpoint: string): Promise<T> {
    const result = await runGlab(["api", "--hostname", this.hostname, endpoint, "--output", "json"]);
    if (!result.ok) {
      throw new Error("GitLab API request failed.");
    }

    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new Error("GitLab returned an unexpected response.");
    }
  }

  private async getPaginatedJson<T>(endpoint: string): Promise<T> {
    const result = await runGlab([
      "api",
      "--hostname",
      this.hostname,
      endpoint,
      "--paginate",
      "--output",
      "ndjson"
    ]);
    if (!result.ok) {
      throw new Error("GitLab API request failed.");
    }

    try {
      return parsePaginatedJson<T>(result.stdout);
    } catch {
      throw new Error("GitLab returned an unexpected response.");
    }
  }

  private async requestJson<T>(args: string[], errorMessage: string): Promise<T> {
    const result = await runGlab([...args, "--output", "json"]);
    if (!result.ok) {
      throw new Error(errorMessage);
    }

    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new Error("GitLab returned an unexpected response.");
    }
  }

  private async requestVoid(args: string[], errorMessage: string): Promise<void> {
    const result = await runGlab(args);
    if (!result.ok) {
      throw new Error(errorMessage);
    }
  }
}

function toReviewComment(note: GitLabDiscussionNote): ReviewComment {
  return { ...mapGitLabNote(note), canEdit: true };
}

function toReviewThread(discussion: GitLabDiscussion, ownComments: boolean): ReviewThread {
  const thread = mapGitLabDiscussions([discussion])[0];
  if (!thread) {
    throw new Error("GitLab returned an incomplete discussion.");
  }

  return {
    ...thread,
    comments: ownComments
      ? thread.comments.map((comment) => ({ ...comment, canEdit: true }))
      : thread.comments
  };
}

function toReviewDraftNote(note: GitLabDraftNote): ReviewDraftNote {
  return {
    id: String(note.id),
    body: note.note ?? "",
    filePath: note.position?.new_path ?? note.position?.old_path,
    line: note.position?.new_line ?? note.position?.old_line
  };
}

export function toMergeRequestOption(mergeRequest: GitLabMergeRequest): MergeRequestOption {
  return {
    projectId: String(mergeRequest.project_id),
    iid: mergeRequest.iid,
    title: mergeRequest.title,
    state: mergeRequest.state,
    sourceBranch: mergeRequest.source_branch,
    targetBranch: mergeRequest.target_branch,
    author: mergeRequest.author?.username ?? mergeRequest.author?.name ?? "GitLab user",
    webUrl: mergeRequest.web_url,
    updatedAt: mergeRequest.updated_at
  };
}

function projectSegment(projectId: string): string {
  return encodeURIComponent(projectId);
}

function parsePaginatedJson<T>(stdout: string): T {
  const values = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);

  if (values.length === 1 && Array.isArray(values[0])) {
    return values[0] as T;
  }

  return values.flatMap((value) => Array.isArray(value) ? value : [value]) as T;
}
