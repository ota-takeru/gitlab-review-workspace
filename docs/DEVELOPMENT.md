# Development guide

## Quick start

```bash
npm ci
npm run check
npm test
```

Open the repository in VS Code and launch `Run Extension`. The configured pre-launch task runs `npm run compile` before starting the Extension Development Host.

On Windows, the task invokes `npm.cmd` in the Windows workspace. Do not reuse one
`node_modules` directory across Windows and WSL: packages such as Rollup install
platform-specific optional binaries. If you intentionally develop inside WSL,
open the repository with VS Code's WSL remote and install dependencies from that
WSL workspace instead.

## Development loop

### Extension Host or data behavior

1. Find the entrypoint or message handler under `src/`.
2. Trace state mutations through `ReviewStore`.
3. Update the nearest unit test under `src/test/`.
4. Run `npm run check`.
5. Run the relevant compiled test or `npm test`.
6. Exercise the behavior in the Extension Development Host when it depends on VS Code APIs or GitLab state.

### Webview UI

1. Read `docs/UI_DESIGN.md`.
2. Open or add the nearest state in Storybook; see `docs/STORYBOOK.md`.
3. Edit the Vue app under `webview/` or a shared component under `webview/common/` and update its story.
4. Run `npm run check` and `npm run test:storybook`.
5. Run `npm run build:webview` or keep `npm run watch` active.
6. Reload the Extension Development Host only for VS Code or GitLab integration behavior.
7. Verify the relevant states in both light and dark themes.

Do not modify the bundled `media/webview/*.js` or `media/webview/style.css` directly.

## Runtime flow

1. `src/extension.ts` creates the shared services and registers commands/views.
2. `GlabAuthService` checks `glab` availability and authentication state.
3. `ReviewStore` owns selected-MR state, local edits, optimistic mutations, and limited caches.
4. `GitLabReviewClient` executes GitLab operations through `glab`.
5. Providers and panel managers translate store state into typed Webview state.
6. Vue apps send typed user actions back through `src/webviewProtocol.ts`.

### Review identity and mutation lifecycle

- `reviewContext.ts` binds rendered input to the normalized instance URL (including port and subpath), project, MR IID, diff base/start/head SHAs, and current user. Validate this context both at message receipt and immediately before executing a queued mutation.
- `ReviewStore` serializes refreshes and mutations. Optimistic state belongs to the captured review object; asynchronous completions must never mutate a replacement MR or instance. A successful refresh invalidates mutable branch caches.
- Webview composers use request IDs and explicit success/failure replies. Preserve text while pending and on failure; clear only the successfully submitted value. Keep drafts bound to their original context after navigation or refresh.
- Native review documents retain immutable SHA content. Historical comparisons cannot create line comments; latest-push comments use the full MR's line mapping. A newer diff requires opening the current MR before writing from an old editor.
- Native submission commands must reject on failure or cancellation. VS Code clears the reply input after a fulfilled command; returning a failure value alone does not preserve it ([VS Code 1.97 reply action lifecycle](https://github.com/microsoft/vscode/blob/1.97.0/src/vs/workbench/contrib/comments/browser/commentReply.ts#L253-L270)).
- Review and My work persistence is namespaced by instance. Legacy unscoped caches are left untouched and are not automatically attributed to a host; reload the MR after upgrading. The `Recover Local Drafts from Earlier Versions` command opens a local copy for manual recovery without posting or migrating it. Local repository matching uses the source project URL, including fork identity, rather than a numeric GitLab project ID.
- VS Code 1.97 is the minimum runtime and the exact development type version, matching the stable document-paste API used by native comments.

The native diff is the primary review surface; My work selects work and the Sidebar navigates it. Retain the legacy viewer until native local-edit workflows and the host-level comment/image failure cases have equivalent validation. Review progress UI is intentionally omitted; opening a file is not an acknowledgement that it was reviewed.

## Change routing

| Change | Start here | Also inspect |
| --- | --- | --- |
| Extension activation or commands | `src/extension.ts` | `package.json` |
| Authentication/login | `src/glabAuth.ts` | `src/glabAuthUtils.ts`, tests |
| GitLab request or response mapping | `src/gitlabApi.ts` | `src/gitlabMappers.ts`, types, tests |
| State, caching, optimistic updates | `src/reviewStore.ts` | `src/reviewTypes.ts` |
| Sidebar behavior | `src/sidebarProvider.ts` | `webview/sidebar/App.vue` |
| Review file behavior | `src/reviewFilePanel.ts` | `webview/review-file/App.vue` |
| Native diff and comments | `src/nativeReviewEditor.ts` | `src/nativeReviewUtils.ts`, `package.json` comment menus |
| Commit diff behavior | `src/commitDiffPanel.ts` | `webview/commit-diff/App.vue` |
| Host/Webview messages | `src/webviewProtocol.ts` | all senders and receivers |
| Shared UI/theme | `webview/common/` | all three Webview apps |

## Validation commands

```bash
# Fast static verification
npm run check

# Build Extension Host only
npm run compile:host

# Build Webviews only
npm run build:webview

# Clean build and full test suite
npm test

# Browser-rendered component and accessibility tests
npm run test:storybook

# Static Storybook production bundle
npm run build:storybook
```

`npm test` calls `npm run compile`, so it validates both TypeScript compilation and the production Webview bundle before running tests from `out/test/`.

## Manual QA checklist

- Signed out, unavailable `glab`, loading, empty, error, and ready states render correctly.
- Selecting another MR clears or normalizes MR-specific UI state.
- Refresh preserves usable cached content while showing pending/error feedback.
- Comment add/edit/resolve operations show pending state and recover after failure.
- File, thread, branch, and commit navigation open the intended target.
- Local edits remain distinct from MR additions/deletions.
- No token, authorization header, or credential is logged or persisted.
- Keyboard focus remains visible and all icon-only actions have accessible labels.

## Security and data handling

- Authentication is delegated to `glab` and the OS credential store.
- Never persist tokens in VS Code global state, workspace state, Webview state, logs, fixtures, or screenshots.
- Keep Webview CSP restrictive and load only extension-owned scripts/styles.
- Do not add raw HTML messages across the Host/Webview boundary.
- Treat GitLab text, filenames, URLs, and API responses as untrusted input.
- Keep external navigation explicit and restricted to expected GitLab URLs.

## Definition of done

A change is complete when:

- requested behavior and edge states are implemented;
- relevant tests are added or the absence of a practical test is explained;
- `npm run check` passes;
- `npm test` passes for source changes;
- UI changes have light/dark and responsive evidence;
- generated bundles are rebuilt when the delivered workspace needs to run immediately;
- documentation is updated when behavior, setup, or architecture changed.
