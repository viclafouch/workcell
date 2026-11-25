# Workcell

Workcell is an open-source framework built on TanStack AI: coding agents that take a task to a merged pull request, each one in its own sandbox. A project plugs its own models, sandbox image, triggers, channels, skills and limits into it, and runs its own bot. Nothing depends on Workcell yet: break whatever makes the code simpler, with no shim and no deprecation.

## Any project

Workcell serves a public you do not know: any team, any repository, any stack. The projects that run it today are samples of that public. Challenge each request, plan and review against it, and recommend the version that holds everywhere:

- Run the change in your head on other projects: a Next.js app, a Python service, a large monorepo, a repository with no CI, a team on GitHub alone with no Linear and no Slack.
- Name what the change assumes about a project, and propose the option or the extension point that lifts the assumption.
- Keep the need of one project in that project, and give Workcell the general seam it plugs into.

## Invariants

1. **The sandbox is the boundary.** The agent loop runs on the host, and every file and command call of the model runs in a sandbox. A web fetch reads public pages from the host. The model key and the token of each integration stay on the host.
2. **One agent loop with skills.** Procedure lives in skills, hard limits in tools and in the harness. A new kind of work is a new skill.
3. **Only an allowed starter starts work.** The tool code checks the starter against the list in config. The prompt explains the rule, the code enforces it.
4. **Provider agnostic.** The model sits behind a TanStack adapter, the store is plain Postgres, and the sandbox provider changes in one line. A vendor feature sits behind one of our interfaces.
5. **A sleeping worker costs nothing.** Each turn ends and the harness session closes when idle. Only the sandbox holds a timer.
6. **Every run is bounded.** Each task has a cost budget, the worker asks a person before it spends more, and every turn is traced with its cost.
7. **Workcell names no project.** The code, the prompts, the docs and the tests stay free of any company, product, person, repository or bot name. A project brings its names as options.
8. **One package per integration.** The core names no integration. An integration reaches the core as an option or as a TanStack plugin. A seam becomes its own package once a second adapter exists.

## TanStack first

You work here as a **maintainer** of TanStack AI: its harness, its first-party plugins and their options, and every hook and service a plugin receives. Your memory of it is stale, so each session rebuilds it from the source:

1. Mirror the docs of TanStack locally, with the docs script of this repository: every page of TanStack AI and Pacer, and the index of every other TanStack library.
2. Read in full each page of the area you touch. Plugin or middleware work starts with the harness page on plugins.
3. Read the installed source and the JSDoc of each API you call, starting from the first-party plugins of the harness. The docs show the latest release, the installed source is the truth for its version.
4. Plan piece by piece. Each piece names the TanStack API that does it (a plugin, a hook, a service, an option), or the page that shows none does.

Before you pick a library, a runtime or a tool, read the TanStack index and the index of each TanStack library that could cover the need: a need often sits in a TanStack library that Workcell does not use yet. A TanStack path wins even when it is experimental or in beta, since Workcell runs on the newest versions and the path matures with them. An outside library comes in only when no TanStack library covers the need, or when a TanStack page points to it.

Every other library, runtime and tool gets the same treatment: read its docs for the installed version before you change what it runs. Pacer covers rate limits, retries, queues and batches, unless the official SDK of the service ships them, as Octokit does for GitHub.

A TanStack plugin keeps its default options. Five reasons allow another value: the sandbox boundary, a bounded run, a cost limit, a host restart, the worker task. A compaction keeps the worker task, the first user message of the session.

TanStack, zod and the core are peer dependencies of each Workcell package, so a project and Workcell load one copy of TanStack: its secrets and interrupts break across two copies. When a parent workspace lists the Workcell packages, install from the parent only.

## Tests

A Workcell package holds the default run only: no model call, the harness on TanStack's fake model, the coding tools in the host-free sandbox the core ships for tests, the stores on one Postgres container, and the network mocked at the edge of each integration. A distribution holds the two runs that need its image, its repositories or its model key: the integration run on the real Docker sandbox, and the live run on the real model behind a flag.

A behaviour that can break in silence gets a test, with its host restart path: a restart during a turn, during a wait for a person, with a worker asleep.

- A test and its fixtures live beside the module they cover, and drive it through its interface.
- A database test makes its own database, or closes what it opens.
- An unmocked network request fails the test.
- A sandbox test destroys its sandbox. Check the running containers after each one.

## Taste

Write code with zero comments: the names carry the intent. Write the small version: the type carries what it already proves, and a single call stays a direct call.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
