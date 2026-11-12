# ADR 007 – oxlint Before the Coding Standards

## Status

Accepted

## Context

An oxlint rule reads each file on each run. It reports each match, and the same code always gives the same result.

The review agent reads a coding standard as text. It can miss a match, or report a match that does not exist.

A convention in both places drifts. The review then repeats oxlint, or keeps a line that oxlint already checks.

## Decision

### 1. A convention lands in oxlint first

A new convention looks for its rule in this order:

1. A native oxlint rule, or an option of one. A `no-restricted-imports` entry, with a message that names the helper to take, is the common case.
2. A rule of a JS plugin that the shared config, `@viclafouch/oxc-config`, already loads.
3. A rule of a JS plugin that the shared config does not load yet.

The convention goes to the coding standards only when no rule can express it. A rule cannot express the meaning of a name, a judgement across files, or a trade-off.

**Rationale**: oxlint catches each match. The review agent can miss one.

### 2. Each convention lives in one place

The change that enables a rule deletes the line of the coding standards that the rule replaces.

**Rationale**: a copy drifts. A review that repeats oxlint adds noise, and the developer reads oxlint first.

### 3. Each side checks the other

- A new rule in an `oxlint.config.ts`: search `CODING_STANDARDS.md` for the line that it replaces.
- A new line of `CODING_STANDARDS.md`: search the oxlint configs and the shared config for a rule that checks it. Propose a rule when none exists.

**Rationale**: no tool links a rule to the line that it replaces.

## Considered options

- **Conventions in the coding standards only**: the review agent is a model. It misses some matches, and each review costs tokens.
- **The same convention in oxlint and in the coding standards, as a safety net**: the copies drift, and the review repeats oxlint.

## Consequences

**The coding standards get shorter over time.** Each new rule deletes a line.

**The oxlint config of a package carries the locks of that package.** Each restricted import names the module that wraps it, such as `openDatabase()` for `pg`. Only that module, or a test, turns the entry off.

**A rule of the shared config costs a release.** Workcell gets the rule when its catalog bumps `@viclafouch/oxc-config`. A rule in the config of a package lands in the same change.

## Sources

- Matt Pocock, [the `retro` skill](https://github.com/mattpocock/skills/blob/d81f3a1/skills/engineering/retro/SKILL.md): "Default to building the check over writing the rule".
- [oxlint JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.md): a custom rule in JavaScript, with the ESLint plugin API.

## Other pages

- [ADR 003 – Coding Standards Are a Review Baseline](./003-coding-standards-as-a-review-baseline.md)
- [ADR 009 – An Agent Doc Says What the Model Cannot Guess](./009-an-agent-doc-says-what-the-model-cannot-guess.md)
- [The coding standards](../CODING_STANDARDS.md)
