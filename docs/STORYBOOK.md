# Storybook and agent UI workflow

Storybook is the reproducible UI-state catalog for this extension. Use it to inspect components and page-like Sidebar states without requiring a live Extension Development Host or GitLab account.

## Commands

```bash
# Start the catalog on http://localhost:6006
npm run storybook -- --no-open

# Verify that every story can be rendered as a production bundle
npm run build:storybook

# Run story smoke, interaction, and configured accessibility tests in Chromium
npm run test:storybook
```

Install the Playwright Chromium binary once after `npm ci` on a new machine:

```bash
npx playwright install chromium
```

## Current stories

| Story group | Important states |
| --- | --- |
| `References/GitLab` | Comprehensive 16-capability GitLab comparison catalog, grouped by workflow with official Live UI, Docs, and Pajamas links |
| `References/Component comparisons` | Side-by-side extension specimens and GitLab/Pajamas mappings for actions, identity, tabs, work rows, trees, diffs, discussions, editor, Markdown, empty states, and popovers |
| `Workspace/My work` | Normal, 320px narrow, cached refresh, partial failure, empty, initial loading |
| `Sidebar/Work item row` | Review requested, pipeline failed, Draft, MR candidate, long content |
| `Sidebar/Navigation tabs` | Review, My work with attention, no attention |
| `Review/Thread status action` | Open, Resolved, Pending, not resolvable |
| `Review/Comment form` | Compact idle, rendered Markdown, growing long comment |

Stories inherit `webview/common/theme.css`. Use the toolbar paintbrush control to switch between simulated VS Code dark and light themes.

## Agent workflow

1. Start Storybook with `npm run storybook -- --no-open`.
2. Open the exact state instead of manually reconstructing it in the extension.
3. Audit hierarchy, overflow, focus, disabled/loading/error behavior, and both themes before editing.
4. Update the component and its nearest story together.
5. Run `npm run test:storybook` and `npm run build:storybook`.
6. Use the Extension Development Host only for Host/Webview protocol, VS Code API, and real GitLab integration behavior.

Stable direct URLs are useful for coding agents and screenshots:

```text
http://localhost:6006/?path=/story/workspace-my-work--normal
http://localhost:6006/iframe.html?id=workspace-my-work--normal&viewMode=story
```

The iframe URL removes Storybook's manager chrome and is preferred for visual screenshots. Story IDs are visible in the browser URL and follow the exported story name.

## VS Code API mock

`.storybook/preview-head.html` defines a Storybook-only `acquireVsCodeApi` mock before Vue modules load. Messages are collected in `window.__storybookVsCodeMessages` and also emitted as `storybook-vscode-message` browser events.

The mock must never contain GitLab credentials or imitate authenticated network responses. Stories should use typed fixtures and component events; integration behavior remains covered by Extension Host tests.

## Storybook MCP status

As of Storybook 10.5, the official `@storybook/addon-mcp` manifest and AI capabilities are documented as React-only preview functionality. This repository uses Vue 3, so the addon is intentionally not installed or registered. Storybook itself, browser inspection, interaction tests, and accessibility checks are fully configured for Vue.

When Storybook officially supports Vue manifests, enable MCP with the documented commands:

```bash
npx storybook add @storybook/addon-mcp
npx mcp-add --type http --url "http://localhost:6006/mcp" --scope project
```

Then verify `http://localhost:6006/mcp`, ask the agent to list documented components, and add the generated project-scoped MCP configuration to the repository. Do not enable the experimental addon earlier and describe it as supported.

Official status: <https://storybook.js.org/docs/ai/mcp/overview>
