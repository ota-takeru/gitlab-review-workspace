import { runGlab } from "./glabCommand";
import {
  GitLabDiscussion,
  GitLabDiscussionNote,
  GitLabCommit,
  GitLabCommitDiff,
  GitLabTodo,
  GitLabMyWorkMergeRequest,
  inferLanguage,
  mapGitLabDiscussions,
  mapGitLabCommits,
  mapGitLabCommitDiffs,
  mapGitLabNote,
  mapGitLabTodos,
  mapGitLabMyWorkMergeRequests,
  mapGitLabMyWorkTodos
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
  ReviewFile,
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

interface GitLabDiff {
  old_path: string;
  new_path: string;
  new_file: boolean;
  deleted_file: boolean;
  too_large?: boolean;
}

interface GitLabRepositoryTreeEntry {
  name: string;
  path: string;
  type: "tree" | "blob";
}

interface GitLabUser {
  id: number | string;
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
    return mapGitLabCommits(commits.slice(0, 100));
  }

  async loadCommitDiff(projectId: string, commitId: string): Promise<CommitDiffFile[]> {
    const diffs = await this.getPaginatedJson<GitLabCommitDiff[]>(
      `projects/${projectSegment(projectId)}/repository/commits/${encodeURIComponent(commitId)}/diff?per_page=100`
    );
    return mapGitLabCommitDiffs(diffs.slice(0, 100));
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
    fallbackCommits: readonly ReviewCommit[] = []
  ): Promise<ReviewState> {
    const project = projectSegment(reference.projectId);
    const mergeRequest = await this.getJson<GitLabMergeRequest>(
      `projects/${project}/merge_requests/${reference.iid}`
    );
    const projectId = String(mergeRequest.project_id);
    const [diffs, discussions, currentUser, commits] = await Promise.all([
      this.getJson<GitLabDiff[]>(
        `projects/${projectSegment(projectId)}/merge_requests/${mergeRequest.iid}/diffs?per_page=100`
      ),
      this.getJson<GitLabDiscussion[]>(
        `projects/${projectSegment(projectId)}/merge_requests/${mergeRequest.iid}/discussions?per_page=100`
      ),
      this.getJson<GitLabUser>("user").catch(() => undefined),
      this.listMergeRequestCommits(projectId, mergeRequest.iid).catch(() => [...fallbackCommits])
    ]);
    const baseSha = mergeRequest.diff_refs?.base_sha;
    const startSha = mergeRequest.diff_refs?.start_sha;
    const headSha = mergeRequest.diff_refs?.head_sha;
    if (!baseSha || !startSha || !headSha) {
      throw new Error("The merge request does not have diff references yet.");
    }

    const files = await Promise.all(
      diffs.map((diff) => this.loadFile(projectId, diff, baseSha, headSha))
    );

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
      commits,
      files,
      threads: mapGitLabDiscussions(discussions, currentUser?.id)
    };
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

  private async loadFile(
    projectId: string,
    diff: GitLabDiff,
    baseSha: string,
    headSha: string
  ): Promise<ReviewFile> {
    const oldText = diff.new_file ? "" : await this.getRawFile(projectId, diff.old_path, baseSha);
    const mrText = diff.deleted_file
      ? ""
      : await this.getRawFile(projectId, diff.new_path, headSha);
    const path = diff.deleted_file ? diff.old_path : diff.new_path;

    return {
      path,
      language: inferLanguage(path),
      oldText,
      mrText,
      oldPath: diff.old_path,
      newPath: diff.new_path
    };
  }

  private async getRawFile(projectId: string, filePath: string, ref: string): Promise<string> {
    const result = await runGlab([
      "api",
      "--hostname",
      this.hostname,
      `projects/${projectSegment(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`
    ]);

    return result.ok ? result.stdout : "";
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
      "json"
    ]);
    if (!result.ok) {
      throw new Error("GitLab API request failed.");
    }

    try {
      return JSON.parse(result.stdout) as T;
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
