import type { RunContext } from '@tanstack/ai-harness'
import type { WorkspaceBinder } from '@tanstack/ai-harness/plugins/coding'
import {
  resolveAllSecrets,
  type SandboxDefinition,
  type SandboxHandle,
  type SandboxInstanceStore
} from '@tanstack/ai-sandbox'
import { sandboxWorkspaceBackend } from '@tanstack/ai-sandbox/harness'
import { WORKSPACE_ROOT } from '#/workers/harness.ts'
import {
  workerIdentityEnv,
  type WorkerIdentityEnvParams
} from '#/workers/identity.ts'
import type {
  ListSandboxes,
  NamedWorker,
  RepositorySandboxes,
  WorkerLogger
} from '#/workers/lifecycle.ts'
import {
  captureChanges,
  restoreChanges,
  type WorkerChanges
} from './changes.ts'
import { followCurrent, type SandboxBackend } from './follow-current.ts'
import { readSandboxFacts } from './sandbox-facts.ts'

type OpenedSandbox = {
  handle: SandboxHandle
  backend: SandboxBackend
  sandbox: SandboxDefinition
}

type CreateWorkerSandboxParams = {
  sandboxes: RepositorySandboxes
  repositoryOf: (threadId: string) => Promise<string>
  listSandboxes: ListSandboxes
  instances: SandboxInstanceStore
  changes: WorkerChanges
  gitIdentity: WorkerIdentityEnvParams
  logger: WorkerLogger
}

function secretValuesOf(sandbox: SandboxDefinition) {
  const workspaceSecrets = sandbox.workspace?.secrets

  return Object.entries(
    workspaceSecrets === undefined ? {} : resolveAllSecrets(workspaceSecrets)
  )
}

function cloneRefOf(sandbox: SandboxDefinition) {
  const source = sandbox.workspace?.source

  return source?.type === 'git' ? source.ref : undefined
}

export function createWorkerSandbox({
  sandboxes,
  repositoryOf,
  listSandboxes,
  instances,
  changes,
  gitIdentity,
  logger
}: CreateWorkerSandboxParams) {
  const opened = new Map<string, OpenedSandbox>()

  const logOf = ({ threadId, name }: NamedWorker) => {
    return logger.child({ module: 'agents', threadId, name })
  }

  const sandboxOf = async (threadId: string) => {
    const repository = await repositoryOf(threadId)
    const sandbox = sandboxes[repository]

    if (sandbox === undefined) {
      throw new Error(`No sandbox runs the repository ${repository}.`)
    }

    return sandbox
  }

  const contextOf = (run: RunContext) => {
    return { threadId: run.threadId, runId: run.runId, store: instances }
  }

  const createFresh = async (sandbox: SandboxDefinition, run: RunContext) => {
    const handle = await sandbox.ensure(contextOf(run))
    const saved = await changes.load(run.threadId)

    if (saved === undefined) {
      return handle
    }

    try {
      await restoreChanges(handle, saved)
    } catch (error) {
      logOf(run).error({ error }, 'worker changes not restored')
      await sandbox.provider.destroy({ id: handle.id })
      throw error
    }

    logOf(run).info(
      { branch: saved.branch, bytes: saved.bundle.byteLength },
      'worker changes restored'
    )

    return handle
  }

  const open = async (sandbox: SandboxDefinition, run: RunContext) => {
    const live = await sandbox.ensureExisting(contextOf(run))
    const handle = live ?? (await createFresh(sandbox, run))
    await handle.env.set(workerIdentityEnv(gitIdentity))
    const backend = sandboxWorkspaceBackend(handle, { owned: true })
    opened.set(run.threadId, { handle, backend, sandbox })
    logOf(run).info(
      { path: live === null ? 'fresh sandbox' : 'reattach' },
      'worker sandbox bound'
    )

    return followCurrent(WORKSPACE_ROOT, () => {
      return opened.get(run.threadId)?.backend ?? backend
    })
  }

  const bind: WorkspaceBinder['bind'] = async ({ run }) => {
    return open(await sandboxOf(run.threadId), run)
  }

  const workspace: WorkspaceBinder = { bind, reattach: bind }

  const rebind = async (run: RunContext) => {
    const current = opened.get(run.threadId)

    if (current === undefined) {
      return
    }

    const listed = await listSandboxes()
    const isLive = listed.some(({ id }) => {
      return id === current.handle.id
    })

    if (!isLive) {
      await open(current.sandbox, run)
    }
  }

  const save = async (worker: NamedWorker) => {
    const current = opened.get(worker.threadId)

    if (current === undefined) {
      return null
    }

    const log = logOf(worker)

    try {
      const captured = await captureChanges(current.handle)

      if (captured === null) {
        return null
      }

      const leaked = secretValuesOf(current.sandbox).flatMap(
        ([name, value]) => {
          return value !== '' && captured.patch.includes(value) ? [name] : []
        }
      )

      if (leaked.length > 0) {
        log.error(
          { secrets: leaked },
          'worker changes hold a secret, not saved'
        )

        return null
      }

      await changes.save(worker.threadId, captured)
      log.info(
        { branch: captured.branch, bytes: captured.bundle.byteLength },
        'worker changes saved'
      )

      return captured.branch === cloneRefOf(current.sandbox)
        ? null
        : (captured.branch ?? null)
    } catch (error) {
      log.error({ error }, 'worker changes not saved')

      return null
    }
  }

  const inspect = async (threadId: string) => {
    const current = opened.get(threadId)

    if (current === undefined) {
      return null
    }

    const listed = await listSandboxes()
    const isLive = listed.some(({ id }) => {
      return id === current.handle.id
    })

    if (!isLive) {
      return null
    }

    try {
      return await readSandboxFacts(
        current.handle,
        cloneRefOf(current.sandbox) ?? 'HEAD'
      )
    } catch (error) {
      logger
        .child({ module: 'agents', threadId })
        .warn({ error }, 'sandbox facts not read')

      return null
    }
  }

  const forget = async (worker: NamedWorker) => {
    opened.delete(worker.threadId)
    await changes.remove(worker.threadId)
    await Promise.all(
      Object.values(sandboxes).map((sandbox) => {
        return instances.delete(
          sandbox.key({ threadId: worker.threadId, runId: worker.threadId })
        )
      })
    )
    logOf(worker).info({}, 'worker changes deleted')
  }

  return { workspace, rebind, save, inspect, forget }
}

export type WorkerSandbox = ReturnType<typeof createWorkerSandbox>
