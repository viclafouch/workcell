# TanStack audit, November 2026

The audit of the upgrade that moved `@tanstack/ai-sandbox` from 1.2.1 to 1.3.0. Every other `@tanstack` pin was already at its latest release. The next run starts from here: each **keep** and each upstream gap faces its release again.

## Pins

| Package | Pin | Latest at the audit |
| --- | --- | --- |
| `@tanstack/ai` | 1.4.0 | 1.4.0 |
| `@tanstack/ai-anthropic` | 1.1.1 | 1.1.1 |
| `@tanstack/ai-compaction` | 1.0.1 | 1.0.1 |
| `@tanstack/ai-harness` | 0.3.0 | 0.3.0 |
| `@tanstack/ai-harness-cli` | 0.1.2 | 0.1.2 |
| `@tanstack/ai-mcp` | 1.2.0 | 1.2.0 |
| `@tanstack/ai-openai` | 1.1.1 | 1.1.1 |
| `@tanstack/ai-persistence` | 1.0.1 | 1.0.1 |
| `@tanstack/ai-sandbox` | 1.3.0 | 1.3.0 |
| `@tanstack/ai-sandbox-docker` | 1.1.0 | 1.1.0 |
| `@tanstack/ai-sandbox-local-process` | 1.0.0 | 1.0.0 |
| `@tanstack/ai-skills` | 1.0.2 | 1.0.2 |
| `@tanstack/intent` | 0.5.6 | 0.5.6 |
| `@tanstack/pacer` | 0.23.1 | 0.23.1 |

## Release digest

`@tanstack/ai-sandbox` 1.3.0, TanStack/ai#2136:

- `captureSandboxCheckpoint`, `restoreSandboxCheckpoint`: checkpoint and restore the files of any `SandboxHandle`, also under `sandboxWorkspaceBackend`. Touches `core/workers/changes.ts`, `core/workers/worker-sandbox.ts`.
- `sweepSandboxBlobs`, optional `SandboxCheckpointStore.deleteCheckpoints`, the store contract in TSDoc. Touches `core/store` only if a checkpoint store lands.
- Snapshots keep mode bits and symlinks, a link outside the workspace fails the capture, `exclude` runs first. Portable snapshots only.
- `withSandbox` with portable snapshots writes a best-effort checkpoint on error and abort. Workcell never runs `withSandbox`.
- `SandboxInstanceStore` invariants written down: optional fields absent from `get`, the last `upsert` wins. `core/store/sandbox-instance-store.ts` complies.
- Peer `@tanstack/ai` ^1.4.0. `pnpm peers check`: no new line (the `vitest ^4.1.10` peer was already unmet on the base).

## Verdicts

### delete

- `slack/worker-threads/worker-waits.ts`, the question part: `question()` already sets `interrupt.message` (`ai-harness/src/first-party/question.ts:40-51`).

### adopt

- `core/workcell.ts`: pass `observability.tracer` to the host, so `harness.operation`, `harness.wait` and `harness.recovery` spans exist (`harness/deploy.md`). Invariant 6.

### re-route

- `core/sandbox/library-sandbox.ts` and `core/workers/worker-sandbox.ts` liveness: a listed but stopped container counts as live, because `list` uses `all: true`. `SandboxDefinition.ensureExisting` restarts it.
- `core/sandbox/proxied-docker-sandbox.ts`: `ProxiedDockerHandle` reports `DOCKER_CAPS` (fork and snapshots `true`) while the provider reports them `false`. Override `capabilities`.
- `github/plugins/github-tools.ts`: `z.enum(repositories)` in the input schema replaces `inRepositories` and its refusal text.
- `github` transport: four paced fetchers share one token with four rate-limit states (issue #3).
- `slack/plugins/voice.ts`: `lifetime: 'turn'` back to a session plugin with `onTurnStart` (`harness/plugins.md`).
- `slack/orchestrator-threads`: the answer reaches Slack only through the caller's `onEvent`, so a turn recovered after a restart is never posted. Move the posting into a plugin, and add the orchestrator harness to `resumePending`.
- `core/http/paced-fetch.ts`: `fetch` ignores `retryer.getAbortSignal()`, so a dispose leaves requests in flight.

### keep

- `core/workers/changes.ts` + `core/store/worker-changes-store.ts` against the 1.3.0 checkpoints: the default policy drops `.git` (`ai-sandbox/src/snapshots.ts:107`), so the branch and the unpushed commits are lost; a capture reads every file through the handle (thousands of execs on a monorepo); it needs a checkpoint store and a blob store. Our git bundle keeps the unpushed delta, capped at 8 MiB.
- `core/workers/worker-sandbox.ts`: `reattach: bind` recreates a lost sandbox and restores the changes, where the stock `reattach` returns `'gone'` (`coding/workspace.ts:675-690`).
- `core/workers/deny-guard.ts`: `bypass` returns `allow` before any rule (`first-party/permissions.ts:332`). Upstream draft 1.
- `core/workers/lifecycle.ts`: turn queue on Pacer `AsyncQueuer`, idle timers (`lifecycle.keepAlive` is not read by `@tanstack/ai-sandbox`, Docker has no idle timer), `finish_task` as a `durableTool`.
- `core/workers/worker-reset.ts`: one transaction across `session_index`, `worker_changes` and `sandbox_instances`. Each TanStack store writes alone.
- `core/workers/worker-activity.ts`, `worker-view.ts`, `live-workers.ts`, `workers.ts`, `identity.ts`, `session/*`: compositions of the documented host API.
- `core/sandbox/proxied-docker-sandbox.ts`: `DockerSandboxConfig` takes no network mode, DNS, memory or labels, and has no `list`. Upstream draft 6.
- `core/sandbox/sandboxes-under-keys.ts`: `SandboxProvider` has no `list` on purpose (`ai-sandbox/src/reclaim.ts:8-14`).
- `core/sandbox/sandbox-facts.ts`, `sandbox-image.ts`, `follow-current.ts`, `worker-repo.ts`.
- `core/store/*`: TanStack ships no SQL store; ours follow `persistence/store-reference.md` and pass the conformance suites.
- `core/testing/*`: `fakeText`, `localProcessSandbox` wrapped for `HOME`, `list` and read-only trees.
- `core/budget/*`: the harness `budget` covers agent runs only and aborts, with no wait for a person. Upstream drafts 3 and 4.
- `core/host/*`: `durable-compaction.ts` follows `harness/compaction.md`; `read-only-credentials.ts` has a gap (see issues); `mcp-server-log.ts` upstream draft 5; `loop.ts`, `tanstack-logger.ts`, `wait-until-ready.ts`, `allowed-senders.ts`.
- `core/orchestrator/*`, `core/prompts/*`, `core/telemetry/*`.
- `github/*`, `linear/*`: no TanStack client for GitHub or Linear; tools use `toolDefinition`, `replay`, `PermissionRules`, `mcp()`.
- `slack/*`, `host/*`: no chat-platform transport in TanStack; Pacer already in use.
- `naboo-lab/*`: TanStack-native; native Docker snapshots stay off (per thread, never deleted, restored off the egress network).

### Non-default options to return to the default

- `core/host/agent-host.ts:19` `keepLogRecords: 'since-snapshot'`: none of the five reasons; a change of `addRecordsToModelContext.version` would fail old threads with `LogTruncatedError`.
- `slack/plugins/voice.ts:15` `lifetime: 'turn'`.
- `naboo-lab/src/sandbox/*` `lifecycle: { snapshot: 'none' }` (already the default with `snapshots: false`) and `packageManager: 'pnpm'` (read by nothing).

### Non-default options that hold

- Harness: `agentLoopStrategy: untilABudgetStop`, `interrupts: [budgetStop]`, `usage.model` (a cost limit); `retryTransientErrors()` (a bounded run); `durability`, compaction `durable`, `countTokens: 'usage'` (a host restart); compaction `details` (the worker task); `keepRecentTokens` 20k (a cost limit).
- Permissions: `root`, deny rules, `workspaceTools.web: false`, `outside: 'ask'`, mode `acceptEdits` / `plan` (the sandbox boundary).
- Sandbox: internal network, DNS, no host gateway, `snapshots` and `fork` off (the sandbox boundary); `depth: 'full'` (the worker task); 6 GiB memory (a bounded run, but hard-coded: make it an option).
- `replay: 'safe'` on reads and on the idempotent resolve (a host restart).

## Upstream threads

Open before this run:

- TanStack/ai#2127 `boundToolOutput(): set the bound per tool`. Add: export `boundText`.
- TanStack/ai#2126 `mcp(): let a server mark its tools safe to replay after a host restart`.

Drafted by this run, waiting for the go:

1. `permissions(): keep deny rules in bypass mode`.
2. `todos(): export selectTodos(state), like selectGoal`.
3. `Price calls with no provider cost once, for session.usage(), budget.maxCost and otel`.
4. `A budget for a turn chain that opens a wait for a person instead of failing`.
5. `mcp(): write server status changes to the host logger`.
6. `ai-sandbox-docker: let dockerSandbox() take container create options and list its sandboxes`.
7. `workspaceTools: let a binder replace the workspace of a bound thread in an open session`.
8. `SandboxGit.push(): take auth like clone`.
9. `permissions(): put the call input in the approval interrupt payload`.
10. `harness.plugin.warning never reaches the host logger`.
11. `computeWorkspaceHash ignores a builder-form setup`.
12. `githubRepo(): a filter option for partial clones`.
13. `defineSandbox: a warm template shared across threads`.
14. `projectInstructions(): read instruction files through the ThreadWorkspace backend`.
15. `withCompaction: count the summary call in session.usage()`.
16. `mcp(): read an http server's API key from the credential store`.

## New packages

Each package of TanStack/ai absent from the catalog, with the rule it fails to serve:

- Harness adapters that run another agent (`ai-claude-code`, `ai-codex`, `ai-opencode`, `ai-grok-build`, `ai-acp`): invariant 2, one agent loop with skills.
- Model adapters (`ai-muse` 0.1.0 new, `ai-gemini`, `ai-bedrock`, `ai-mistral`, `ai-groq`, `ai-ollama`, `ai-openrouter`, `ai-vercel-gateway`, `ai-llmgateway`, `ai-neon`, `ai-cohere`, `ai-grok`, `ai-vertex`, `ai-cloudflare`, `ai-lovable`, `ai-byteplus`, `ai-fal`, `ai-elevenlabs`): invariant 4, a project brings its adapter.
- Sandbox providers (`ai-sandbox-e2b`, `-daytona`, `-vercel`, `-cloudflare`, `-blaxel`, `-boxd`, `-sprites`): invariant 4, a project picks one; none gives the egress network of invariant 1 out of the box.
- `ai-code-mode`, `ai-isolate-*`: code runs in a host isolate, outside the sandbox (invariant 1).
- `ai-memory`: a worker lives for one task; no rule asks for memory across tasks.
- `ai-computer-use`, `ai-computer-*`: no browser or desktop work in a coding worker.
- `ai-effect`, UI bindings, devtools, `ai-client`, `ai-event-client`: client side; `ai-event-client` is not a production exporter.
