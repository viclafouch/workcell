# ADR 010 – How We Test the Agent

## Status

Accepted

## Context

The host runs the agent loop, sends the coding tools of the model to sandboxes, keeps its state in Postgres, and talks to Slack, Linear and GitHub. The lefthook hooks run before each commit, and CI runs `pnpm check` on each push and pull request.

A real model call bills tokens on the model key, takes seconds to minutes, and gives a different answer on each run. A test suite that calls the model is slow, costly and flaky.

TanStack AI ships test kits for its contracts. Anthropic tells agent builders to grade the outcome of a task, in a clean environment, over many runs.

## Decision

### 1. Three test runs

The default run needs no model, and starts one Postgres container on Docker for the database tests. The integration run uses the real sandbox on Docker, with a real repository. The live run calls the real model, and only when its flag is set.

Each Workcell package holds the default run only. A distribution holds the integration and the live runs, because it brings the sandbox image, the repositories and the model key that these runs need.

**Rationale**: each run has its own cost, so each one runs only when it can catch something. A Postgres container starts in seconds. The stores hold all the state of the host, so they run in every check. A live test that runs without the flag fails, so it never passes in silence.

### 2. Each run has its moment

| Moment | Command | What runs |
| --- | --- | --- |
| Each slice | `pnpm lint`, `pnpm typecheck`, `pnpm test:changed` | The default tests that import a changed file |
| Each commit, through lefthook | `turbo run lint lint:root typecheck typecheck:root test:changed`, `oxfmt --check` on the staged files, `knip`, `turbo boundaries` | Lint, typecheck, format, knip, the package boundaries, and the default tests that import a changed file |
| Before the hand-off, and in CI | `pnpm check` | Every check, and every default test |
| After `pnpm check`, in a distribution | its integration run | When the change touches `packages/core/src/sandbox/`, the sandbox image, or what a sandbox runs |
| After the integration run, in a distribution | its live run | When the change touches the model, the agent loop, or a behaviour that only a real model proves |

**Rationale**: a Docker run sets up a whole repository, and a live run spends tokens. Each one runs at most once per change. Vitest `--changed` follows the import graph, and reruns every test when the Vitest config, `package.json` or a setup file changes.

### 3. No model call in the default run

The host gets the model key from `loadSecrets()` and passes it to `createModels()` in code. Both live in `@workcell/host`. A default test passes a fake key.

**Rationale**: no adapter reads a credential from the environment, so a default test never spends the model key. `@workcell/core` takes its text adapters as options of `openWorkcell()`, and oxlint keeps the model providers out of it.

### 4. Host logic runs on `fakeText()`

Harness and tool logic runs on `fakeText()` from `@tanstack/ai/testing`, with scripted text, tool calls and errors.

**Rationale**: it is the adapter TanStack ships for this, and it counts the calls.

### 5. The coding tools run in a local sandbox

The fast tests bind `workspaceTools` to a sandbox of `createHostFreeProvider()`, or to `createHostFreeSandbox()` for one shared sandbox. Both live in `packages/core/src/sandbox/host-free-sandbox.ts`: a `localProcessSandbox` whose `HOME` is an empty folder. The integration run of a distribution binds them to the real sandbox provider, with its image.

**Rationale**: the test covers the real coding tools, the real permission rules and the real sandbox backend, with no model call. A command that a rule lets through runs on the host machine, and the host `HOME` holds the `gh` login: an empty `HOME` keeps each such command away from GitHub. oxlint keeps `localProcessSandbox` inside the helper.

### 6. Each store passes its TanStack conformance suite

The Postgres persistence passes `runPersistenceConformance` with a `twin`. The sandbox instance store passes `runSandboxInstanceStoreConformance` of `@tanstack/ai-sandbox/testkit`. They run in the default run of `@workcell/core`, on Postgres 18 in Testcontainers. A `globalSetup` starts one container for the whole run, and each test takes its own database from `createMigratedDatabase()`.

**Rationale**: the suites encode the contract better than our own tests would. A local container needs no network and leaves a serverless Postgres compute asleep. One container per run keeps Docker under the startup wait of Testcontainers when every core is busy.

### 7. External services are mocked at the edge

The Linear, GitHub and Slack Web API calls go through msw. Slack events reach the app through a test receiver that calls `app.processEvent`.

**Rationale**: Bolt ships no test kit. The receiver is the seam that Bolt documents.

### 8. The live run calls the real model

The live run of a distribution calls the real model through the model key, with a low cost budget, in a real sandbox.

**Rationale**: it proves the adapter, the key and the sandbox together, at a small cost per run.

### 9. Evals grade real tasks, on demand

An eval set, still to build, grades real merged tasks. A grader checks the outcome: the tests pass in the sandbox and the diff meets the task. The eval runs several trials, reports pass^k and the cost, and compares models and configs. `createModels()` already has a `grader` role for it.

**Rationale**: Anthropic advises 20 to 50 tasks from real failures, graded on the outcome, not on the path.

### 10. The Docker runs start from a warm image

`ensureSandboxImage()` of `packages/core/src/sandbox/sandbox-image.ts` makes the image of the Docker runs. It runs a build sandbox through its full setup, then commits it with `docker commit`. The distribution gives a version, such as the hash of the lockfile of the default branch. A new version runs a refresh sandbox from the image, and commits its changes as a new layer. After `maxRefreshes` refreshes, a new base image or a new setup, it builds the image again.

Each test sandbox of a distribution carries the Docker label of the distribution. `checkTestSandbox()` of `@workcell/host` fails the machine check while one of them runs, and names the command that stops it. Each run destroys its sandboxes, and the host destroys every sandbox when it stops.

**Rationale**: the clone and the install take most of a Docker run. A refresh costs less than a full build. A bound on the refreshes keeps the disk of the image bounded. The image costs disk, not memory. A sandbox from the image holds no memory between two runs.

## Considered options

- **Mock the model HTTP with aimock**: `fakeText()` covers the harness contract with no HTTP layer.
- **A serverless Postgres branch for each test run**: it needs the network, wakes a compute and costs time.
- **promptfoo for the evals**: a YAML config outside Vitest. vitest-evals keeps the evals in the same runner.
- **Polly.js for record and replay**: no release since 2023.
- **One test sandbox kept alive by a fixed id**: it holds memory between runs.

## Consequences

**A model or prompt change can change the outcome.** The default run cannot see it. The eval set catches it, so a model change runs the eval set first.

**The live and eval runs spend tokens.** They run on demand, never in a hook.

**The default run needs Docker.** Without a Docker daemon, the database tests fail.

## Sources

| Page | Address |
| --- | --- |
| TanStack AI, Test with a Fake Model | https://tanstack.com/ai/latest/docs/advanced/testing.md |
| TanStack AI, Give your agent coding tools | https://tanstack.com/ai/latest/docs/harness/coding-tools.md |
| TanStack AI, Sandbox and extend the coding tools | https://tanstack.com/ai/latest/docs/harness/coding-tools-backends.md |
| TanStack AI, Store Reference (conformance suite) | https://tanstack.com/ai/latest/docs/persistence/store-reference.md |
| TanStack AI, Sandbox Lifecycle & Snapshots | https://tanstack.com/ai/latest/docs/sandbox/lifecycle.md |
| Anthropic, Demystifying evals for AI agents | https://www.anthropic.com/research/demystifying-evals-for-ai-agents |
| Anthropic, Infrastructure noise | https://www.anthropic.com/research/infrastructure-noise |
| Vitest, projects | https://vitest.dev/guide/projects.md |
| Vitest, globalSetup | https://vitest.dev/config/globalsetup.md |
| Docker, docker container commit | https://docs.docker.com/reference/cli/docker/container/commit.md |
| vitest-evals | https://github.com/getsentry/vitest-evals |
| msw | https://mswjs.io/docs |
| Testcontainers for Node | https://node.testcontainers.org/modules/postgresql/ |
| Bolt for JavaScript, receivers | https://docs.slack.dev/tools/bolt-js/concepts/receiver.md |
