# Repository guidance

## Project intent

- This is a VS Code extension for reviewing GitLab merge requests without leaving the editor.
- Preserve a dense developer-tool experience that feels compatible with both GitLab Pajamas and native VS Code UI.
- Authentication belongs to `glab`; never store, print, or send GitLab tokens from this extension.

## Read before editing

- Start with `README.md` for product scope and repository routing.
- For setup, debugging, architecture, and validation, read `docs/DEVELOPMENT.md`.
- For any Webview or styling task, read `docs/UI_DESIGN.md` before making design decisions.
- Treat `src/webviewProtocol.ts` as the contract between Extension Host and Webviews.

## Source boundaries

- Edit Extension Host behavior under `src/`.
- Edit Vue Webviews and shared UI under `webview/`.
- Do not hand-edit `out/` or generated files under `media/webview/`; regenerate them with `npm run compile` or `npm run build:webview`.
- Keep Host/Webview communication typed. Do not send HTML fragments or credentials through messages.
- Reuse existing shared components and theme tokens before adding new components or CSS variables.
- Do not add a production dependency unless the task clearly requires it and the user approves the tradeoff.

## Change discipline

- Inspect `git status` first and preserve unrelated user changes.
- Keep changes scoped to the requested behavior; avoid opportunistic refactors.
- Add or update the smallest relevant test for behavior changes when feasible.
- When a recurring repository rule or correction is discovered, update this file or the closest relevant document.

## Required verification

- Run `npm run check` after TypeScript or Vue changes.
- Run the smallest relevant test during iteration.
- Run `npm test` before declaring an implementation complete when source behavior changed.
- For UI changes, verify both light and dark themes plus narrow Sidebar and editor-panel widths using the checklist in `docs/UI_DESIGN.md`.
- Report commands run, results, files changed, and any validation that could not be completed.

## Release packaging

- For VSIX releases, run `npx --yes @vscode/vsce package` without `--no-dependencies` so runtime dependencies are included.
- Before uploading a release asset, verify `vsce ls --tree` contains all runtime dependencies declared in `package.json` (including `node_modules/diff` when required) and compiled worker files such as `out/reviewDiffWorker.js`.

## Storybook workflow

- For Webview UI changes, use the nearest story under `webview/**/*.stories.ts`; add a state when the bug cannot already be reproduced directly by URL.
- Prefer page-like and workflow stories over adding low-value stories for every icon or token.
- Start the catalog with `npm run storybook -- --no-open`, inspect both simulated VS Code themes, then run `npm run test:storybook` and `npm run build:storybook` for changed stories.
- Read `docs/STORYBOOK.md` for direct story URLs, fixtures, and the VS Code API mock.
- Do not claim that the official Storybook MCP addon supports this Vue repository. It is currently React-only preview functionality; use Storybook URLs and browser automation until official Vue manifest support is available.
