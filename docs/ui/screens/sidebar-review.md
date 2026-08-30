# Screen brief: Sidebar review

## User and situation

- **Primary user:** A developer navigating an active merge request from the VS Code Sidebar.
- **Situation:** The Sidebar may be only 320px wide while the user scans a long MR title, changed paths, commits, review progress, and discussions.

## Tasks

- **Primary task:** Choose the next file or unresolved discussion without losing the current review context.
- **Secondary tasks:**
  - Understand review progress and new changes since the last review.
  - Search and filter files or discussions.
  - Add an overview comment or prepare and submit a pending review.
  - Refresh, change MR, or inspect local workspace context.

## Critical information

- Selected MR, source and target branches, refresh or cached status.
- Active file or discussion and whether it is unresolved, resolved, pending, or new.
- Viewed/unviewed progress, file statistics, and local-edit labels.
- The next available action and any recoverable failure.

## Visual intent

- **First-glance focal order:** Selected MR and review state, then progress and the active or next unresolved target, then supporting navigation and actions.
- **Scan path and grouping:** Move top-to-bottom from MR identity through workspace and changed files to commits and review threads; keep counts and actions attached to their section headings.
- **Density and typography:** Preserve compact 24–32px navigation rows, readable wrapped prose, and editor-font technical identifiers whose distinguishing path or branch parts survive truncation at 320px.
- **Reference traits:** Borrow VS Code Sidebar sections, selection, focus, and density plus GitLab changed-file, discussion, and review-status hierarchy; diverge where GitLab page spacing would waste workbench width.

## Required states

- Canonical ready review with realistic files and an open discussion.
- 320px narrow layout with long title, branch, path, and comment content.
- Initial loading, cached refresh, partial error, empty, and signed-out/unavailable authentication.
- Selected, unviewed, new, local-edit, unresolved, resolved, and pending-review states.
- Many files and search/filter results.

## Interaction priorities

1. Keep the active review target and next unresolved item obvious.
2. Truncate or wrap technical strings without pushing counts or actions offscreen.
3. Preserve visible content during refresh and preserve drafts after recoverable errors.
4. Keep section toggles, tree navigation, search, and submission keyboard-operable.

## Success criteria

- A reviewer can identify and open the next unresolved discussion without recalling its path.
- The MR identity, progress, and status remain legible at 320px with long content.
- Pending, cached, failed, and completed operations are textually distinguishable.
- Focus remains visible through tabs, section toggles, tree items, and review submission.

## Evidence matrix

| Evidence | Story ID | Viewport | Theme | What to verify |
| --- | --- | --- | --- | --- |
| Canonical | `review-sidebar--ready-review` | 400x900 | light + dark | MR hierarchy, progress, file/thread affordances |
| Constrained | `review-sidebar--narrow-long-content` | 320x844 | light + dark | Truncation, wrapping, action preservation, scroll ownership |
| Pressure | `review-sidebar--high-density-review` | 400x900 | light + dark | Peer-section grammar, simultaneous expanded content, state visibility, and scan rhythm |
| Workflow edge | `review-sidebar--pending-review` | 320x844 | dark | Draft identity and review submission continuity |
| Scale edge | `review-sidebar--many-changed-files` | 400x900 | light | Incremental rendering and filter affordance |
