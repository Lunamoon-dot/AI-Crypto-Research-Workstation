# Goal Skill

Last updated: 2026-06-03  
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

## Recommended File Usage

Use this guide with any planning or implementation file. The goal document can
live wherever the surrounding work already belongs: a feature plan, design note,
issue write-up, refactor plan, migration checklist, incident follow-up, or other
project document.

```text
<any-path>/
  <goal-document>.md
```

Rules:

- Put the goal document where it is easiest to discover and maintain.
- Keep each goal document focused on one deliverable.
- Link related background documents instead of duplicating them.
- Split follow-up work into separate goal documents to prevent scope creep.
- Prefer precise file references over broad folder references.

## Goal-Ready Template

Copy this into the relevant goal document and fill it in:

```markdown
# <Goal Name> Plan

Last updated: YYYY-MM-DD
Status: goal-ready / draft / implemented

## Goal-Ready Prompt

/goal Implement <Goal Name> end-to-end.

Read this document first:
<path/to/this-goal-document.md>

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

- <documents>
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
- The exact goal document path.
- File/document/context references.
- Explicit non-goals.
- Validation commands.
- Manual checks if UI or artifacts are involved.
- Checkpoint behavior.
- Stop rules.
- A clear place for unresolved decisions.

## Agent Handoff Rules

When handing a goal to another agent:

- Tell it to read the specified goal document before editing.
- Tell it to inspect the listed files before changing code.
- Tell it not to implement deferred or related work unless it is explicitly in scope.
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
