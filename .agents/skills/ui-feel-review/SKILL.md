---
name: ui-feel-review
description: Review the interaction feel of any rendered UI workflow from repeated browser, story, native-host, or recorded evidence, including action-origin-to-visible-result continuity and motion/state transitions. Trace orientation, action, acknowledgement, pending, outcome, and recovery; report evidence-backed momentum, spatial/causal continuity, calm, confidence, rhythm, and configured host fit without editing artifacts. Use for flow quality, spatial disconnect, teleport/jump, transition, motion, or dynamic UX reviews; pair with $ui-review for weighted visual scoring, accessibility, reduced-motion, and hard functional gates.
---

# UI Feel Review

Act only as an independent, review-only observer. Never edit, patch, format, stage, or commit source, stories, fixtures, configuration, documentation, snapshots, or generated bundles. You may run configured read-only capture commands and write only to the configured evidence output. Do not sign in, expose credentials, capture unauthorized private data, or mutate live state outside an explicitly authorized reproducible test condition.

## Resolve the boundary and project policy

Use this skill for the quality of a task over time: whether a user can orient, act, understand feedback, and continue or recover without reconstructing context. Complement `$ui-review`; do not duplicate it.

1. Read [references/project-profile.md](references/project-profile.md) completely.
2. Resolve the repository root and run `node <skill-dir>/scripts/resolve-profile.js --root <repository-root>`, where `<skill-dir>` contains this `SKILL.md`. Pass `--profile <path>` when supplied.
3. When a profile is found, record its path, schema version, compatibility mode, fingerprint, adapters, and warnings. Read every configured contract and the relevant surface brief completely. Read additional briefs only when the flow crosses surfaces.
4. When no profile exists, continue only with generic flow dimensions, set `policy.status: absent`, and report missing project context. Do not invent host conventions, domain identities, reference systems, commands, fixtures, or required transitions.
5. Read [references/experience-vocabulary.md](references/experience-vocabulary.md) and [references/evidence-protocol.md](references/evidence-protocol.md) completely. Use [assets/UI_FEEL_REVIEW.template.yaml](assets/UI_FEEL_REVIEW.template.yaml) for the output.

- Do not calculate a weighted score or reuse the `$ui-review` rubric.
- Route keyboard completion, visible focus, reduced-motion compliance, contrast, non-color status, destructive recovery, credential safety, and other configured hard gates to `$ui-review`. Record the route and evidence; do not silently pass or fail those gates here.
- If `$ui-review` is unavailable, record the unresolved route instead of substituting a feel verdict.
- If implementation is requested, stop after reporting and hand the supported hypothesis to an implementation workflow.

## Establish a reviewable task

1. Name one primary task as a verb phrase. Before touching the UI, record the expected target, action origin, visible result anchor, state, configured context identities, and next action.
2. Select the nearest reproducible evidence source from the profile or brief. Preserve the same provider locator, fixture/data state, viewport/environment, display mode, starting state, and required host transitions within repeated runs.
3. Require actual rendered interaction or a timestamped evidence sequence containing interaction order and rendered state changes. Static screenshots alone cannot establish feel or a motion path.
4. Follow `evidence.data_policy`. Prefer deterministic synthetic, fixture, public, or explicitly authorized test data; never put credentials or unauthorized private content in artifacts.

## Run the mandatory action-result continuity probe

For every repetition:

- Separate `semantic_identity` (the same task object or semantic target) from `visual_correspondence` (the eye can connect origin to result). Same DOM/native identity, retained programmatic focus, or unchanged scroll does not prove visual continuity. Focus counts as a visible anchor only when its indicator remains perceivable.
- Name the action origin and result. Record before/after row/index or peer slot, viewport region, visible peer count/order, focus indicator, scroll, and surrounding extent. For filter, collapse, or reorder, choose a non-leading visible item in at least one repetition.
- Count a retained visible anchor only when an independent visual feature is visible before and after, spatially stable, and explains the origin-result relation. Exclude the moved target itself, a generic section boundary, and invisible focus.
- Classify `intermediate_path` as `observed | absent | not_measured | fixture_blocked`. Use an intermediate rendered frame/trace, frame sampling, or a motion event with visible position/state samples before calling a path `observed`. A declared or computed non-zero transition only shows capability and remains `not_measured` without rendered intermediate evidence.
- Do not fail displacement alone or use a universal pixel threshold. When a non-leading target changes peer slot/region, its peer context disappears or is replaced, `intermediate_path: absent`, and no independent visible anchor remains, set `visual_correspondence: broken`, `linkage_verdict: spatial_disconnect`, and log the friction.
- Do not prefer animation by default. Motion that adds delay, obscures state, violates reduced-motion policy, or pulls attention away can worsen the task.

## Trace the task through time

Attempt at least the configured minimum repetitions, never fewer than two for a repeated-task feel verdict. Two partial cycles do not become complete by repetition. For each repetition record these phases in order:

1. **Orient / predict:** Visible target, current state, configured context identities, and predictable next response.
2. **Act:** Exact pointer, keyboard, touch, voice, or host action; focus/selection; and directly observed extra search, hover, re-read, duplicate, or navigation step.
3. **Acknowledgement:** Immediate visible response, including accepted, ignored, duplicated, or ambiguous action.
4. **Pending:** Intermediate state when one exists and whether identity, selection, draft/input, and context remain available. Use `not_observed` only when inapplicable.
5. **Outcome:** Visible success, failure, unchanged state, or context loss and the text/control that communicates it.
6. **Next action / recovery:** Next useful action, retry, undo, cancellation, or recovery and whether work can continue without reconstruction.

Repeat without coaching or silently changing the condition. Report a faster or more certain second pass only when evidence demonstrates it; never invent learning, delight, timing, or emotion.

## Separate evidence from interpretation

- Mark direct observations `[fact]` and cite evidence ID, condition, phase, location, and interaction order.
- Mark conclusions `[inference]` and link them to one or more fact IDs.
- Never claim that the reviewer/model literally felt delight, frustration, confidence, pressure, or calm. Never fabricate participants, quotes, timing, task success, or feedback.
- If duration was not measured, use `immediate`, `after the wait`, `required a repeat`, or `not measured`.
- Cite exact evidence for every verdict, friction item, and hypothesis. Keep missing, blocked, and untested states under `limitations`.

## Separate coverage from product feel

Classify evidence before assigning a product-feel verdict:

- `complete`: the configured minimum comparable cycles cover orient/predict, act, acknowledgement, outcome, and next action/recovery; pending is observed when applicable; required host transitions are observed.
- `partial`: a real repeatable slice exists, but one or more essential phase or required transition is missing, blocked, or fixture-limited. Judge only supported slices.
- `insufficient`: no real interaction sequence exists or evidence cannot support a product-feel judgment.

Keep `evidence_coverage` separate from `product_feel`. If essential outcome or recovery evidence is absent, use `not_assessable`, not `broken`. A fixture or host limitation is an evidence limitation rather than a product defect.

## Evaluate the feel

Use `smooth | minor_drag | rough | broken | not_assessable` with confidence and exact evidence IDs for each supported dimension:

- **Orientation:** Identify current context, state, target, and next action without searching or relying on memory.
- **Momentum:** Continue through action, acknowledgement, pending/outcome, and next step without dead time, duplication, or avoidable re-reading.
- **State continuity:** Keep the profile's `domain.context_anchors`, selection, user input, and task meaning connected across navigation and asynchronous work.
- **Action-result continuity:** Keep acknowledgement/result visually traceable from origin through a rendered path, stable peer context, or independent visible anchor. Semantic identity alone is insufficient.
- **Visual calm / attention competition:** Keep the primary task ahead of decoration, status, alerts, and secondary controls while preserving required interruption.
- **Control confidence / recovery confidence:** Make action, condition, consequence, retry, undo, cancellation, and retained work predictable and discoverable.
- **Rhythm across repetition:** Keep repeated rows, transitions, acknowledgements, and recovery steps consistent enough for a stable cadence.
- **Craft / coherence:** Make wording, affordance, states, focus, surfaces, and motion behave as one intentional system.
- **Host fit:** Apply only the host conventions, density, theming, input, focus, scroll ownership, and domain vocabulary named by the project profile. Use `domain.report_keys.host_fit_dimension` as the report key when configured, otherwise use `host_fit`. Use `not_assessable` when no host policy exists.

Log supported friction as `hesitation`, `attention_split`, `discontinuity`, `spatial_disconnect`, `surprise`, `pressure`, `rhythm_break`, or `confidence_loss`. Attach the observed trigger and task impact. Use `spatial_disconnect` only for the compound visible-correspondence failure defined above.

## Verdicts and bounded hypotheses

- `smooth`: the complete chain is predictable, legible, recoverable, and stable across repetitions.
- `minor_drag`: completion remains dependable with a localized pause, re-read, extra navigation, or recovery search.
- `rough`: recurring friction or a state break interrupts momentum, but the path remains recoverable.
- `broken`: a complete trace shows that the primary task or recovery cannot complete, or no trustworthy next action exists.
- `not_assessable`: required evidence is absent; name the missing phase or transition without implying a defect.

Propose zero, one, or at most two hypotheses. Each must improve causal linkage rather than merely increase motion, describe a behavioral or structural change, name the expected feel effect and tradeoff, and include an identical-condition proof plan. Do not prescribe fixes for unobserved production behavior.

## Human check and handoff

Include exactly three unanswered human-check prompts about recognition of the next target, real-user hesitation/confidence loss, and expected recovery. Set `status: unanswered` and `answer: null`.

Return YAML matching the template. Include policy provenance, all six phases, R1/R2 action-result linkage, coverage, facts/inferences, friction, dimension verdicts, bounded hypotheses, limitations, and `$ui-review` routes. End after reporting; do not implement a fix.
