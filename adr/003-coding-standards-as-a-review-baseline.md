# ADR 003 – Coding Standards Are a Review Baseline

## Status

Accepted

## Context

Coding rules that load while the agent writes code fill its context, and the models often ignore them. Path-scoped rules in `.claude/rules/` have a second limit: Cursor, Codex and OpenCode do not read them.

Matt Pocock gives the standards to the reviewer only: "don't put coding standards in your implementer agent". His `code-review` skill carries its own smell baseline.

## Decision

### 1. The review reads the standards

The judgement calls of Workcell live in `CODING_STANDARDS.md`, next to the root `AGENTS.md`. A `code-review` skill reads the file during a review only. `AGENTS.md` does not import it.

**Rationale**: a reviewer has a small context and one task. The implementer keeps its context for the code.

### 2. The file is where the review looks

The `code-review` skill walks up from each changed file to the first `AGENTS.md`, and reads the `CODING_STANDARDS.md` next to it. Each package of Workcell has no `AGENTS.md` of its own, so the root file covers every package.

**Rationale**: a file in another place, or one that no `AGENTS.md` sits beside, is a file the review skips.

### 3. The standards hold judgement calls only

`CODING_STANDARDS.md` holds no rule that a tool can check. [ADR 007](./007-oxlint-before-the-coding-standards.md) decides where a mechanical convention goes.

**Rationale**: a line that oxlint also checks drifts, and the review repeats oxlint.

## Consequences

**Workcell has no `.claude/rules/`.** A coding rule goes to oxlint or to `CODING_STANDARDS.md`.

**A rule of `CODING_STANDARDS.md` holds for Workcell code.** A rule of one distribution lives in the repository of that distribution.

## Sources

- Matt Pocock, [the `code-review` skill page](https://www.aihero.dev/skills-code-review.md) and [its `SKILL.md`](https://github.com/mattpocock/skills/blob/d81f3a1/skills/engineering/code-review/SKILL.md): the two axes, and the smell baseline inside the skill.
- Matt Pocock, [Fixing the PR Bottleneck, at 11:24](https://www.youtube.com/watch?v=LlgiOCmFG_w&t=684s): "don't put coding standards in your implementer agent".
- Matt Pocock, [the `retro` skill](https://github.com/mattpocock/skills/blob/d81f3a1/skills/engineering/retro/SKILL.md): "Default to building the check over writing the rule".
- [mattpocock/skills#1065](https://github.com/mattpocock/skills/issues/1065): the review skipped a `CODING_STANDARDS.md` that no `AGENTS.md` named.
- Claude Code, [memory, rules and `AGENTS.md`](https://code.claude.com/docs/en/memory): path-scoped rules, and nested files that load only when Claude reads a file in their directory.
- [VS Code custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions), [Cursor rules](https://cursor.com/docs/context/rules) and [OpenCode rules](https://opencode.ai/docs/rules/): the tools that do not read `.claude/rules/`.

## Other pages

- [ADR 007 – oxlint Before the Coding Standards](./007-oxlint-before-the-coding-standards.md)
- [ADR 009 – An Agent Doc Says What the Model Cannot Guess](./009-an-agent-doc-says-what-the-model-cannot-guess.md)
- [The coding standards](../CODING_STANDARDS.md)
