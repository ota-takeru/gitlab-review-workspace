# Screen brief: Review file panel

## User and situation

- **Primary user:** A developer reading a changed file and discussing specific diff lines.
- **Situation:** The panel competes with other editor groups, may show large files, and must connect diff lines, remote discussions, pending review notes, and local edits.

## Tasks

- **Primary task:** Understand a file change and act on the relevant discussion without losing the line context.
- **Secondary tasks:**
  - Switch between the latest push and all MR changes.
  - Add, reply to, edit, resolve, or reopen a discussion.
  - View or save local review edits while keeping them distinct from MR changes.
  - Navigate a large file window and reveal anchored discussions.

## Critical information

- File path, change status, selected range, and current diff scope.
- Old, MR, and local line identity plus the discussion anchor.
- Open/resolved/pending state, authors, reply count, and mutation result.
- Local-edit save state and whether content is partial, loading, or unavailable.

## Visual intent

- **First-glance focal order:** File and diff scope, then the changed code and anchored discussion state, then the next discussion or recovery action.
- **Scan path and grouping:** Move from the file/scope header into aligned code lines and their attached discussions; keep mutation controls inside the discussion they affect.
- **Density and typography:** Let editor-font code dominate the scanning field while compact UI-font metadata and controls remain legible; wrap long comments without obscuring line identity or forcing horizontal page overflow.
- **Reference traits:** Borrow VS Code editor typography, split-editor density, focus, and scroll behavior plus GitLab inline-discussion attachment and resolution semantics; avoid reproducing standalone GitLab page chrome.

## Required states

- Canonical ready diff with an open multi-author discussion.
- 1024px compact editor with long path/comment and pending review note.
- Latest-push changed and unchanged-file states.
- Large-window navigation, full-file loading/error, and empty/unsupported diff.
- Local edit ready, saving, save failure, and recovery with draft retained.
- Comment pending, failed, and changed-context states with input retained.
- Historical diff is read-only for new comments and offers the current MR diff.
- Resolved, ordinary non-resolvable, and pending discussions.

## Interaction priorities

1. Keep discussions visually and semantically attached to their diff lines.
2. Make diff scope, source, and local-vs-MR meaning explicit beyond color.
3. Acknowledge mutations immediately and retain recoverable user input on failure.
4. Keep code scanning usable without allowing discussion controls to obscure content.

## Success criteria

- A reviewer can identify the changed line, discussion state, and next action at a glance.
- File context and primary discussion controls survive a 1024px split-editor layout and long content.
- A failed save or comment action explains recovery and keeps the draft intact.
- All discussion and scope controls expose accessible names, states, and visible focus.

## Evidence matrix

| Evidence | Story ID | Viewport | Theme | What to verify |
| --- | --- | --- | --- | --- |
| Canonical | `review-review-file--ready-open-discussion` | 1440x900 | light + dark | File hierarchy, diff scan, discussion continuity |
| Constrained | `review-review-file--compact-pending-discussion` | 1024x768 | light + dark | Long content, pending state, horizontal overflow |
| Failure | `review-review-file--edit-save-failure-keeps-draft` | 1024x768 | dark | Error announcement, retry readiness, draft retention |
| Scale edge | `review-review-file--large-file-window` | 1440x900 | light | Window position and next-lines action |
