import { FileSummary, ReviewThread, ReviewThreadSortOrder } from "./reviewTypes";
export type { ReviewThreadSortOrder } from "./reviewTypes";

export interface ChangedFileTreeNode {
  name: string;
  path: string;
  type: "tree" | "file";
  children: ChangedFileTreeNode[];
  file?: FileSummary;
}

export interface ReviewThreadAuthor {
  id?: string;
  name: string;
  avatarUrl?: string;
}

export function reviewThreadAuthors(thread: Pick<ReviewThread, "comments">): ReviewThreadAuthor[] {
  const authors = new Map<string, ReviewThreadAuthor>();
  for (const comment of thread.comments) {
    const name = comment.author || "GitLab user";
    const key = comment.authorId || name.trim().toLowerCase();
    const existing = authors.get(key);
    if (!existing || (!existing.avatarUrl && comment.avatarUrl)) {
      authors.set(key, { id: comment.authorId, name, avatarUrl: comment.avatarUrl });
    }
  }
  return [...authors.values()];
}

export function sortReviewThreads(
  threads: readonly ReviewThread[],
  order: ReviewThreadSortOrder
): ReviewThread[] {
  return [...threads].sort((left, right) => {
    if (order === "open-first" && left.resolved !== right.resolved) {
      return left.resolved ? 1 : -1;
    }

    const chronological = firstCreatedAt(left).localeCompare(firstCreatedAt(right));
    return order === "newest" ? -chronological : chronological;
  });
}

export function buildChangedFileTree(files: readonly FileSummary[]): ChangedFileTreeNode[] {
  const root: ChangedFileTreeNode = { name: "", path: "", type: "tree", children: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let parent = root;
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let node = parent.children.find((candidate) => candidate.name === name);
      if (!node) {
        node = { name, path, type: isFile ? "file" : "tree", children: [] };
        parent.children.push(node);
      }
      if (isFile) {
        node.type = "file";
        node.file = file;
      }
      parent = node;
    });
  }

  sortNodes(root);
  return root.children;
}

function firstCreatedAt(thread: ReviewThread): string {
  return thread.comments[0]?.createdAt ?? "";
}

function sortNodes(node: ChangedFileTreeNode): void {
  node.children.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "tree" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  node.children.forEach(sortNodes);
}
