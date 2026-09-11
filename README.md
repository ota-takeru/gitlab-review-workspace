# GitLab Review Workspace

**English** | [日本語](./README.ja.md)

GitLab Review Workspace is a VS Code extension for reviewing GitLab Merge Requests without leaving the editor. It brings changed files, commits, discussions, and local review edits into one focused review environment.

> [!NOTE]
> GitLab Review Workspace is an unofficial community extension and is not an official product of GitLab Inc.

## Features

- Select and refresh Merge Requests from the `GitLab Review` Activity Bar view
- Browse changed files and diff statistics in a tree
- Review the whole MR or inspect changes commit by commit
- Detect new pushes and compare only the changes added since the previous head
- Open MR changes in VS Code's native diff editor
- Create, reply to, edit, resolve, and reopen GitLab discussions
- Create discussions from selected diff lines
- Paste or attach images to review comments
- Filter changed files by path and review state
- Search review comments by body, author, or file path
- Open MRs from GitLab Todo notifications
- Browse source and target branch files
- Keep local review edits separate from the MR diff
- Restore the latest cached review during temporary network failures

## Review surfaces

- **My work**: choose an MR from work that needs your attention
- **Sidebar**: navigate changed files, commits, and review threads
- **VS Code diff editor**: the primary review surface, with native code navigation and inline discussions
- **Review file panel (Legacy Viewer)**: an alternative viewer for MR, commit, and local diffs
- **Branch file editor**: browse GitLab branch files in read-only mode

Selecting a changed file or review thread in the Sidebar opens the file in VS Code's native diff editor and reveals the relevant line.

Comment inputs support Markdown. Images can be pasted directly into a comment input or attached with `Attach Image and Comment`.

Open diffs are bound to a specific GitLab instance, Merge Request, and SHA. If the review context changes, stale drafts are kept but prevented from posting to the wrong MR or revision.

## Requirements

- VS Code 1.97 or later
- [GitLab CLI (`glab`)](https://gitlab.com/gitlab-org/cli)
- A GitLab account authenticated with `glab auth login`

The extension does not store GitLab access tokens. Authentication is delegated to `glab` and the operating system's credential store.

## Installation

Install **GitLab Review Workspace** from the Visual Studio Marketplace.

From the command line:

```bash
code --install-extension ota-takeru.gitlab-review-workspace
```

You can also install a `.vsix` from GitHub Releases by choosing **Install from VSIX...** from the VS Code Extensions view.

After installation, run `glab auth login` and open `GitLab Review` from the Activity Bar.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `gitlabReview.gitlabBaseUrl` | `https://gitlab.com` | GitLab instance URL. Custom domains, ports, and subpaths are supported. |
| `gitlabReview.projectId` | empty | Initial GitLab project ID or URL-encoded project path. |
| `gitlabReview.mergeRequestIid` | empty | Initial Merge Request IID. |

When `gitlabReview.gitlabBaseUrl` is not explicitly configured, the extension inspects `glab auth status --all` and automatically selects an authenticated host. If multiple hosts are available, it prefers the one matching the current workspace Git remote.

## Support

Please report bugs and feature requests through [GitHub Issues](https://github.com/ota-takeru/gitlab-review-workspace/issues). Do not include access tokens, Authorization headers, credentials, or private Merge Request content in reports.

See [`SUPPORT.md`](./SUPPORT.md) for more information.

## Development

Contributor setup, build, test, Storybook, and UI validation instructions are kept in the developer documentation rather than this Marketplace-facing README.

- [Development and validation guide](./docs/DEVELOPMENT.md)
- [UI design guide](./docs/UI_DESIGN.md)
- [Storybook guide](./docs/STORYBOOK.md)
- [Changelog](./CHANGELOG.md)
- [MIT License](./LICENSE)
