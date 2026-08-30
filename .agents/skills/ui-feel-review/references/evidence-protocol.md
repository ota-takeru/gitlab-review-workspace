# Repeated interaction evidence protocol

Use an actual rendered interaction or a reproducible evidence sequence containing interaction order and rendered state changes. A static screenshot can support a fact but cannot establish feel or a motion path by itself.

## Before the run

1. Resolve and record the project profile, schema version, fingerprint, and adapters. Read its configured contracts and the relevant surface brief. When no profile exists, record generic fallback and do not invent project rules.
2. Record the primary task, expected target, action origin/result, expected acknowledgement/outcome, next action/recovery, configured context anchors, and required host transitions. State semantic identity and visual/spatial correspondence separately.
3. Record one stable condition key: evidence provider and locator, fixture/data state, viewport/environment, display mode, starting state, required host transitions, and capture date or revision.
4. Follow the configured data policy. Exclude credentials and unauthorized private content from every artifact.

## During each repetition

Create ordered evidence IDs such as `E1-R1-ORIENT`, `E2-R1-ACT`, and `E3-R1-OUTCOME`. Record:

- origin/result semantic identity; row/index or peer slot and viewport region; visible peer count/order; focus indicator, scroll, and surrounding extent;
- a non-leading visible item in at least one filter/collapse/reorder repetition;
- an independent retained visible anchor only when it is perceivable, spatially stable, and explains the origin-result relation; exclude the moved item, generic boundaries, and invisible focus;
- an intermediate frame/trace, rendered frame sample, or motion event with visible position/state samples when judging motion;
- `intermediate_path: observed | absent | not_measured | fixture_blocked`; a configured or computed transition without an intermediate rendered sample remains `not_measured`;
- `visual_correspondence: broken` and `linkage_verdict: spatial_disconnect` only when a non-leading target changes slot/region, peer context disappears or is replaced, the path is absent, and no independent visible anchor remains.

Do not use displacement alone or a universal pixel threshold.

| Phase | Minimum evidence |
| --- | --- |
| `orient_predict` | Visible target/current state, configured context, and predictable next response. |
| `act` | Exact input/host action, focused or selected control, and any extra step. |
| `acknowledgement` | Immediate visible response, including ignored, duplicated, or ambiguous response. |
| `pending` | Intermediate state after the documented wait, or `not_observed` when inapplicable. |
| `outcome` | Visible success, failure, unchanged state, or context loss and its message/control. |
| `next_action_recovery` | Next target, retry, undo, cancel, or retained-work behavior; test when safe. |

Capture the same condition at least twice or use the higher configured minimum. Do not coach later runs or silently change data. Two partial cycles remain partial. Use ordered observations instead of invented durations. Mark a phase `fixture_blocked` when the evidence provider or host cannot supply the expected response; do not treat that limitation as a product failure.

## After the run

- Store direct observations in `facts`; store interpretations in `inferences` that reference fact IDs.
- Complete `action_result_linkage` for at least R1 and R2: semantic identity, visual correspondence, peer-context and position change, intermediate path, independent retained anchor, focus/scroll, and linkage verdict.
- Cite condition, repetition, phase, exact visible location/control, and evidence ID for every verdict and friction item.
- Compare canonical/constrained, display-mode, theme, locale, or other pairs only when the profile or brief requires them.
- Preserve the exact condition for every hypothesis and before/after implementation comparison.
- Record missing phases and host transitions under `limitations` and `evidence_coverage`. Route configured hard functional/accessibility gates to `$ui-review`.

## Classify coverage before product feel

- `complete`: the configured minimum comparable cycles cover every essential phase and required host transition; a genuinely inapplicable pending phase may be `not_observed`.
- `partial`: a real repeatable slice supports some dimensions, but an essential phase or transition is missing, blocked, or evidence-provider-limited.
- `insufficient`: no real interaction sequence exists or evidence cannot support a feel judgment.

Keep `evidence_coverage` separate from `product_feel`. When an essential outcome or recovery is absent, set the overall verdict to `not_assessable`. Reserve `broken` for complete evidence that visibly demonstrates inability to complete or recover. Hypotheses may address observed slices only.

## Minimum report coverage

Include policy provenance; the configured minimum repetitions with at least R1 and R2; all six phases in order; R1/R2 `action_result_linkage`; evidence coverage; separate product feel; facts/inferences; one overall verdict and confidence or `not_assessable`; friction when present; at most two causal-linkage hypotheses with effect, tradeoff, and same-condition proof; and exactly three unanswered human checks.
