# Coding standards

The `code-review` skill checks these judgement calls on each diff ([ADR 003](./adr/003-coding-standards-as-a-review-baseline.md)). oxlint checks the mechanical rules ([ADR 007](./adr/007-oxlint-before-the-coding-standards.md)).

## Logs

- A module takes its logger as a parameter. The distribution makes the one root logger with `createLogger()` of `packages/host/src/logger.ts`, and passes a child of it.
- A child logger names its module, and the thread id and the worker name when it has them: `child({ module: 'agents', threadId, name })`.
- A secret never enters a log line, even with redaction on. Redaction is the safety net.
- The logger redacts each key of `SECRET_KEYS` in `packages/host/src/logger.ts`, and each key that the distribution passes as `secretKeys`. A secret that Workcell carries under a new key adds that key to `SECRET_KEYS`.
- A TanStack activity gets its logs through `toTanStackLogger(log)` of `packages/core/src/host/tanstack-logger.ts`.

## Secrets

- A module takes a secret as a parameter, from the object that `loadSecrets()` returns. It never reads a secret from `process.env` or the Keychain.
- A package that needs a secret exports its names, such as `SLACK_SECRET_NAMES`. The distribution adds them to the names it gives `loadSecrets()`.
- An error names the secret, never its value.

## Boundaries

- A call that only macOS has stays in the Keychain store, the launch agent and the keep-awake service of `@workcell/host`. A host on another system then swaps one place.
- A vendor feature sits behind one of our interfaces. A call site never imports the vendor SDK directly.

## TanStack

- A helper, an option or a hook that redoes what a TanStack package ships is a finding. Name the TanStack API that replaces it: `ctx.logger` for a logger passed into a plugin, `onTurnStart` for per-turn state reset in middleware, `ctx.state` for plugin state kept by hand.

## Tools

- A tool input that lands in a URL, a file path or a command is checked in code against what the tool may reach: the list of allowed resources, and each `.`, `..` or empty path segment. `fetch` and the shell resolve a `..` segment, encoded or not, out of the allowed scope.
- A host tool whose result can pass the bound of `boundToolOutput()` returns its output a page at a time, with `offset` and `limit` and a note that names the next offset. A result that the bound cuts, with no way to read the rest, is a finding.

## Tests

- A test of the default run never reaches a model, Slack, Linear or GitHub. Harness logic runs on `fakeText()` ([ADR 010](./adr/010-how-we-test-the-agent.md)).
- A Workcell package holds no live test: its default run takes every `*.test.ts` file. A test that calls a real model lives in a distribution.
