import assert from "node:assert/strict";
import test from "node:test";
import {
  getGitLabApiProtocol,
  getGitLabHostname,
  getGitLabLoginHostname,
  glabLoginCommand,
  parseAuthenticatedGlabHosts,
  selectGitLabHost
} from "../glabAuthUtils";

test("parseAuthenticatedGlabHosts ignores unauthenticated glab instances", () => {
  assert.deepEqual(
    parseAuthenticatedGlabHosts([
      "gitlab.com",
      "  x gitlab.com: API call failed",
      "gitlab.example.com",
      "  ✓ Logged in to gitlab.example.com as reviewer (config.yml)",
      "  ✓ Token found: **************************"
    ].join("\n")),
    ["gitlab.example.com"]
  );
});

test("selectGitLabHost prefers the workspace remote and falls back to an unambiguous host", () => {
  assert.equal(selectGitLabHost(["gitlab.com", "gitlab.example.com"], "gitlab.example.com"), "gitlab.example.com");
  assert.equal(selectGitLabHost(["gitlab.example.com"], "github.com"), "gitlab.example.com");
  assert.equal(selectGitLabHost(["gitlab.com", "gitlab.example.com"]), "gitlab.com");
});

test("getGitLabHostname accepts GitLab URLs and hostnames", () => {
  assert.equal(getGitLabHostname("https://gitlab.example.com/group/project"), "gitlab.example.com");
  assert.equal(getGitLabHostname("https://gitlab.example.com:8443"), "gitlab.example.com:8443");
  assert.equal(getGitLabHostname("gitlab.example.com"), "gitlab.example.com");
  assert.equal(getGitLabHostname(""), "gitlab.com");
});

test("getGitLabLoginHostname preserves a custom port and instance subfolder", () => {
  assert.equal(
    getGitLabLoginHostname("https://gitlab.example.com:8443/gitlab/"),
    "gitlab.example.com:8443/gitlab"
  );
});

test("getGitLabApiProtocol follows the configured URL protocol", () => {
  assert.equal(getGitLabApiProtocol("https://gitlab.example.com"), "https");
  assert.equal(getGitLabApiProtocol("http://gitlab.example.com"), "http");
});

test("getGitLabHostname rejects unsupported base URLs", () => {
  assert.equal(getGitLabHostname("ssh://gitlab.example.com/group/project"), undefined);
  assert.equal(getGitLabHostname("https://user:password@gitlab.example.com"), undefined);
  assert.equal(getGitLabHostname("https://gitlab.example.com?instance=1"), undefined);
  assert.equal(getGitLabHostname("not a valid URL"), undefined);
});

test("glabLoginCommand targets the configured host", () => {
  assert.equal(
    glabLoginCommand("gitlab.example.com"),
    "glab auth login --hostname gitlab.example.com"
  );
  assert.equal(
    glabLoginCommand("gitlab.example.com:8443/gitlab", "http"),
    "glab auth login --hostname gitlab.example.com:8443/gitlab --api-protocol http"
  );
});
