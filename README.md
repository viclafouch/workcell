# Workcell

Coding agents that take an issue to a merged pull request, each one in its own sandbox. Built on [TanStack AI](https://tanstack.com/ai).

> [!WARNING]
> Workcell is early work. It is not on npm yet, and its API changes without notice.

## How it works

- **A trigger** hands over a task: a label on a Linear ticket today.
- **A worker** takes the task to a pull request in its own Docker sandbox: it clones, installs, changes, tests and pushes.
- **The host** runs the agent loop, keeps every secret, and stores every thread in Postgres. The model never sees a token.
- **A worker sleeps at no cost** while it waits, and wakes up on a reply or on a pull request event, also after a restart.
- **A channel** carries the questions of the worker and the answers of a person: Slack today.
- **Every run is bounded**: each task has a cost budget, and every turn is traced with its cost.

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
| `@workcell/core` | The host, the worker engine, the budget, the Postgres stores, and the Docker sandbox behind an egress allowlist |
| `@workcell/github` | The pull request watcher, the read and review tools, and the finish refusal while a pull request is open |
| `@workcell/linear` | Linear tickets as triggers, and the Linear tools |
| `@workcell/slack` | Slack as the channel of the workers and of the orchestrator bot |
| `@workcell/host` | What the host process needs on a machine: the logger, the secret stores, the traces, the models, the login service, the live view and the machine check |

## License

[MIT](./LICENSE)
