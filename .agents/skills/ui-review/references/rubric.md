# UI review rubric

## Policy and hard gates

Use every hard gate declared by the resolved project profile. A hard-gate failure overrides a weighted score. Do not fail a gate on speculation; cite the exact evidence or the required missing case.

Set the overall review verdict to `fail` only when a configured hard gate fails, unless the profile explicitly declares another verdict rule. Otherwise use `pass`. A low weighted score creates prioritized issues but is not an implicit fail threshold. `not_observed` is not `fail`; a profile must declare missing evidence as a gate for absence itself to fail the review.

When no profile exists, use these generic fallback gates:

- a keyboard-applicable primary task cannot be completed with a keyboard;
- keyboard focus is missing, obscured, or indistinguishable;
- meaning or status is conveyed only by color;
- a destructive action can cause material loss without confirmation or a clear recovery path;
- a required loading, empty, error, pending, or constrained state has no reproducible evidence;
- evidence contains credentials or unauthorized private data.

Project profiles may add or strengthen gates. They cannot disable evidence integrity, credential safety, or the review-only boundary.

## Generic consistency anchors

These anchors describe evidence and visual grammar; they are not extra taste scores.

### Peer-region grammar coherence

Inventory comparable peers by semantic role. Record containment, inset/alignment, header pattern, border/radius/surface/accent, density, and disclosure. Mark `coherent` when comparable roles share a legible grammar, `mixed` when limited differences are explained by state or interaction, `competing` when repeated unexplained grammar fights the scan path, and `insufficient_evidence` when peers cannot be compared.

### Pressure delta

Describe the state-vector change from canonical to constrained, pressure, and project-defined evidence: content volume, simultaneous states, disclosure, warnings/errors, viewport, display mode, and theme. Mark the delta `stable`, `degraded`, or `unobserved`. Pressure is not synonymous with a narrow viewport; long content, simultaneous states, localization, zoom, or expanded regions can create pressure at any width.

### Evidence representativeness

Compare live/native and fixture/story evidence by state vector, not screenshot styling alone. Mark representativeness `complete`, `partial`, or `missing`. If visible live output contradicts the current rendered artifact, record a separate `runtime/build/cache mismatch` possibility. Never attribute a mismatch solely to CSS before ruling out fixture, bundle, viewport, data, and cache differences.

## Score anchors

Use the project profile's score range. For the common `0..4` range, apply the same meaning across every configured axis:

- **0 — blocking or absent:** The primary task is prevented, the state is undesigned, or evidence shows a severe accessibility or recovery failure.
- **1 — major friction:** Users are likely to get lost, miss important state, make errors, or require repeated workaround effort.
- **2 — usable with friction:** The normal path works, but an inconsistency, constrained state, or recovery gap creates meaningful cognitive or operational cost.
- **3 — comfortable and dependable:** Normal and important edge states support the task clearly with only minor non-blocking issues.
- **4 — robust under pressure:** The behavior remains clear and efficient with long content, density, constraints, asynchronous transitions, errors, and applicable alternative input.

For another configured range, preserve these semantic endpoints and interpolate consistently. Use each axis ID, weight, and criterion from `evaluation.axes`. For legacy `evaluation.weights`, use the key as the axis ID and derive its criterion from the project contracts without renaming the key.

When no profile exists, use this generic fallback set:

| Axis | Weight | What to judge |
| --- | ---: | --- |
| `primary_task_clarity` | 15 | Whether the next meaningful action and result are apparent |
| `context_continuity` | 15 | Whether visible task identities and selections remain connected |
| `workflow_efficiency` | 10 | Scan, navigation, interruption, and repeated effort |
| `state_feedback_and_recovery` | 10 | Acknowledgement, pending, outcome, retry, undo, and retained work |
| `visual_hierarchy_and_composition` | 15 | Focal order, grouping, alignment, balance, and competing emphasis |
| `typography_spacing_and_density` | 10 | Text roles, proximity rhythm, technical content, and constrained pressure |
| `color_surface_and_component_coherence` | 10 | Semantic color, surface economy, display parity, components, and affordances |
| `keyboard_and_accessibility` | 10 | Applicable keyboard completion, focus, names, contrast, non-color meaning, and announcements |
| `host_and_domain_fit` | 5 | Fit with configured host conventions, domain vocabulary, and reference traits |

For a `0..4` range, calculate `weighted_score_percent` as `sum(axis score / 4 * axis weight)` and round to one decimal place. For another range, normalize against its maximum. Never use the total to conceal a hard-gate failure or critical issue.

## Visual-axis guidance

### Visual hierarchy and composition

- **0:** No stable focal point or scan path; unrelated regions compete equally, or critical identity/action is detached.
- **1:** The primary region requires searching; repeated misgrouping, alignment breaks, or container emphasis obscures workflow order.
- **2:** Canonical hierarchy works, but a paired mode or constrained state changes focal order, weakens grouping, or introduces recurring competition.
- **3:** Focal order, scan path, grouping, and alignment remain clear across required conditions with only localized competition.
- **4:** Compact, grayscale, full-size, paired-mode, and constrained evidence preserve a task-led composition under long or dense content.

### Typography, spacing, and density

- **0:** Text is unreadable, roles are indistinguishable, identity is lost, or crowding/whitespace prevents the task.
- **1:** Repeated spacing or text-role failures merge groups, detach content, force disruptive wrapping, or hide distinguishing text.
- **2:** The base layout is usable, but rhythm, line height, truncation, or density degrades materially in a common condition.
- **3:** UI, prose, code/technical text, and metadata roles are distinct; proximity communicates grouping; constrained views remain usable.
- **4:** Typography and spacing remain systematic through long prose, identifiers, high density, and compact conditions while preserving scan and action space.

### Color, surface, and component coherence

- **0:** Meaning depends on color alone, a display mode breaks meaning, or matching appearances behave inconsistently.
- **1:** Accents, borders, cards, or variants repeatedly compete with content, and parity or affordance recognition is unreliable.
- **2:** Semantic roles mostly work, but a common state shows excess surfaces, inconsistent components, generic template styling, or unequal prominence.
- **3:** Color is semantic, surfaces and borders are economical, components predict behavior, and required display modes preserve equivalent emphasis.
- **4:** The system stays coherent across supplied states, communicates without hue, avoids unsupported decorative motifs, and diverges only for documented host or workflow needs.

## Issue classification

### Severity

- **critical:** Blocks a primary task, causes likely material loss, exposes sensitive data, or violates a hard gate without a practical workaround.
- **major:** Causes recurring confusion, missed state, incorrect action, serious accessibility friction, or recovery cost in a primary workflow.
- **minor:** Creates localized hierarchy, consistency, density, or polish friction without threatening task completion.

### Confidence

- **high:** Directly visible and reproducible, or confirmed by both interaction and automated evidence.
- **medium:** Strongly supported by visible evidence but dependent on a reasonable workflow inference.
- **low:** Plausible but missing a state, trace, or comparison. Do not place low-confidence issues in the priority set unless they concern safety.

### Prioritization

Use the project profile's ordered priority factors. Fall back to:

1. user impact;
2. occurrence frequency;
3. evidence confidence;
4. implementation risk.

Use the configured recommendation maximum, defaulting to three. Prefer one structural correction that addresses several symptoms over many decorative tweaks.

### Categories

Assign one primary category:

- `hierarchy`
- `composition`
- `spacing-rhythm`
- `typography`
- `color-surface`
- `component-coherence`
- `density`
- `affordance`
- `distinctiveness`
- `motion/state-continuity`
- `accessibility`
- `usability`

## Evidence rules

For every issue, name the evidence ID or provider locator, condition, viewport/environment, visible region/control, observation, user impact, and whether the statement is fact or inference.

Avoid pure taste language. Tie issues to hierarchy, consistency, predictability, cognitive load, accessibility, recovery, or a project principle. Compare only with reference systems named by the profile; identify the exact documented trait and any justified host, viewport, or workflow divergence. Never demand pixel matching.
