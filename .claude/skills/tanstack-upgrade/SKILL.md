---
name: tanstack-upgrade
description: Move the `@tanstack` packages of the catalog to their latest release, then audit the whole project from scratch against what TanStack ships today. Use when a TanStack release lands, an issue upgrades a `@tanstack` package, or the user asks what TanStack now covers.
argument-hint: '[upgrade issue number]'
---

# TanStack upgrade

Workcell is built on TanStack AI, its harness and its plugins. Each release can delete code of ours, and each new package can be a new feature. Run the upgrade as a **maintainer** of TanStack: you know the release from its changelog to its source diff, and every module of ours stands trial against it. The direction of the project is a hypothesis that each release can refute.

A **hand-made part** is code of ours that does what a TanStack API does, or does with an option. The run ends with every hand-made part named and judged.

The **window** of a package runs from its pin in the catalog of `pnpm-workspace.yaml` to its latest release on npm. A project that runs Workcell from a parent workspace keeps its own catalog in step with this one.

The work lives on its upgrade issue, `$ARGUMENTS`. Without one, draft the issue first.

## 1. Inventory

- **The packages.** Each `@tanstack/*` entry of the catalog, its pin, and `npm view <package> version`.
- **The new packages.** List the releases of each TanStack repository that the catalog draws from (`npm view <package> repository.url`) with `gh release list -R TanStack/<repo> --limit 200`, back to the oldest pin. A package in that list and absent from the catalog is new to us: a plugin, a provider, an adapter, a tool.
- **The last audit.** `git log -G"'@tanstack/" --oneline -- pnpm-workspace.yaml` lists the past upgrades. Read `audit.md` next to this skill, the audit of the latest one: each part it kept and each upstream gap it named face this release again. The first run finds no audit.
- **The upstream threads.** Each discussion, issue and pull request that we opened on a TanStack repository, with its state. Run this once with `type: DISCUSSION`, once with `type: ISSUE`:

  ```sh
  gh api graphql -f query="{ search(query: \"repo:TanStack/<repo> author:$(gh api user -q .login)\", type: DISCUSSION, first: 50) { nodes { ... on Discussion { number title closed url } ... on Issue { number title state url } ... on PullRequest { number title state url } } } }"
  ```

Done when each package has its window, each new package is listed, and each upstream thread has its state.

## 2. Bump

Move every `@tanstack` pin to its latest release, then run `pnpm install`. Every other dependency stays out of the upgrade.

- Run `pnpm peers check` here and on the base: a new line is a finding of step 4.
- A 0.x package breaks its API on a minor release: the typecheck shows where.
- Run `pnpm docs:tanstack`.

Done when the lockfile holds one version of each catalog package, and the docs mirror shows the latest releases.

## 3. Read the window, A to Z

For each package that moved, read every entry from the pin to the latest, in full:

1. **The changelog**: `packages/<dir>/CHANGELOG.md` of its repository (`npm view <package> repository.directory`), and each pull request an entry links. Its body gives the why, the limits, and what it left out.
2. **The source diff**: `npm diff --diff=<package>@<pin> --diff=<package>@<latest> src skills`. Read each new export, each new option of an API we call, and its JSDoc.
3. **The skills diff**: a changed `skills/**/SKILL.md` in the same diff is the maintainers showing agents a new way to use the package. Read it in full.
4. **The docs**: each page of `.tanstack-docs/*/llms.txt` added or updated inside the window, and each page the changelog links.

Each new package of step 1 gets its README and its docs pages read the same way.

Write the **release digest**: one line per change, with its API name and the module of ours it can touch.

Done when every changelog entry, every new export and every page updated in the window has its line in the digest.

## 4. Audit from scratch

The digest opens the audit, and the whole project is its scope. Each folder of `packages/*/src` faces the TanStack of today, whatever an earlier issue settled. An old API we never adopted counts as much as a new one. Split the folders across subagents, each one given the digest, `.tanstack-docs/`, the installed source and `AGENTS.md`.

Each module gets one verdict:

- **delete**: a TanStack API covers the hand-made part. The code goes, and the commit names the API.
- **adopt**: a TanStack feature serves a rule of `AGENTS.md`. It lands in this diff, or a new issue carries it.
- **re-route**: the docs build the same thing another way: a host, a worker, a durable session, an approval, a sandbox, a plugin. Name the page and the gap, then move to the TanStack way, or keep ours with the `AGENTS.md` rule that holds it.
- **keep**: TanStack cannot cover it. Name why, read in the installed source.
- **upstream**: only a TanStack change can fill the gap. Draft the issue or the discussion.

Each option we set away from a TanStack default holds one of the five reasons of `AGENTS.md`, or goes back to the default. Each new package of step 1 gets a verdict too: adopt, or the rule it fails to serve.

Done when every folder, every non-default option and every new package carries a verdict, and each **keep** names its reason.

## 5. Issues

Read each open issue of the repository (`gh issue list --state open`). An issue whose plan a release changes, simplifies or makes obsolete gets its update drafted, so its cold reader starts on the latest API. Each **adopt** or **re-route** too big for this diff gets a new issue drafted.

Done when every open issue is read and each change is drafted.

## 6. Hand-off

The diff keeps the behaviour of Workcell the same. ADR 010 picks the test runs, and a move of an `ai-sandbox*` package changes what a sandbox runs.

Show, in this order:

1. The pins that moved, and the new packages.
2. The release digest.
3. One line per verdict.
4. The drafts: the issue updates, the new issues, the upstream threads, and the new `audit.md`.

`audit.md` holds the verdicts and the upstream drafts, so the next run reads it in step 1. This run replaces it in full. Every issue write and every upstream thread waits for the user's go, because GitHub posts them under the user's account.
