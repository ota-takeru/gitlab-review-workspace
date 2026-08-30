# Visual quality contract

Use this contract to judge whether a rendered review surface is visually clear, cohesive, and comfortable under developer-tool pressure. Base conclusions on captured evidence, not taste or implementation intent.

## First glance and focal order

Within a five-second or thumbnail read, the reviewer should identify the current MR, file, commit, or discussion; its state; and the next useful action. One focal point should lead, supporting context should follow, and status or recovery messaging should interrupt that order only when action is required. Check the same view in grayscale so hue cannot conceal a weak hierarchy.

## Composition and grouping

Arrange content around the review workflow rather than around component shapes. Align related labels, values, and actions; keep parent/child relationships visible; and separate independent regions with proximity or surface change before adding containers. Discussions may read as independent objects, but navigation sections and metadata should not become a stack of generic cards.

## Spacing rhythm and proximity

Use the shared 4px-based spacing scale deliberately: the smallest gaps join one control or row, medium gaps form a group, and larger gaps separate workflow regions. Repeated rows and comparable sections should share a rhythm. Uniform padding everywhere is not hierarchy, and crowded controls must not consume the breathing room needed to scan code or technical metadata.

## Typography and technical text

Use VS Code UI typography for controls, labels, and prose; use editor typography for code, hashes, paths, branches, and line metadata. Establish role through size, weight, line height, and tone rather than font changes alone. Preserve the distinguishing parts of technical strings when truncating, and allow long prose to wrap without detaching its author, state, or action.

## Color, surfaces, and borders

Use VS Code semantic colors and shared `--gl-*` roles. Reserve accent and semantic colors for focus, selection, state, and review meaning. Prefer one continuous work surface with restrained elevation; add a border only when spacing or surface contrast cannot express the boundary. Compare light and dark as a pair: hierarchy, state prominence, and perceived density should remain equivalent even when exact colors differ.

## Components and affordances

The same appearance must imply the same interaction. Primary actions, secondary actions, tabs, toggles, tree rows, discussions, and status labels should retain coherent shape, emphasis, icon use, and state behavior across surfaces. Icon-only controls need recognizable placement, accessible names, and visible focus; decorative novelty must not compete with review affordances.

## Density without pressure

Preserve VS Code-scale information density while keeping a clear scan path. At 320px Sidebar and compact editor widths, retain identity, state, and primary actions before secondary metadata. Use disclosure, safe truncation, and local scrolling to reduce pressure; do not solve crowding with tiny text, indiscriminate wrapping, or oversized containers.

## Reference traits and non-goals

- Borrow from VS Code: workbench density, semantic theming, editor typography, selection/focus behavior, compact section navigation, and restrained surfaces.
- Borrow from GitLab/Pajamas: merge-request vocabulary, discussion and resolution hierarchy, diff/status meaning, changed-file structure, and predictable review actions.
- Name the exact borrowed trait and explain any divergence required by the host, viewport, or workflow.
- Do not pixel-copy either product, reproduce standalone GitLab chrome, or trade native VS Code behavior for visual similarity.
- Do not converge on generic AI-generated UI: oversized rounded cards, decorative gradients, floating dashboard tiles, excessive whitespace, or accents without semantic purpose.

## Review sequence

1. Use the design board's compact overview for a thumbnail and five-second read; repeat in grayscale.
2. Inspect each capture at full size for composition, alignment, typography, truncation, and local affordances.
3. Compare matching light and dark captures as a pair.
4. Compare canonical and constrained states as a pair to identify hierarchy or density collapse.
5. Check interaction and state continuity across ready, pending, loading, empty, error, selection, focus, and recovery evidence.
