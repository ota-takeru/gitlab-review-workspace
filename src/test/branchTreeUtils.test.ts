import assert from "node:assert/strict";
import test from "node:test";
import { buildBranchTree } from "../branchTreeUtils";

test("buildBranchTree reconstructs nested folders and keeps folders before files", () => {
  const tree = buildBranchTree([
    { name: "button.ts", path: "src/components/button.ts", type: "blob" },
    { name: "src", path: "src", type: "tree" },
    { name: "app.ts", path: "src/app.ts", type: "blob" },
    { name: "README.md", path: "README.md", type: "blob" }
  ]);

  const src = tree.find((node) => node.path === "src");
  assert.ok(src);
  assert.equal(src.type, "tree");
  assert.equal(src.children[0].path, "src/components");
  assert.equal(src.children[1].path, "src/app.ts");
  assert.equal(src.children[0].children[0].path, "src/components/button.ts");
  assert.ok(tree.find((node) => node.path === "README.md"));
});
