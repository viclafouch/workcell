# Workcell

Coding agents that take an issue to a merged pull request, each one in its own sandbox. Built on [TanStack AI](https://tanstack.com/ai).

> [!WARNING]
> Workcell is early work. It is not on npm yet, and its API changes without notice.

## How it works

- **A trigger** hands over a task: a label on a Linear ticket today.
- **A worker** takes the task to a pull request in its own Docker sandbox: it clones, installs, changes, tests and pushes.
- **The host** runs the agent loop, keeps every secret, and stores every thread in Postgres. The model never sees a token.
- **A worker sleeps at no cost** while it waits, and wakes up on a reply or on a pull request event, also after a restart.
- **A chat** carries the questions of the worker and the answers of a person, on any platform that [Chat SDK](https://chat-sdk.dev) adapts: Slack, Microsoft Teams, Discord, Telegram, WhatsApp and more.
- **Every run is bounded**: each task has a cost budget, and every turn is traced with its cost.
- **Agents report what got in their way**: the bot and the workers call `send_feedback` when a tool, a skill or a limit fails them. Each report lands in the session log, and the `feedback.deliver` option of `openWorkcell` also sends it to the people who run the project. The report goes one way: nobody answers the agent.

## The clone of a worker

`workerRepo` clones the repository of a worker with its whole history. The worker then reads, rebases and resumes any branch with every git command. It takes the options of `githubRepo` from `@tanstack/ai-sandbox`:

```ts
defineWorkspace({ source: workerRepo({ repo: 'owner/app', ref: 'main' }) })
```

Pass `depth` to trade history for a faster start:

| `depth` | Start | History in the sandbox |
| --- | --- | --- |
| `'full'`, the default | The slowest: the clone holds the whole repository | Every branch and every commit |
| A number | Faster | The last commits of one branch. The worker learns it, and fetches more with a depth |

## Packages

Each integration is its own package, and a project picks the ones it uses.

| Package | What it brings |
| --- | --- |
| `@workcell/core` | The host, the worker engine, the budget, the Postgres stores, and the Docker sandbox behind an egress allowlist and a credential proxy |
| `@workcell/github` | The pull request watcher, the read and review tools, the finish refusal while a pull request is open, and the feedback destination that opens a labelled issue in a repository you name |
| `@workcell/linear` | Linear tickets as triggers, and the Linear tools |
| `@workcell/chat` | The chat of the workers and of the orchestrator bot on [Chat SDK](https://chat-sdk.dev), and `show_card`: tables, charts and key figures as native cards |
| `@workcell/chat-slack` | What Slack adds on top of Chat SDK: the name and the picture of each worker, the session status, the card limits, the token checks and the Slack link of a thread in a feedback report |
| `@workcell/host` | What the host process needs on a machine: the logger, the secret stores, the traces, the models, the login service, the live view and the machine check |
| `@workcell/evals` | The eval set on [vitest-evals](https://vitest-evals.sentry.dev): the tasks a worker got wrong as Harbor task folders, a worker harness that reruns each one from its base commit with the remote out of reach, a `decide()` judge that compares the change to the one a person merged, and a report of pass^k, pass@k, cost and time per case, model beside model |

## License

[MIT](./LICENSE)
