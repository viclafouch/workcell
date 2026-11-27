# TanStack audit, November 2026, second run

The audit of the upgrade that moved ten `@tanstack` packages to their latest release, with issue #33. The next run starts from here: each **keep** and each upstream gap faces its release again.

## Pins

| Package | Pin before | Pin now |
| --- | --- | --- |
| `@tanstack/ai` | 1.4.0 | 1.8.0 |
| `@tanstack/ai-anthropic` | 1.1.1 | 1.2.1 |
| `@tanstack/ai-compaction` | 1.0.1 | 1.1.0 |
| `@tanstack/ai-harness` | 0.3.0 | 0.4.0 |
| `@tanstack/ai-harness-cli` | 0.1.2 | 0.1.3 |
| `@tanstack/ai-mcp` | 1.2.0 | 1.3.1 |
| `@tanstack/ai-openai` | 1.1.1 | 1.2.0 |
| `@tanstack/ai-persistence` | 1.0.1 | 1.1.0 |
| `@tanstack/ai-sandbox` | 1.3.0 | 1.5.0 |
| `@tanstack/ai-skills` | 1.0.2 | 1.0.3 |
| `@tanstack/ai-sandbox-docker` | 1.1.0 | 1.1.0 |
| `@tanstack/ai-sandbox-local-process` | 1.0.0 | 1.0.0 |
| `@tanstack/ai-typesafe` | 1.0.0 | 1.0.0 |
| `@tanstack/intent` | 0.5.6 | 0.5.6 |
| `@tanstack/pacer` | 0.23.1 | 0.23.1 |

`@tanstack/ai` 1.4.1 and 1.6.0 sit in the changelog and never shipped on npm: their changes came with 1.5.0 and 1.7.0. `pnpm peers check`: no new line (the `vitest ^4.1.10` peer was already unmet).

The three patches came back on the new versions: the bare directory imports of the `@tanstack/ai` and `@tanstack/ai-harness` types (TanStack/ai#2173 is still open), and the setup steps and the clone filter of `@tanstack/ai-sandbox`.

## Release digest

- `@tanstack/ai` 1.7.0, #2184: tool result metadata. A server tool calls `context.setResultMetadata(value)`, `resultMetadataSchema` checks it, the model never sees it, and the tool message keeps it. `ai-mcp` 1.3.0 copies the `_meta` of an MCP result into it. Touches `core/files/send-files.ts`, `chat/cards/card-tool.ts` and their readers in `chat/worker-threads` and `chat/orchestrator-threads`.
- `@tanstack/ai` 1.6.0, #2163: a string tool result stays a string, JSON text included. No tool of ours returns `JSON.stringify(...)` or reads a parsed string.
- `@tanstack/ai` 1.6.0, #2110: the strict-mode `null`s of tool arguments are undone before the input check.
- `@tanstack/ai` 1.5.0 with `ai-compaction` 1.1.0 and `ai-anthropic` 1.2.0, #2107: `withCompaction({ native })` passes the tools, the model options, the reasoning and `addUsage` to `compact`. Native compaction stays ruled out.
- `@tanstack/ai` 1.4.1, #2098: a consumer that stops reading runs `onAbort`, and a stop at a pause runs `onFinish`: one terminal hook for each run.
- `@tanstack/ai` 1.7.0 and 1.8.0: `generate3DModel()`, `generateMotion()`, `'3mf'`. Nothing of ours.
- `ai-anthropic` 1.2.1, #2200: `claude-sonnet-5-5` and `claude-haiku-5-5` get their mid-conversation channels, so a tool or prompt added mid-conversation keeps the prompt cache.
- `ai-openai` 1.2.0, #2156: `chat({ reasoning })` on the OpenAI-compatible adapters.
- `ai-harness` 0.4.0, #2197: `providerKeys` signs in with a plan through a vendor CLI. Nothing else changed in its source.
- `ai-sandbox` 1.4.0, #2180, #2109, #2108: `SandboxProvider.deleteSnapshot`, a driver claim held for the whole fresh `withSandbox` run, the replayed prefix kept after a takeover, `SandboxEnsureContext.logger`. 1.5.0: `@tanstack/ai-sandbox/host-login`, which lends a host login into a sandbox (invariant 1 rules it out).
- `otelMiddleware`: no attribute change. It still sets `gen_ai.system`.

## Verdicts

### Done in this run

- `core/host/agent-host.ts`: deleted. `keepLogRecords` went back to its default, so the wrapper had nothing left to set, and every host calls `createHarnessHost`. The test of the trimmed log went with it.
- `core/workcell.ts`: the host gets `observability.tracer`, so `harness.operation`, `harness.wait` and `harness.recovery` spans exist.
- `core/telemetry/worker-telemetry.ts`: each chat span adds `gen_ai.provider.name` and `harness.run_id`, so a viewer joins it to its `harness.operation` span.
- `chat/plugins/voice.ts`: a session plugin that reads the voice file in `onTurnStart`, in place of `lifetime: 'turn'`.
- `chat/worker-threads/worker-waits.ts`: the question text is the `interrupt.message` that `question()` writes (`ai-harness/src/first-party/question.ts:40-51`). The test of our own rendering went.
- `github/plugins/github-tools.ts`: `z.enum(repositories)` in the input schema, in place of `inRepositories` and its refusal text. The input check of TanStack refuses another repository before any call.
- `naboo-lab/src/sandbox/*`: `packageManager: 'pnpm'` went back to `'auto'`, which finds the same lockfile, and whose result nothing reads (`ai-sandbox/src/bootstrap.ts:39`, `sandbox.ts:321`).

### adopt

- `core/workcell.ts`: run the orchestrator harness through `host.resumePending` too, once its answer reaches the chat from a plugin. Carried by a new issue.

### re-route

- `core/files/send-files.ts` and `chat/cards/card-tool.ts`: carry the sent file and the card as tool result metadata, in place of `emitCustomEvent`. The tool message then keeps them, so a read of the transcript, such as the console of #48, shows them. The chat posts live today, so nothing breaks before #48. Carried by #48.
- `chat/orchestrator-threads`: the answer reaches the chat only through the `onEvent` of the caller, so a turn recovered after a restart is never posted. Move the posting into a plugin. Carried by a new issue.
- `core/sandbox/library-sandbox.ts` and `core/workers/worker-sandbox.ts` liveness: a listed but stopped container counts as live, because the list uses `all: true`. `SandboxDefinition.ensureExisting` decides it.
- `core/sandbox/proxied-docker-sandbox.ts`: `ProxiedDockerHandle` reports `DOCKER_CAPS` (fork and snapshots `true`) while the provider reports them `false`. Override `capabilities`. Only `withSandbox` reads the handle value, so it is a wrong claim, not a live bug.

### not adopted

- The mid-conversation channels of `ai-anthropic` and `ai-openai` behind a gateway (`midConversationChannels: true`, #52). A custom `baseURL` turns them off. The traces of a real orchestrator turn and of a worker turn with a todo list show each model call reading the whole earlier request from the cache: no Workcell turn adds a tool or a system prompt mid-run, so the channels have nothing to keep. A live probe through one gateway also showed it does not pass them. Adopt the switch the day a plugin adds a tool or a prompt during a turn.

### keep

- `core/workers/lifecycle.ts`, the pause branch of `onChunk`: the 1.4.1 rule runs `onFinish` at a pause, but only after the paused stream drains. The changes of a turn that stops at its budget must be saved at the pause chunk, or a host restart before `onFinish` loses them (`worker-budget.test.ts`, "saves the changes of a turn that stops at its budget").
- `core/workers/lifecycle.ts`, the rest: the turn queue on Pacer `AsyncQueuer`, the idle timers (`lifecycle.keepAlive` is not read by `ai-sandbox`), `finish_task` as a `durableTool`, and `restartToFillTheFreeSlots` (upstream draft 18).
- `core/workers/changes.ts` and `core/store/worker-changes-store.ts`: the default snapshot policy drops `.git` (`ai-sandbox/src/snapshots.ts:89`), so the branch and the unpushed commits are lost. Our git bundle keeps the unpushed delta.
- `core/workers/worker-sandbox.ts`: `reattach: bind` recreates a lost sandbox and restores the changes, where the stock `reattach` returns `'gone'` (`coding/workspace.ts:639-692`).
- `core/workers/deny-guard.ts`: `bypass` allows every call before any rule (`first-party/permissions.ts:332, 786`). Upstream draft 1.
- `core/workers/workers.ts`: `host.submit` only stores the input, a `cancel` reaches only a running turn, and the start lock works across threads.
- `core/workers/worker-reset.ts`: one transaction across three stores. Each TanStack store writes alone.
- `core/workers/worker-activity.ts`, `worker-view.ts`, `live-workers.ts`, `identity.ts`, `worker-names.ts`, `thread-line.ts`, `permission-rules.ts`, `session/*`: compositions of the documented host API, or plain data.
- `core/sandbox/proxied-docker-sandbox.ts`: `DockerSandboxConfig` takes no network mode, DNS, memory or labels, and has no `list`. Upstream draft 6. Its 6 GiB memory is hard-coded: make it an option.
- `core/sandbox/sandboxes-under-keys.ts`: `SandboxProvider` has no `list` on purpose (`ai-sandbox/src/reclaim.ts:9-14`), and the listing catches a container made before its record.
- `core/sandbox/egress/*`: no provider gives a Docker allowlist with credentials added on the host. `sbxSandbox` puts secrets in the sandbox env (`ai-sandbox-docker/src/sbx/provider.ts:298`).
- `core/sandbox/sandbox-facts.ts`, `sandbox-image.ts`, `follow-current.ts`, `worker-repo.ts`.
- `core/store/*`: `ai-persistence` ships memory stores and the conformance testkit only. `sent-file-store.ts` stays: `session.putMedia` refuses a file with no media kind (`ai-harness/src/media.ts:306-316`).
- `core/budget/*`: the harness `budget` covers agent runs only and aborts, with no wait for a person, and its pricer is private (`first-party/session-tools.ts:117-130`). Upstream drafts 3, 4 and 15.
- `core/host/*`: `durable-compaction.ts` follows `harness/compaction.md`; `read-only-credentials.ts` serves the same values to every scope and refuses writes; `mcp-server-log.ts` waits on draft 5; `agent-durability.ts`, `allowed-senders.ts`, `wait-until-ready.ts`, `tanstack-logger.ts`, `loop.ts`.
- `core/orchestrator/*`: `permissions()` has no starting-mode option, and a `PermissionRule` has no check on the user, so `starter-only-tools.ts` uses `onGuardToolCall`.
- `core/inputs/message-files.ts`: the harness stops the run when the model cannot read a file, where Workcell writes a note, and it has no size check before a download.
- `core/prompts/instruction-files.ts`: `projectInstructions()` reads one fixed `root` at setup. Upstream draft 14.
- `core/telemetry/*`, `core/testing/*`, `core/http/*`, `host/*`.
- `chat/*`, `chat-slack/*`: no chat-platform transport in TanStack. Pacer `AsyncQueuer.addItem` returns a boolean, so `worker-thread-status.ts` and `chat-surface.ts` wrap each call in a promise.
- `github/*`, `linear/*`: no TanStack client for GitHub or Linear; Octokit keeps its own pacing; `mcp()` has no tool allowlist, so `PermissionRules` restrict it.
- `naboo-lab/*`: TanStack-native.

### Non-default options to return to the default

- None left.

### Non-default options that hold

- Harness: `agentLoopStrategy: untilABudgetStop`, `interrupts: [budgetStop]`, `usage.model` (a cost limit); `retryTransientErrors()` (a bounded run); `durability`, `continueCutOff`, compaction `durable`, `countTokens: 'usage'` (a host restart); `truncatedToolResult`, compaction `details` (the worker task); `keepRecentTokens` 20k (a cost limit).
- Permissions: `root`, deny rules, `outside: 'ask'`, mode `acceptEdits` and `plan` (the sandbox boundary). `outside: 'ask'` lets a rule or the `bypass` mode allow a path outside `/workspace` that is still inside the sandbox; `'deny'` refuses it every time (`coding/workspace.ts:491-513`). `WEB_FETCH_RULE` (the worker task: an unattended worker cannot ask at each fetch).
- Sandbox: internal network, DNS, no host gateway, `snapshots` and `fork` off, and the lab's `lifecycle: { snapshot: 'none' }` (the sandbox boundary: a restored snapshot leaves the egress network); `depth: 'full'` and `filter: 'blob:none'` (the worker task); `sandboxWorkspaceBackend({ owned: true })`.
- `replay: 'safe'` on reads and on the idempotent resolve (a host restart).
- `observability.tracer`: a host option, not a plugin one. Its default writes no spans, and invariant 6 asks that every turn be traced.

## Upstream threads

Open before this run:

- TanStack/ai#2127 `boundToolOutput(): set the bound per tool`. Add: export `boundText`.
- TanStack/ai#2126 `mcp(): let a server mark its tools safe to replay after a host restart`.
- TanStack/ai#2173 `Published .d.ts files import bare directories`. Still unfixed in 0.4.0 and 1.8.0.

Filed by this run: drafts 17, 19 and 20 as TanStack/ai#2235, #2236 and #2237, draft 18 as TanStack/pacer#312. Draft 21 waits: check first that `sbx secret` serves any host.

Drafted, waiting for the go (1 to 16 from the first run, each checked again in today's source):

1. `permissions(): keep deny rules in bypass mode`.
2. `todos(): export selectTodos(state), like selectGoal`.
3. `Price calls with no provider cost once, for session.usage(), budget.maxCost and otel`.
4. `A budget for a turn chain that opens a wait for a person instead of failing`.
5. `mcp(): write server status changes to the host logger`.
6. `ai-sandbox-docker: let dockerSandbox() take container create options and list its sandboxes`.
7. `workspaceTools: let a binder replace the workspace of a bound thread in an open session`.
8. `SandboxGit.push(): take auth like clone`.
9. `permissions(): put the call input in the approval interrupt payload`.
10. `A plugin hook that throws reaches clients as harness.plugin.warning, never the host logger` (retitled: `ctx.logger` covers the warnings a plugin writes itself).
11. `computeWorkspaceHash ignores a builder-form setup`.
12. `githubRepo(): a filter option for partial clones`.
13. `defineSandbox: a warm template shared across threads`.
14. `projectInstructions(): read instruction files through the ThreadWorkspace backend`.
15. `withCompaction: count the summary call in session.usage()`. 1.1.0 passes `addUsage` to the native compaction only (`ai-compaction/src/index.ts:855`). When it lands, the budget must stop counting the summary itself.
16. `mcp(): read an http server's API key from the credential store`.
17. `Run each harness operation in the context of its harness.operation span, so the otelMiddleware spans of its run are its children`. The harness starts its spans with `tracer.startSpan` and never makes one active (`ai-harness/src/observability.ts:153-154, 288-300`).
18. Pacer: `AsyncQueuer.addItem leaves a free concurrency slot idle while an item runs` (`pacer/dist/async-queuer.js:200, 226, 277`).
19. `workspaceTools: with workspace.bind, do not ask for an outside path that the tool then refuses`. `permissions({ root })` asks for it (`first-party/permissions.ts:244-253`), and the check refuses it after a yes (`coding/workspace.ts:491-513`).
20. `A public way to add known secret values to the session redactor`. `SessionScrub` is internal (`plugins.ts:963-969`).
21. `sbxSandbox(): put workspace secrets behind sbx secret, so a token stays on the host`.

`createHarnessMcpServer` in `ai-mcp` 1.3.1 still drops the tool `metadata`, the `outputSchema` and the server `instructions` (#38).

## New packages

Each package of TanStack/ai absent from the catalog, with the rule it fails to serve:

- Harness adapters that run another agent (`ai-claude-code`, `ai-codex`, `ai-opencode`, `ai-grok-build`, `ai-acp`): invariant 2, one agent loop with skills.
- Model and media adapters (`ai-muse`, `ai-meshy` and `ai-uthana` new, `ai-gemini`, `ai-bedrock`, `ai-mistral`, `ai-groq`, `ai-ollama`, `ai-ollaya`, `ai-openrouter`, `ai-perplexity`, `ai-vercel-gateway`, `ai-llmgateway`, `ai-neon`, `ai-cohere`, `ai-grok`, `ai-vertex`, `ai-cloudflare`, `ai-lovable`, `ai-byteplus`, `ai-fal`, `ai-elevenlabs`, `ai-worldlabs`, `ai-reactor`, `ai-octane`, `openai-base`): invariant 4, a project brings its adapter.
- Sandbox providers (`ai-sandbox-e2b`, `-daytona`, `-vercel`, `-cloudflare`, `-blaxel`, `-boxd`, `-sprites`, `-railway`, `-upstash-box`): invariant 4, a project picks one; none gives the egress network of invariant 1 out of the box.
- `ai-code-mode`, `ai-code-mode-snippets`, `ai-isolate-*`: code runs in a host isolate, outside the sandbox (invariant 1).
- `ai-memory`: a worker lives for one task; lessons live in files.
- `ai-computer-use`, `ai-computer-*`: no browser or desktop work in a coding worker.
- `ai-durable-stream`: a resumable stream for a client; the harness log already carries the durable session.
- `ai-vercel-compat`, `ai-utils`, `ai-effect`, `ai-remix`, UI bindings, devtools, `ai-client`, `ai-event-client`: client side or another runtime.
