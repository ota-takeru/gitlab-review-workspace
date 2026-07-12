import React from "react";
import { Button } from "storybook/internal/components";
import { addons, types, useStorybookApi } from "storybook/manager-api";

const GitLabReferenceTool = () => {
  const api = useStorybookApi();

  return (
    <Button
      onClick={() => api.selectStory("references-gitlab--overview")}
      title="Open the GitLab reference catalog"
    >
      GitLab reference
    </Button>
  );
};

addons.add("gitlab-reference", {
  type: types.TOOL,
  title: "GitLab reference",
  match: () => true,
  render: () => <GitLabReferenceTool />
});
