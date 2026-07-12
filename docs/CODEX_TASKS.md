# Codex task templates

`AGENTS.md` supplies stable repository rules automatically. A new task should add only the context that changes for that task: desired behavior, reproduction, constraints, references, and verification.

## Start-of-chat checklist

Ask Codex to:

1. inspect `git status` and preserve unrelated work;
2. read `README.md`, `AGENTS.md`, and the relevant document under `docs/`;
3. identify the smallest source area that owns the behavior;
4. reproduce or inspect the current state before editing;
5. report the validation commands and results after editing.

## General implementation

```text
Implement the following change in GitLab Review Workspace.

Goal:
- <user-visible behavior>

Scope:
- <screen, command, or flow>

Constraints:
- Preserve existing Host/Webview message typing.
- Do not edit generated files directly.
- Keep unrelated behavior unchanged.

Acceptance criteria:
- <observable result 1>
- <observable result 2>
- <edge state>

Before editing, inspect the current implementation and summarize the intended change.
After editing, run npm run check and the smallest relevant tests. Run npm test before completion.
```

## Bug fix

```text
Fix this bug.

Observed:
- <what happens>

Expected:
- <what should happen>

Reproduction:
1. <step>
2. <step>
3. <step>

Relevant state/log/screenshot:
- <attach or describe>

Constraints:
- Keep the fix minimal.
- Add a regression test when feasible.
- Do not change the public message shape unless required.

Reproduce or trace the cause before editing. Then implement the fix and rerun the reproduction plus relevant checks.
```

## UI improvement

```text
Improve the <Sidebar / review file / commit diff> UI.

User goal:
- <what the reviewer should understand or do faster>

Current problem:
- <hierarchy, density, contrast, state, or interaction issue>

References:
- <attach current screenshot>
- <attach target/reference screenshot and say what to borrow>

Required states:
- <selected / pending / resolved / empty / error / etc.>

Constraints:
- Follow docs/UI_DESIGN.md.
- Keep GitLab/Pajamas semantics and VS Code theme compatibility.
- Reuse shared components and tokens.
- Do not add decorative UI without a functional role.

Before editing, audit the current state and state the design decision.
After editing, verify light and dark themes at the relevant sizes from docs/UI_DESIGN.md and provide screenshots or a precise visual QA report.
```

## Protocol or state change

```text
Change the following Extension Host/Webview behavior:

Behavior:
- <desired flow>

Affected messages/state:
- <known types or unknown>

Compatibility constraints:
- <what existing behavior must remain>

Trace the complete flow from Vue action through src/webviewProtocol.ts, the provider/panel handler, ReviewStore, and back to rendered state before editing.
Keep the protocol typed and update every sender/receiver together. Add focused tests for pure state/model behavior and run npm test.
```

## Review-only task

```text
Review the current working tree without modifying files.

Focus on:
- correctness and regressions;
- Host/Webview protocol consistency;
- GitLab error and pending states;
- dark theme, narrow layout, and accessibility for UI changes;
- missing or weak tests.

Report findings by severity with exact file and line references. If there are no actionable findings, state that explicitly and list remaining validation risks.
```

## Useful attachments

- Current VS Code screenshot including surrounding editor chrome
- Light and dark versions of the same state
- GitLab reference screenshot with the desired details annotated
- Exact MR/file/thread state needed to reproduce the issue
- Console output or error text
- A sample with realistic long paths and comments

