import { RepositoryTreeEntry } from "./reviewTypes";

export interface BranchTreeNode {
  name: string;
  path: string;
  type: "tree" | "blob";
  children: BranchTreeNode[];
}

export function buildBranchTree(entries: RepositoryTreeEntry[]): BranchTreeNode[] {
  const root: BranchTreeNode = { name: "", path: "", type: "tree", children: [] };

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let parent = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const isLeaf = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");
      let node = parent.children.find((candidate) => candidate.name === name);
      if (!node) {
        node = {
          name,
          path,
          type: isLeaf ? entry.type : "tree",
          children: []
        };
        parent.children.push(node);
      }
      if (isLeaf) {
        node.type = entry.type;
      }
      parent = node;
    }
  }

  sortBranchTree(root);
  return root.children;
}

function sortBranchTree(node: BranchTreeNode): void {
  node.children.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "tree" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  node.children.forEach(sortBranchTree);
}
