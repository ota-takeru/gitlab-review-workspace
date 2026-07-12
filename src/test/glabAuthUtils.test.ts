import assert from "node:assert/strict";
import test from "node:test";
import { getGitLabHostname, glabLoginCommand } from "../glabAuthUtils";

test("getGitLabHostname accepts GitLab URLs and hostnames", () => {
  assert.equal(getGitLabHostname("https://gitlab.example.com/group/project"), "gitlab.example.com");
  assert.equal(getGitLabHostname("gitlab.example.com"), "gitlab.example.com");
  assert.equal(getGitLabHostname(""), "gitlab.com");
});

test("getGitLabHostname rejects unsupported base URLs", () => {
  assert.equal(getGitLabHostname("ssh://gitlab.example.com/group/project"), undefined);
  assert.equal(getGitLabHostname("not a valid URL"), undefined);
});

test("glabLoginCommand targets the configured host", () => {
  assert.equal(
    glabLoginCommand("gitlab.example.com"),
    "glab auth login --hostname gitlab.example.com"
  );
});
