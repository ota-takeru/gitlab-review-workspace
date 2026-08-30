# Screen brief: Commit diff panel

## User and situation

- **Primary user:** A developer isolating one commit while reviewing an MR.
- **Situation:** The user needs to understand which commit and file are visible, compare before/after lines, and optionally load the entire file inside a constrained editor group.

## Tasks

- **Primary task:** Scan the selected commit's file diff and understand the change accurately.
- **Secondary tasks:**
  - Confirm commit identity and file status.
  - Switch from patch changes to the entire file.
  - Retry an unavailable full-file load.
  - Recognize collapsed, too-large, or empty GitLab diff states.

## Critical information

- Commit short ID and title, file path, and change status.
- Before/after line relationship and current display range.
- Full-file loading, failure, retry, or unsupported reason.

## Visual intent

- **First-glance focal order:** Commit and file identity, then the before/after change field, then display-range state or recovery action.
- **Scan path and grouping:** Move from commit metadata to file/scope controls and across aligned before/after columns; keep full-file feedback adjacent to the control that caused it.
- **Density and typography:** Preserve editor-font code and line alignment as the dominant texture, with compact UI-font metadata; safely truncate long identifiers without hiding the distinguishing commit or filename suffix.
- **Reference traits:** Borrow VS Code diff-editor scanning, typography, and compact controls plus GitLab commit/file status meaning; diverge from GitLab page layout to fit split editor groups.

## Required states

- Canonical ready side-by-side diff.
- 1024px compact layout with a long commit title and file path.
- Entire-file loading and error with retry.
- Collapsed, too-large, and no-displayable-change states.

## Interaction priorities

1. Keep commit and file identity visible while scanning the diff.
2. Preserve code readability and correct before/after alignment at compact width.
3. Make display-range loading and recovery explicit and keyboard-operable.

## Success criteria

- The selected commit, file, and change direction are unambiguous.
- Side-by-side code remains scannable at 1024px without silent content loss.
- Full-file loading and failure state the current condition and recovery action.
- Scope controls have accessible pressed/loading state and visible focus.

## Evidence matrix

| Evidence | Story ID | Viewport | Theme | What to verify |
| --- | --- | --- | --- | --- |
| Canonical | `review-commit-diff--ready-side-by-side` | 1440x900 | light + dark | Commit/file hierarchy and before/after scan |
| Constrained | `review-commit-diff--compact-full-file-error` | 1024x768 | light + dark | Long strings, error explanation, retry affordance |
| Existing behavior | `review-commit-diff--side-by-side-diff` | 1024x768 | dark | Typed fixture and line semantics |
