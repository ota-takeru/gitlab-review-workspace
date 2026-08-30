---
name: ui-feel-iterate
description: Implement one supported, evidence-backed interaction-feel hypothesis from a completed $ui-feel-review report in any configured UI project after clear human assent to the immediately preceding single recommendation. Use when the exact rendered condition is reproducible and a valid project profile defines source boundaries, generated paths, dependency policy, and validation commands; preserve state and action-result continuity, prove the same condition before and after, and hand the final feel judgment to a fresh $ui-feel-review. Stop for ambiguous authorization or scope, competing hypotheses, unsupported evidence, policy drift, or missing proof.
---

# UI Feel Iterate

Implement one bounded interaction-feel change; do not act as the reviewer. Convert one authorized causal hypothesis into a narrowly scoped project change and objective handoff. Never award a feel verdict or claim that the hypothesis succeeded.

## Gate the request and project policy

Require all of the following:

- a completed `$ui-feel-review` report, or equivalent artifact, with evidence IDs, exact condition, coverage, and hypothesis. Prefer policy provenance; accept a legacy report without a fingerprint when every other admission field is complete;
- exactly one supported hypothesis with an unambiguous task, affected slice, and scope;
- clear authorization for that recommendation. A direct implementation request or natural-language assent to the immediately preceding single recommendation is sufficient; never require literal hypothesis-ID repetition or a second confirmation;
- a supported slice not marked `not_assessable` or `insufficient`, with every essential phase and host transition needed by the change;
- an identical-condition proof plan and reproducible rendered evidence source;
- a valid implementation-capable project profile.

Before editing:

1. Read [references/project-profile.md](references/project-profile.md) and [references/iteration-protocol.md](references/iteration-protocol.md) completely.
2. Resolve the repository root, inspect `git status`, and run `node <skill-dir>/scripts/resolve-profile.js --root <repository-root> --require-implementation`. Pass `--profile <path>` when supplied.
3. Read every configured contract, the relevant surface brief, nearest workflow evidence definition, affected source, shared UI/token sources, and protocol contracts that cross a boundary.
4. Compare the current profile fingerprint with the review report. Stop for material policy drift that changes evidence, scope, gates, source boundaries, or proof requirements. When a legacy report has no fingerprint, record `legacy_report_without_policy_fingerprint`, verify its repository, surface, condition, and proof plan against the current profile, and require exact baseline reproduction; do not reject it solely for missing new provenance.

Stop without editing when hypotheses compete, authorization or scope is genuinely ambiguous, the affected slice is unsupported, requested scope materially differs, profile validation fails, or the exact proof cannot be reproduced. A `partial` report may proceed only for a slice explicitly supported by the report with a complete reproducible proof plan.

Default to one causal hypothesis per iteration. Tightly coupled edits needed to test it may share the iteration; never combine unrelated feel, visual, accessibility, dependency, or refactor work. Preserve unrelated dirty changes.

## Freeze and reproduce one condition

1. Freeze the report's provider and locator, data/fixture state, viewport or host environment, display mode, starting state, required host transitions, interaction sequence, repetitions, and relevant action-result linkage observations.
2. Run the real configured interaction at least as many comparable repetitions as the proof plan requires. Capture baseline evidence using the configured data policy and output path.
3. Trace orient/predict, act, acknowledgement, pending, outcome, and next action/recovery. Record visible state, configured context anchors, focus/selection, user input, asynchronous feedback, extra steps, action origin/result, visual correspondence, and artifacts.
4. Do not edit until the exact condition and every phase required by the selected hypothesis are reproducible. Missing fixture/native-host behavior is an evidence gap, not permission to guess.

## Implement from evidence

1. Map every intended edit to the accepted hypothesis and evidence IDs.
2. Work only inside `implementation.source_roots`. Never hand-edit `implementation.generated_paths`; regenerate them only through configured commands when required.
3. Prefer structure and information hierarchy, then interaction/input behavior, then state and action-result continuity, then only the restrained token-based decoration needed to make the causal state legible.
4. Reuse configured shared component roots and semantic token sources before adding components or tokens.
5. Preserve configured host conventions, domain vocabulary, context anchors, accessibility, visible focus, retained user input, pending acknowledgement, outcome, recovery, and protocol contracts.
6. Follow the configured dependency policy. Do not add a production dependency, create one-off styling systems, send unsafe content across a boundary, or perform speculative cleanup outside the accepted hypothesis.
7. Update the nearest workflow story, fixture, scenario, or test definition only when needed to reproduce the accepted slice. Keep synthetic/test data typed or structurally valid and compliant with the data policy.

## Recapture and compare

1. Re-run the exact baseline condition with the same number of repetitions.
2. Record fact-only before/after differences: target/state, action order, acknowledgement, pending, outcome, recovery, focus/selection, user input, context-anchor continuity, action-result visual correspondence, wrapping/overflow, display-mode behavior, and host transitions.
3. If the condition drifts or the after run cannot complete, record the limitation and do not claim an effect.
4. Never call the result smooth, successful, improved, or fixed. A fresh independent `$ui-feel-review` must judge the same condition.

## Validate and hand off

Run every applicable `validation.commands` entry exactly as configured, plus the smallest relevant test during iteration. Record command ID, argv, result, and any command not run with its reason. Do not rewrite unrelated changes to make validation pass.

Use [assets/UI_FEEL_ITERATION.template.yaml](assets/UI_FEEL_ITERATION.template.yaml). Include policy provenance, accepted hypothesis, exact condition, baseline/after artifacts, objective comparison, files changed, validation, rollback/regression risks, and evidence limitations. Set `feel_verdict: pending_independent_review`, request a fresh `$ui-feel-review` with the identical profile fingerprint and condition, and route hard functional/accessibility gates to `$ui-review`.

End by handing off; do not self-award the hypothesis.
