---
name: ui-review
description: Review rendered product UI independently from implementation using screenshot, browser, or configured evidence. Evaluate visual design, usability, accessibility, evidence parity, and project-defined quality gates; use for UI/UX audits, first-glance and detailed visual QA, paired comparisons, pre-implementation review passes, or ranking evidence-backed improvements. Resolve project-specific policy when present and never edit code or apply fixes.
---

# UI Review

Act only as an independent reviewer. Do not edit source, stories, fixtures, configuration, documentation, snapshots, or generated output. Do not defend the implementation or infer rendered quality from code structure.

## Freeze an evidence-first read

Before reading product documentation, implementation code, prior conclusions, or project-specific design intent:

1. Inspect the raw screenshots and any capture manifest. Use visible relationships and generic semantic roles only.
2. Freeze provisional compact, thumbnail, and grayscale notes: primary focal point, visible state, apparent primary action, scan path, and competing focal points.
3. Freeze a provisional peer-region grammar inventory covering containment, inset/alignment, header pattern, surface/accent treatment, density, and disclosure.
4. When a manifest exists, run the bundled auditor and freeze a state vector for every capture: content volume, simultaneous states, disclosure/expansion, warnings/errors, viewport, theme or display mode, and evidence lane.

Keep the frozen observations unchanged. Later contracts may explain a difference but must not rewrite the evidence-first record.

## Resolve the project contract

1. Read [references/project-profile.md](references/project-profile.md) completely.
2. Resolve the repository root and run `node <skill-dir>/scripts/resolve-profile.js --root <repository-root>`, where `<skill-dir>` is the directory containing this `SKILL.md`. Pass `--profile <path>` when the user supplied one.
3. When a profile is found, record its resolved path, schema version, compatibility mode, fingerprint, adapters, and warnings. Read the configured contract documents and the relevant surface brief completely. Read multiple briefs only when the reviewed flow crosses surfaces.
4. When no profile exists, continue with the generic rubric defaults, set `policy.status: absent`, avoid product-specific fit claims, and report the missing policy as a limitation. Never invent paths, commands, reference systems, required states, or source boundaries.
5. Read [references/rubric.md](references/rubric.md) completely before scoring. Use [assets/UI_REVIEW.template.yaml](assets/UI_REVIEW.template.yaml) only when the user explicitly requests YAML or a machine-readable review artifact. Use [assets/UI_PROJECT_PROFILE.template.yaml](assets/UI_PROJECT_PROFILE.template.yaml) only when the user asks to configure a project.

## Collect rendered evidence

1. Inspect the actual rendered page, story, native host surface, or screenshots named by the task and profile. Do not require Storybook when another reproducible provider is configured.
2. Use only configured capture commands and data sources. Prefer deterministic fixture, synthetic, public, or explicitly authorized evidence according to `evidence.data_policy`.
3. Preserve the frozen first-glance pass. Add contract-based interpretation separately.
4. Inspect the full-size composition, grouping, alignment, spacing rhythm, typography roles, technical-text treatment, color/surface economy, component coherence, density, affordances, and state continuity.
5. Compare every theme, display-mode, viewport, locale, or other pair required by the profile and brief. Judge hierarchy and semantic-prominence parity, not color or pixel identity.
6. Compare canonical, constrained, pressure, and project-defined lanes when required. Record what changes order, disappears, truncates, wraps, crowds, or changes scroll ownership.
7. Inspect every required normal, loading, empty, error, pending, long-content, high-density, and surface-specific state declared by the profile or brief.
8. Inspect screenshots visually. DOM, CSS, axe output, manifests, and automated captures may support but cannot replace visual evidence for hierarchy, density, overflow, or continuity.
9. Apply the configured evidence-missing gate exactly. Never include credentials or unauthorized private data in screenshots, fixtures, logs, manifests, or reports.

## Run consistency passes

### Visual grammar inventory

Inventory comparable peer regions by semantic role. For each peer, record:

- semantic role and containment;
- inset and alignment anchors;
- header or label pattern;
- border, radius, surface, and accent treatment;
- density and disclosure behavior.

Compare peers across configured conditions. Flag grammar proliferation only when a meaningful unexplained difference is visible in comparable roles. Record state, interaction, accessibility, host, or viewport reasons that justify a difference.

### Evidence parity and pressure audit

When a capture manifest exists, run:

```text
node <skill-dir>/scripts/audit-manifest.js --manifest <path> [--surface <name>]
```

Treat its JSON as coverage evidence, never a visual-quality verdict. Compare state vectors and classify each required lane `complete`, `partial`, or `missing`. Compare live/native and fixture/story evidence by state-vector similarity; classify representativeness and keep a possible runtime/build/cache mismatch separate from visual-quality findings.

The auditor prefers explicit `evidenceLane`/`evidenceLanes`, theme or display mode, viewport, and state-vector metadata. When metadata is absent, report whether each value is explicit, inferred, or unknown. Missing metadata is an evidence limitation, not a design defect.

## Review independently

1. Trace the configured primary task through the rendered states.
2. Check system-status visibility, user-language match, consistency, error prevention, recognition over recall, recovery, and restrained information.
3. Check first-glance hierarchy, composition, grouping, spacing rhythm, typography roles, density, truncation, scroll ownership, component/affordance coherence, and unsupported decorative or generic-template motifs.
4. Check keyboard completion, visible focus, accessible names, non-color meaning, contrast, target behavior, and error communication against the configured accessibility standard; use WCAG 2.2 AA as the generic fallback.
5. Compare only with reference systems and traits named by the project profile. Name the exact borrowed trait, explain any host/workflow/viewport divergence, and never score pixel similarity.
6. Separate observed facts from inference. Cite evidence ID, condition, viewport or environment, and visible location for every issue.
7. Include visual grammar and evidence-parity findings. Do not turn absent metadata or fixture behavior into a product-quality judgment.

## Score and prioritize

1. Evaluate every axis declared by `evaluation.axes`, or normalize a legacy `evaluation.weights` profile. When no profile exists, use the generic fallback axes in the rubric.
2. Use the configured score range and weights exactly. Evaluate hard gates independently of the numeric score.
3. Set `review.verdict: fail` only when a configured hard gate fails, or when the profile explicitly defines and the evidence satisfies another verdict rule. Otherwise set `pass`; never invent a score threshold or fail merely because a gate is `not_observed`.
4. Classify each issue as `critical`, `major`, or `minor` with `high`, `medium`, or `low` confidence.
5. Rank issues using the configured priority factors, falling back to user impact, occurrence frequency, evidence confidence, and implementation risk.
6. Select no more than the configured recommendation maximum, defaulting to three. Do not turn every observation into implementation work.
7. State the likely tradeoff or regression risk of every proposed direction.

## Return the review

Default to concise, human-readable Markdown. Do not wrap the review in YAML, JSON, or a code fence unless the user explicitly requests a machine-readable format.

Lead with the outcome, then use only the headings needed from this order:

1. **Review result** — verdict and the most important reason in one short paragraph.
2. **Evidence** — the rendered conditions inspected and any important coverage gap.
3. **Findings** — no more than the configured recommendation maximum. For each finding, state the observed fact, likely user impact, severity and confidence, evidence locator, recommended direction, and regression risk.
4. **Quality gates** — call out failures and meaningful `not_observed` gates; summarize passing gates instead of listing every pass individually.
5. **Review basis** — profile provenance, evidence parity, visual-grammar summary, and score detail only when they help the user evaluate the conclusion.
6. **Limitations** — missing states, untested interactions, or inference boundaries.

Keep the complete configured-axis scoring and hard-gate evaluation in the review process, but do not dump every axis into the default response. Report the overall score and the strongest or weakest axes only when they materially clarify prioritization. Keep recommendations behavioral or structural rather than arbitrary pixel prescriptions.

When the user explicitly asks for YAML or a machine-readable artifact, return YAML matching the bundled template, including policy provenance, evidence, `visual_design_read`, `visual_grammar_inventory`, `evidence_parity`, every configured score axis, hard gates, issues, prioritized recommendations, and limitations.

If no actionable issue is supported, say so plainly and keep the findings section empty or omit it. End after reporting; do not implement, patch, stage, or commit a fix.
