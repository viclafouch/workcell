# workcell

In this file, **you** is the agent reading it.

Workcell is a framework: a project plugs its own models, sandbox image, triggers, channels, skills and limits into it, and runs its own bot. The work is early, and nobody depends on it yet: break whatever makes the code simpler, with no shim and no deprecation.

## What we never compromise on

1. **The sandbox is the boundary.** The agent loop runs on the host, and every tool call of the model runs in a sandbox through `sandboxWorkspaceBackend`. The model key and the tokens of each integration stay on the host.
2. **One agent loop with skills.** Procedure lives in skills, hard limits in tools and in the harness. A new kind of work is a new skill.
3. **Work starts from the allowed starters only.** The tool code checks the starter against the list in config. The prompt explains the rule, the code enforces it.
4. **Provider agnostic.** The model behind a TanStack adapter, plain Postgres, a sandbox provider that changes in one line. A vendor feature earns its place behind one of our interfaces.
5. **A sleeping worker costs nothing.** Each turn ends and the harness session closes when idle. Only the sandbox holds a timer.
6. **Every run is bounded.** Each worker has a cost budget per task and asks a person before it spends more, and every run is traced with its cost.
7. **Workcell names no project.** No company, product, person, repository or bot name in the code, the prompts, the docs or the tests. A project brings its names as options.
8. **One package per integration.** `@workcell/core` names no integration. An integration reaches the core as an option or as a TanStack plugin. A seam splits into a package only when a second adapter exists.

## Cost discipline

Before anything that polls, holds a connection, or calls a paid API, answer two questions out loud: does this let the database compute sleep, and how many model tokens does it spend.

- The model bills per token. Every worker turn, every live test and every eval run spends it.
- A serverless Postgres suspends an idle compute. A poll that writes, or a connection held open, keeps it awake and billed.
- GitHub, Linear and Slack limit API calls: batch each poll, and pace it with TanStack Pacer.

## Hit every surface

The most common defect of an agent host is a change that works on the happy path and breaks on a restart. Before calling a change done, walk this list and say which entries applied.

- **A host restart**: during a turn, during a wait for a person, with a worker asleep, with a sandbox alive.
- **Concurrency**: two workers at once, a turn queued, a reply during a turn, the same event delivered twice.
- **Who speaks**: an allowed starter, another person, a channel outside the allowed channels.
- **Failure**: a model error, a sandbox that fails to start, a network cut, an expired token.

## Research before writing

Your memory of a library is stale. Before you write, change or install anything that a library, a runtime or a tool runs, read its docs for the installed version: the page of each API, the changelog since the version you remember, and the guidance on performance, security and DX. Write what its maintainer would write today.

## TanStack is the foundation

You work here as a **maintainer** of TanStack AI: its harness, its first-party plugins, their options, and every hook and `ctx` service of a plugin. Your memory holds none of it, so each session builds it from the source:

1. Run `pnpm docs:tanstack`. It mirrors the `llms.txt` of TanStack AI and Pacer, and every page it lists, into `.tanstack-docs/`.
2. Read in full each page of the area you touch. Any plugin or middleware work starts with `.tanstack-docs/ai/docs/harness/plugins.md`.
3. Read the exports of `@tanstack/ai-harness/plugins` in the installed source, and the JSDoc of each API you call. The docs show the latest release, the installed source is the truth for its version.
4. Write the plan piece by piece. Each piece names the TanStack API that does it (a plugin, a hook, a `ctx` service, an option), or the page that shows none does.

A TanStack plugin keeps its default options. Five reasons allow another value: the sandbox boundary, a bounded run, a cost limit, a host restart, the worker task. A compaction never drops the worker task, the first user message of the session.

The `@tanstack/*` packages are peer dependencies of each Workcell package: a project and Workcell load one copy of TanStack. Secrets, interrupts and extension points break across two copies.

## Tests

[ADR 010](./adr/010-how-we-test-the-agent.md) sets the test runs and the moment of each one. A behaviour that can break in silence gets a test, its restart path included.

- A database test makes its own database, or closes what it opens.
- msw 3 fails an unmocked request with `listen({ onUnhandledFrame: 'error' })`.
- A sandbox test destroys its sandbox. Check `docker ps` after each one.

## Taste

Write code a person would write, with zero comments: the names carry the intent. When you catch a triple guard where the type already answers, or an abstraction wrapping a single call, name the real constraint and write the small version.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
