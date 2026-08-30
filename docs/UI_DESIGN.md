# UI design contract

## Direction

The UI is a dense professional developer tool. It should feel familiar to GitLab users while remaining visually integrated with VS Code.

- Use GitLab/Pajamas patterns for review concepts, status, discussions, and changed-file hierarchy.
- Use VS Code theme variables for surfaces, text, focus, selection, and editor affordances.
- Express hierarchy primarily through spacing, typography, alignment, and restrained contrast.
- Use cards only for independent objects such as discussions or overlays.
- Avoid decorative gradients, oversized headings, excessive rounding, and redundant borders.

## Project profile and screen briefs

Treat [`docs/ui/project-profile.yaml`](ui/project-profile.yaml) as the product-specific evaluation contract and [`docs/ui/visual-quality.md`](ui/visual-quality.md) as the rendered visual-quality contract. Before changing a surface, also read its brief under [`docs/ui/screens/`](ui/screens/):

- [`sidebar-review.md`](ui/screens/sidebar-review.md)
- [`review-file.md`](ui/screens/review-file.md)
- [`commit-diff.md`](ui/screens/commit-diff.md)

The profile defines the primary user, visual and interaction direction, weighted review axes, and hard accessibility/recovery gates. The visual-quality contract defines the evidence-backed visual read. The brief defines the surface's primary task, visual intent, required states, and canonical evidence. Use [`SCREEN_BRIEF.template.md`](ui/SCREEN_BRIEF.template.md) for a new major surface and record durable choices in [`decisions.md`](ui/decisions.md).

The profile follows the reusable UI-skill `schema_version: 1` contract. It also selects this repository's Storybook/Playwright and VS Code host adapters, context anchors, evidence policy, editable/generated paths, and validation commands. Generic UI skills resolve an explicitly supplied profile first, then `.agents/ui/profile.yaml`, then this `docs/ui/project-profile.yaml` compatibility location; do not copy GitLab- or VS Code-specific rules back into the reusable skill bodies.

Run general UI work as distinct review and implementation passes: first use `$ui-review` to report evidence-backed problems without editing code, then implement at most the three highest-value accepted issues. When the goal includes interaction feel, add an independent `$ui-feel-review` task trace, implement one accepted causal hypothesis with `$ui-feel-iterate`, and repeat the feel review in a fresh context. Recapture the same story, fixture, viewport, theme, starting state, and task sequence before evaluating the result.

## Source of truth

- Semantic tokens and global behavior: `webview/common/theme.css`
- Shared primitives: `webview/common/components/`
- Sidebar-specific layout: `webview/sidebar/`
- Review diff layout: `webview/review-file/`
- Commit diff layout: `webview/commit-diff/`

Do not create a parallel token system inside an individual Vue component. Add a shared semantic token only when an existing VS Code or `--gl-*` token cannot express the role.

## Layout and density

- Base spacing unit: 4px.
- Related controls: 4–8px apart.
- Distinct groups: 12–16px apart.
- Major sections: 16–24px apart when editor space permits.
- Sidebar rows should normally stay between 24px and 32px high.
- Preserve useful information density at approximately 320–420px Sidebar widths.
- File paths, branch names, and commit titles must truncate safely rather than push actions offscreen.

## Typography

- Use the VS Code UI font for controls and descriptive content.
- Use the VS Code editor font for code, hashes, paths, and line-oriented metadata.
- Keep the main MR title visually strongest without making it page-sized.
- Metadata should be subordinate but remain readable in both themes.
- Avoid using font weight as the only indicator of status or selection.

## Color and theme behavior

- Do not hard-code light surfaces or assume a white editor background.
- Prefer VS Code semantic variables, then shared `--gl-*` variables, then a `color-mix()` fallback.
- Additions, deletions, warnings, errors, success, and selection must retain different roles in light, dark, and high-contrast themes.
- Selection should remain visible without overwhelming file statistics or code-diff colors.
- Borders should separate regions only where spacing and surface contrast are insufficient.

## Interaction states

Every interactive component must consider:

- default;
- hover;
- active/selected;
- keyboard focus;
- disabled;
- loading/pending;
- empty and error states.

For asynchronous GitLab mutations, keep the current content visible when possible, show a local pending state, and prevent accidental duplicate submission.

For collapsible UI, expose `aria-expanded`, keep the summary understandable while collapsed, and preserve a predictable focus target.

## Review-specific rules

- The active file must be identifiable in the Sidebar and match the visible review panel.
- Unresolved discussions are more prominent than resolved discussions.
- Resolved discussions may collapse, but their location, author/summary, and state must remain discoverable.
- Reply and edit forms should appear close to the discussion they affect.
- MR and local changes must use distinct labels in addition to color.
- Comment location must remain visually attached to the relevant diff line.
- Destructive actions require clear labels and must not become the dominant primary action.

## Responsive verification matrix

Check at least these representative sizes:

| Surface | Size | Purpose |
| --- | --- | --- |
| Sidebar narrow | 320×844 | Minimum practical navigation width |
| Sidebar typical | 400×900 | Normal review workflow |
| Editor compact | 1024×768 | Split-editor and constrained-height behavior |
| Editor wide | 1440×900 | Discussion width and diff scanning |

For each relevant surface, verify:

- light and dark themes;
- long file paths, branch names, titles, and comments;
- zero, one, and many files/commits/threads;
- selected, pending, resolved, disabled, empty, loading, and error states;
- horizontal overflow, wrapping, sticky headers, and scroll ownership;
- keyboard focus and accessible names.

## UI change workflow

1. Read the project profile, visual-quality contract, and relevant screen brief.
2. Capture or identify the current Storybook state before editing with `npm run ui:capture` when a canonical case exists, then inspect the generated design board.
3. Run an independent `$ui-review` pass across the board's first-glance and full-size comparisons and select no more than three issues.
4. For momentum, continuity, calm, confidence, or rhythm concerns, run `$ui-feel-review` through at least two comparable task traces. Treat missing fixture or host transitions as evidence gaps, not product defects.
5. State the accepted information-hierarchy issue or one causal interaction-feel hypothesis and its intended behavior.
6. Use `$ui-feel-iterate` for an accepted feel hypothesis; otherwise change layout and structure before decorative styling.
7. Reuse existing components and tokens.
8. Build and inspect the affected state at the sizes above.
9. Compare before/after in light and dark themes under the same capture conditions and task sequence.
10. Use a fresh independent review pass before claiming improvement, then defer remaining issues to a later bounded iteration.
