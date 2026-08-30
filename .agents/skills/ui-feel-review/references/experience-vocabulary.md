# Experience vocabulary and calibration

Use these terms to describe observable interaction quality, not a claimed inner emotion. Prefix direct observations with `[fact]`; prefix interpretations with `[inference]`, and link each interpretation to fact IDs.

## Feel dimensions

| Dimension | Ask | Observable signals |
| --- | --- | --- |
| Orientation | Can the user predict where they are and what to do next? | Target, current state, scope, and next control are visible before the action; no search or recall step is needed. |
| Momentum | Does each step carry the task forward? | Immediate acknowledgement, understandable wait, clear outcome, and an adjacent next action; no duplicate click or dead-end re-read. |
| State continuity | Does context survive transitions? | Project-configured context anchors, selection, user input, and task meaning remain attached across navigation and async work. |
| Action–result continuity | Can the eye connect the action origin to acknowledgement and result? | A rendered path, stable peer context, or independent visible anchor preserves spatial causality; semantic/DOM identity alone does not. |
| Visual calm / attention competition | Does the task keep visual priority? | Status and alerts interrupt only when action is required; decoration and secondary controls do not pull attention from the review target. |
| Control confidence / recovery confidence | Can the reviewer predict action and repair? | Control label and consequence are clear; pending, retry, undo, cancel, and retained input appear when relevant. |
| Rhythm across repetition | Does repeated work have a stable cadence? | Comparable rows and transitions align; repeated cycles need similar steps and have similar acknowledgement latency. |
| Craft / coherence | Does the system behave intentionally? | Wording, focus, states, surfaces, and affordances use consistent roles and transitions across tested cases. |
| Host fit | Does the surface belong in its configured host? | The profile's density, display semantics, input/focus conventions, scroll ownership, platform vocabulary, and reference traits work together. |

## Friction calibration

Log the allowed type that best names the observable break. Multiple types may attach to one fact.

Treat semantic identity and visual correspondence separately. Retained DOM identity, DOM focus, or scroll is not a visual anchor. A retained visible anchor must be an independent feature that is visible and spatially stable before/after and explains the origin-result relation; exclude the moved target itself, generic section boundaries, and invisible pointer focus.

- `hesitation`: an inference that observed extra search, hover, re-read, or navigation reflects uncertainty; do not label an agent's unmeasured pause as hesitation. Use it only as an inference or in an unanswered human report.
- `attention_split`: the eye or interaction path must resolve competing focal points before the task can continue.
- `discontinuity`: identity, focus, selection, draft, line, or state appears detached or unexpectedly reset.
- `spatial_disconnect`: teleport, unexplained replacement, layout/scroll jump, or peer-context disappearance breaks visual correspondence. For collection changes, log it when a non-leading target changes peer slot/region, peers disappear/are replaced, the path is absent, and no independent visible anchor remains—even if semantic identity, focus, or scroll is retained. Displacement alone is insufficient; use no pixel threshold.
- `surprise`: the response, consequence, wording, or location differs from what the visible affordance predicts.
- `pressure`: observed compression, wrapping, truncation, occlusion, or competing controls reduce available scan or action space at a constrained condition; do not claim a literal felt urgency.
- `rhythm_break`: a repeated operation changes order, spacing, response, or wait behavior without an explained state change.
- `confidence_loss`: evidence forces a second confirmation, retry, or recovery search because the current condition or consequence is uncertain.

Do not use a friction label without citing the triggering fact and the task impact. Avoid “delight,” “frustration,” or similar emotional claims unless reporting unanswered human-check questions.

## Evidence coverage and verdict boundaries

Keep evidence coverage separate from product feel:

- `complete`: at least two comparable cycles cover the essential phases (orient/predict, act, acknowledgement, outcome, and next action/recovery), pending when applicable, and required configured host transitions.
- `partial`: a real, repeatable interaction slice exists, but an essential phase or host transition is missing, blocked, or fixture-limited. Judge supported dimensions/slices only; mark unsupported dimensions `not_assessable`.
- `insufficient`: no real interaction/evidence sequence exists, or the available trace cannot support any product-feel judgment.

Two reproducible partial cycles remain partial; repetition does not supply an absent outcome, recovery, or host transition. A fixture that does not return an expected state is a limitation of the evidence, not proof of a product defect.

## Behavioral verdict anchors

- `smooth`: the complete orient → act → acknowledgement → pending/outcome → next-action/recovery chain is legible and repeatable; no material context reconstruction.
- `minor_drag`: completion remains dependable, with one localized pause, re-read, extra navigation, or recovery search that does not derail the task.
- `rough`: recurring friction or a state break interrupts momentum, but the path remains recoverable with determined effort.
- `broken`: a complete trace demonstrates that the primary task or its recovery cannot be completed, or the UI provides no trustworthy next action. Do not use it for an absent or fixture-blocked response.
- `not_assessable`: the evidence cannot support a product-feel judgment for this scope. This is not a fifth quality level; name the missing phase or host transition and do not use it to imply a defect.

Always pair the verdict with `high`, `medium`, or `low` confidence and exact evidence IDs. Confidence describes evidence strength, not the reviewer’s emotion.
