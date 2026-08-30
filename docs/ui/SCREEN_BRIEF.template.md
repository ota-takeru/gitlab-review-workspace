# Screen brief: <surface>

## User and situation

- **Primary user:** <who uses this surface>
- **Situation:** <what they know, what they are doing, and what constrains them>

## Tasks

- **Primary task:** <the single most important outcome>
- **Secondary tasks:**
  - <supporting task>
  - <supporting task>

## Critical information

- <information that must remain visible or quickly recoverable>

## Visual intent

- **First-glance focal order:** <what should be noticed first, second, and third>
- **Scan path and grouping:** <how the eye should move and which elements form groups>
- **Density and typography:** <intended compactness, text roles, wrapping, and technical-text treatment>
- **Reference traits:** <exact VS Code and GitLab/Pajamas traits to borrow, including any justified divergence>

## Required states

- ready
- loading or refreshing
- empty
- error with recovery
- pending or disabled mutation
- constrained width and long content
- <surface-specific state>

## Interaction priorities

1. <highest-priority behavior>
2. <next-priority behavior>
3. <recovery or accessibility behavior>

## Success criteria

- <observable result tied to the primary task>
- <observable constrained or failure-state result>
- <observable keyboard or focus result>

## Evidence matrix

| Evidence | Story ID or reproduction | Viewport | Theme | What to verify |
| --- | --- | --- | --- | --- |
| Canonical | `<story-id>` | `<width>x<height>` | light + dark | <hierarchy and primary task> |
| Constrained | `<story-id>` | `<width>x<height>` | light + dark | <overflow and density> |
| State edge | `<story-id>` | `<width>x<height>` | at least affected theme | <feedback and recovery> |

Record automated screenshots with `npm run ui:capture`. Add manual evidence only for behavior that a static screenshot cannot establish.
