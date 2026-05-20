# Goal Skill

Last updated: 2026-05-21  
Purpose: reusable guide for writing implementation goals that are focused,
verifiable, and safe for long-running agent work.

## What A Good Goal Looks Like

A good goal is bigger than a prompt but smaller than an open-ended backlog.
It should give the agent enough context to execute, verify, and stop without
silently expanding scope.

Use these seven sections when writing goals:

1. One outcome
2. Verifiable end state
3. Relevant context
4. Constraints and non-goals
5. Validation loop
6. Checkpoint behavior
7. Stop rules

## Recommended Docs Layout

Use feature folders under `docs/features`:

```text
docs/
  features/
    feature-name/
      README.md
      v1/
        implementation-plan.md
      v1.1/
        follow-up-plan.md
```

Rules:

- Put long-lived feature planning under `docs/features`.
- Keep each version focused on one deliverable.
- Use `README.md` for feature overview and version links.
- Use `v1/implementation-plan.md` for the goal-ready execution plan.
- Use follow-up version folders to prevent scope creep in V1.

## Goal-Ready Template

Copy this into a feature implementation plan and fill it in:

```markdown
# <Feature Name> V<Version> Implementation Plan

Last updated: YYYY-MM-DD
Status: goal-ready / draft / implemented

## Goal-Ready Prompt

/goal Implement <Feature Name> V<Version> end-to-end.

Read this document first:
docs/features/<feature-name>/v<version>/implementation-plan.md

Objective:
- <one clear outcome>

Required behavior:
- <behavior 1>
- <behavior 2>
- <behavior 3>

Do not implement:
- <non-goal 1>
- <non-goal 2>
- <non-goal 3>

Definition of done:
- <verifiable end state 1>
- <verifiable end state 2>
- <test/build/check passes or blocker is documented>

## One Outcome

<Focused scope. Larger than a single prompt, smaller than a backlog.>

## Verifiable End State

- [ ] <binary completion criterion>
- [ ] <binary completion criterion>
- [ ] <binary completion criterion>

## Relevant Context

Supporting materials:

- <docs>
- <files>
- <issue links/logs>
- <specs/commands>

Files to inspect first:

```text
<path>
<path>
```

Likely files to change:

```text
<path>
<path>
```

## Constraints And Non-Goals

Explicitly do not:

- <boundary>
- <boundary>
- <boundary>

## Validation Loop

Automated checks:

```bash
<test command>
<build command>
<typecheck/lint command>
```

Manual checks:

- <manual smoke>
- <artifact inspection>
- <browser/playwright check if relevant>

## Checkpoint Behavior

Work milestone by milestone:

1. <milestone>
2. <milestone>
3. <milestone>

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving on;
- keep a short progress log;
- stop only when the objective is met or a blocker is explicit.

## Stop Rules

Stop and report instead of expanding scope when:

- the objective is already met;
- required context is missing;
- validation fails for an external/environment reason;
- implementing the next step would require a non-goal;
- the repo shows a conflicting design that invalidates this plan.
```

## Goal Prompt Checklist

Before starting `/goal`, confirm the plan has:

- One outcome.
- Binary completion criteria.
- File/doc/context references.
- Explicit non-goals.
- Validation commands.
- Manual checks if UI or artifacts are involved.
- Checkpoint behavior.
- Stop rules.
- A clear place for unresolved decisions.

## Agent Handoff Rules

When handing a goal to another agent:

- Tell it to read the feature plan before editing.
- Tell it to inspect the listed files before changing code.
- Tell it not to implement deferred versions.
- Tell it to follow existing repo patterns.
- Tell it to ask only about unresolved decisions.
- Tell it to preserve unrelated dirty worktree changes.

## Anti-Patterns

Avoid goals that say:

- "Improve the app."
- "Finish the feature."
- "Make it production ready."
- "Refactor as needed."
- "Add everything from the roadmap."

Replace them with a specific outcome, concrete routes/files/contracts, and
explicit validation.

