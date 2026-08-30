# UI feel iteration protocol

Use this protocol after a human authorizes one supported hypothesis from `$ui-feel-review`. It protects the causal comparison and never substitutes for an independent follow-up review.

## 1. Admission and stop conditions

Record the report identifier, policy fingerprint when present, selected hypothesis ID, authorization text, affected task/surface, slice, and evidence IDs. Require a behavioral or structural cause and an identical-condition proof plan. For a legacy report without a fingerprint, record a compatibility warning and verify repository, surface, condition, and proof plan against the current profile before reproducing the baseline.

Clear assent to the immediately preceding single recommendation or a direct implementation request is sufficient when one supported hypothesis and scope are unambiguous. Do not require hypothesis-ID repetition or a second confirmation.

Stop before editing when:

- supported hypotheses compete, authorization/scope is ambiguous, or requested scope materially differs;
- the affected evidence is absent, unsupported, `not_assessable`, or `insufficient`;
- an essential phase or required host transition for the selected slice is missing;
- the exact evidence locator, data state, environment, display mode, starting state, or repeated sequence cannot complete;
- required outcome/recovery behavior is evidence-provider-blocked and the change would depend on guessing;
- the project profile is missing/invalid or its current fingerprint materially invalidates the report. A missing fingerprint in an otherwise complete legacy report is not by itself a stop condition.

Report the blocker and route to fresh evidence or `$ui-feel-review`. Leave the worktree untouched apart from configured ignored evidence output.

## 2. Freeze one condition

Create one condition key containing:

`policy_fingerprint + provider + locator + data_state + environment + display_mode + starting_state + required_host_transitions + interaction_sequence`

Use the nearest existing workflow evidence definition from the surface brief. Follow the profile's data policy. Do not change the condition or interaction order between baseline and after runs. Use the report's repetition count, never fewer than two when judging repeated-task feel.

## 3. Establish the baseline

Before editing, perform the intended input/host path in the configured rendered environment. For every repetition record:

1. `orient_predict`: target, configured context anchors, current state, and predictable next response;
2. `act`: exact control/input, focus or selection, and observed extra step;
3. `acknowledgement`: immediate visible acceptance, ignored action, duplicate, or ambiguity;
4. `pending`: intermediate state, or `not_observed` only when inapplicable;
5. `outcome`: visible success, failure, unchanged state, or context loss and its wording/control;
6. `next_action_recovery`: next target, retry, undo, cancellation, retained input, and retained context.

When the hypothesis concerns spatial or causal linkage, also record semantic identity, visual correspondence, origin/result position, peer context, intermediate path, independent retained visible anchor, and focus/scroll. Use evidence IDs that distinguish baseline/after, repetition, and phase.

Use ordered observations rather than invented duration. Missing or provider-blocked evidence is insufficiency, not a product defect. Restore the same starting state before every repetition and do not coach later passes.

## 4. Make the causal change

Map every edit to the accepted hypothesis. Prefer this order:

1. structure and information hierarchy;
2. interaction path, input, focus, and selection;
3. state continuity, action-result continuity, acknowledgement, pending, outcome, and recovery;
4. restrained configured token-based decoration needed for causal legibility.

Use only the profile's editable roots. Reuse configured shared components and tokens. Preserve configured context anchors, host conventions, domain terms, non-color meaning, user input, asynchronous state, and protocol contracts. Never hand-edit configured generated paths.

Keep workflow evidence-definition changes minimal. Do not add duplicate scenarios when an existing one reproduces the slice. Follow dependency policy and exclude unrelated cleanup, broad restyling, speculative gates, and refactors.

## 5. Recapture and compare

Repeat the exact condition and number of repetitions. Compare facts:

- visible target/state and action order;
- acknowledgement, pending, outcome, and recovery;
- focus, selection, configured context anchors, and retained input;
- origin-result visual correspondence, peer context, path, and retained visible anchor;
- wrapping, truncation, overflow, density, and configured display modes;
- host transitions and changed workflow evidence state.

If the condition or policy fingerprint drifts, record the limitation and do not claim an effect. Do not convert objective differences into a feel verdict.

## 6. Validation and rollback handoff

Run the smallest relevant test, then every applicable configured validation command. Record the command ID and exact argv. If a command is unavailable or unrelated dirty work prevents it, record the exact reason without rewriting unrelated changes.

Describe rollback as the smallest reversible file set. Derive regression watchpoints from the accepted hypothesis, configured context anchors, asynchronous behavior, focus/input, constrained conditions, display semantics, host transitions, and protocol compatibility. Keep the independent-review request open until a fresh report evaluates the same policy fingerprint and condition.
