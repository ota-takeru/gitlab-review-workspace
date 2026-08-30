# UI project profile contract

Use a project profile to keep product, host, evidence, and repository rules out of the reusable skill.

## Resolve the profile

Resolve the repository root first. Then select the first existing profile in this order:

1. a path explicitly supplied by the user;
2. `.agents/ui/profile.yaml`;
3. `docs/ui/project-profile.yaml` for compatibility with existing projects.

Run `node <skill-dir>/scripts/resolve-profile.js --root <repository-root>` and use its resolved path, schema version, compatibility mode, and SHA-256 fingerprint. Review-only work may continue with generic defaults when no profile exists, but must report `policy.status: absent`. Implementation work must use `--require-implementation` and stop before editing when the profile is missing or invalid.

## Apply precedence

Apply rules in this order:

1. Keep the skill's evidence-integrity and reviewer/implementer boundaries fixed.
2. Apply generic defaults only for fields omitted by the project.
3. Apply the project profile.
4. Apply the relevant surface brief to narrow the task and add required states.
5. Apply the user's task-specific scope without silently weakening the review method.

A surface brief may add evidence requirements but must not remove a project hard gate. If the user requests a materially different method, report that the result is outside this skill's review contract rather than labeling it a conforming review.

## Preferred schema

Use `schema_version: 1`. Keep narrative rationale in referenced Markdown documents and keep enforceable routing in the profile:

- `contracts`: documents to read, visual-quality contract, and surface-brief paths;
- `adapters`: evidence providers and host/runtime types;
- `domain.context_anchors`: identities that must survive navigation and asynchronous work;
- `domain.reference_systems`: named products or design systems and exact traits to borrow;
- `evidence`: data policy, capture command, lanes, themes, viewports, required states, and repetition count;
- `evaluation`: score range, weighted axes, hard gates, and prioritization rules;
- `implementation`: editable roots, generated paths, shared UI/token sources, protocol contracts, and dependency policy;
- `validation.commands`: condition, command ID, and `argv` as a non-empty string array.

Commands must use `argv` arrays rather than shell command strings. Paths are repository-relative unless explicitly marked otherwise. Weighted axes must have unique IDs and total 100. Hard gates must have unique IDs.

Legacy `version: 2` profiles remain readable in compatibility mode. Do not rewrite a legacy profile during review-only work.

## Preserve report provenance

Every review and iteration record must include:

- profile status and resolved path;
- schema version and compatibility mode;
- profile fingerprint;
- selected adapters;
- configuration warnings or generic fallbacks.

An iteration must compare the report fingerprint with the current profile. Stop and request a fresh review when a material policy change invalidates the accepted evidence or proof plan.

## Fixed integrity rules

Projects may strengthen but not disable these rules inside the profile:

- never fabricate observations, timing, participants, or user emotion;
- keep facts separate from inferences;
- treat missing evidence as a limitation rather than a product defect;
- exclude credentials and unauthorized private data from evidence;
- keep review-only skills read-only;
- preserve the same condition before and after an implementation;
- require an independent follow-up review before claiming improvement;
- distinguish semantic identity from visible action-result correspondence.
