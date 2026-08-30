import React from "react";
import { Button } from "storybook/internal/components";
import { addons, types, useStorybookApi } from "storybook/manager-api";

const GitLabReferenceTool = () => {
  const api = useStorybookApi();

  return (
    <Button
      onClick={() => api.selectStory("references-component-comparisons--actions")}
      title="Compare extension components with rendered GitLab/Pajamas references"
    >
      Compare with GitLab
    </Button>
  );
};

addons.add("gitlab-reference", {
  type: types.TOOL,
  title: "Compare with GitLab",
  match: () => true,
  render: () => <GitLabReferenceTool />
});
