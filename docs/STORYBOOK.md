# Storybook and agent UI workflow

Storybook is the reproducible UI-state catalog for this extension. Use it to inspect components and page-like Webview states without requiring a live Extension Development Host or GitLab account.

## Commands

```bash
# Start the catalog on http://localhost:6006
npm run storybook -- --no-open

# Verify that every story can be rendered as a production bundle
npm run build:storybook

# Run story smoke, interaction, and configured accessibility tests in Chromium
npm run test:storybook

# Capture canonical fixture-only UI evidence to output/playwright/ui-review
npm run ui:capture

# Run the full UI verification pipeline
npm run ui:verify
```

Install the Playwright Chromium binary once after `npm ci` on a new machine:

```bash
npx playwright install chromium
```

## Current stories

| Story group | Important states |
| --- | --- |
| `References/Official sources` | Link-only 16-capability source catalog grouped by workflow; this group does not render components |
| `References/Component comparisons` | Side-by-side rendered extension and independent GitLab/Pajamas specimens for actions, identity, tabs, work rows, trees, diffs, discussions, editor, Markdown, empty states, and popovers |
| `Workspace/My work` | Normal, 320px narrow, high-density pressure, cached refresh, partial failure, empty, initial loading, and keyboard focus |
| `Review/Sidebar` | Canonical review, 320px long-content constraint, high-density pressure review, pending review, initial/cached/partial/empty/auth states, progress, search, and scale edge |
| `Review/Review file` | Canonical open discussion, compact pending discussion, latest-push, full-file loading/error, unavailable/empty/too-large, local-edit pending/failure, and large-file window |
| `Review/Commit diff` | Canonical side-by-side diff, initial/full-file loading, collapsed/too-large/no-displayable states, compact recovery, and deterministic full-file retry workflow |
| `Sidebar/Work item row` | Review requested, pipeline failed, Draft, MR candidate, long content |
| `Sidebar/Navigation tabs` | Review, My work with attention, no attention |
| `Review/Thread status action` | Open, Resolved, Pending, not resolvable |
| `Review/Comment form` | Compact idle, rendered Markdown, growing long comment |

Stories inherit `webview/common/theme.css`. Use the toolbar paintbrush control to switch between simulated VS Code dark and light themes.

## GitLab comparison contract

`References/Component comparisons` always renders two independent implementations:

- **Extension specimen** imports and renders the production component used by this VS Code extension.
- **GitLab / Pajamas specimen** uses dedicated `gl-ref-*` markup and tokens based on the official Pajamas structure. It must not import or wrap an extension component.

The right-hand specimen is a local, interactive reference implementation rather than the `@gitlab/ui` package itself. GitLab UI currently requires Vue 2.7 (or Vue 3 compatibility mode), while this extension and Storybook run on native Vue 3. Each comparison therefore includes direct links to the relevant Pajamas or GitLab documentation so the local rendering can be audited against the official source.

`References/Official sources` is intentionally link-only and must not be mistaken for a rendered component gallery.

## Agent workflow

1. Read `docs/ui/project-profile.yaml`, `docs/ui/visual-quality.md`, and the relevant brief under `docs/ui/screens/`.
2. Start Storybook with `npm run storybook -- --no-open`, or let `npm run ui:capture` start it when port 6006 is unavailable.
3. Open the exact state instead of manually reconstructing it in the extension.
4. Capture actual light/dark screenshots at the brief's canonical sizes and inspect the generated design board in compact, grayscale, and full-size modes.
5. Run `$ui-review` as a review-only visual and interaction pass; do not edit code in that pass.
6. Implement no more than the three accepted issues and update the nearest page/workflow story.
7. Recapture the same conditions and run `npm run test:storybook` and `npm run build:storybook`.
8. Use the Extension Development Host only for Host/Webview protocol, VS Code API, and real GitLab integration behavior.

Stable direct URLs are useful for coding agents and screenshots:

```text
http://localhost:6006/?path=/story/workspace-my-work--normal
http://localhost:6006/iframe.html?id=workspace-my-work--normal&viewMode=story
```

The iframe URL removes Storybook's manager chrome and is preferred for visual screenshots. Story IDs are visible in the browser URL and follow the exported story name.

## Deterministic screenshot capture

[`tests/ui/cases.json`](../tests/ui/cases.json) defines the small canonical evidence matrix for Sidebar, review-file, and commit-diff surfaces. [`scripts/ui/capture.mjs`](../scripts/ui/capture.mjs) uses the existing Playwright dependency and fixture-only iframe stories; it never signs in to GitLab.

```bash
# Capture every canonical case
npm run ui:capture

# Capture one case while using an already-running catalog
npm run ui:capture -- --case sidebar-ready-dark --base-url http://127.0.0.1:6006

# Choose another ignored artifact directory
npm run ui:capture -- --output output/playwright/ui-review-before
```

The command writes deterministic PNGs, schema-v2 `manifest.json`, and `review-board.html`. `output/` is ignored by Git. Open the board locally to compare paired themes, switch to grayscale, and use compact thumbnails for the first-glance read. The manifest records the story, state, design focus, theme, declared viewport, capture mode, actual PNG image extent, filename, hash, and board path; full-page captures may be taller than the declared viewport. Evidence lanes and state vectors can be declared in `tests/ui/cases.json` so generic review tooling can distinguish canonical, constrained, and pressure coverage without guessing from filenames. The manifest does not replace human visual review. Only typed synthetic fixtures are allowed—never add tokens, authorization headers, or real private MR content.

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
