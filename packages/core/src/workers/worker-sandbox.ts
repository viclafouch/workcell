import {
  createPluginEvent,
  definePlugin,
  type RunContext
} from '@tanstack/ai-harness'
import type { WorkspaceBinder } from '@tanstack/ai-harness/plugins/coding'
import {
  resolveAllSecrets,
  type SandboxDefinition,
  type SandboxHandle,
  type SandboxInstanceStore,
  type SandboxSetupStep
} from '@tanstack/ai-sandbox'
import { sandboxWorkspaceBackend } from '@tanstack/ai-sandbox/harness'
import { followCurrent, type SandboxBackend } from '#/sandbox/follow-current.ts'
import { WORKSPACE_ROOT, readSandboxFacts } from '#/sandbox/sandbox-facts.ts'
import type { ListSandboxes } from '#/sandbox/sandboxes-under-keys.ts'
import {
  captureChanges,
  restoreChanges,
  type WorkerChanges
} from './changes.ts'
import { workerIdentityEnv, type WorkerIdentityEnvParams } from './identity.ts'
import type {
  NamedWorker,
  RepositorySandboxes,
  WorkerLogger
} from './lifecycle.ts'

const SETUP_PLUGIN = 'workcell/worker-sandbox-setup'

export type WorkerSandboxStep =
  | SandboxSetupStep
  | { step: 'restore' }
  | { step: 'bind' }

export type WorkerSandboxSetupEvent = WorkerSandboxStep | { step: 'done' }

export const WorkerSandboxSetup = createPluginEvent<WorkerSandboxSetupEvent>(
  'workcell/worker-sandbox:setup'
)

type EmitSetup = (event: WorkerSandboxSetupEvent) => void

type StepLog = ReturnType<WorkerLogger['child']>

type RunningStep = { step: WorkerSandboxStep; startedAt: number }

type SetupProgress = { running?: RunningStep }

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

function durationSince(startedAt: number) {
  return Math.round(performance.now() - startedAt)
}

function setupSteps(log: StepLog, emitSetup: EmitSetup) {
  const current: SetupProgress = {}

  const takeRunning = () => {
    const { running } = current
    current.running = undefined

    return running
  }

  const end = () => {
    const running = takeRunning()

    if (running !== undefined) {
      log.info(
        { ...running.step, durationMs: durationSince(running.startedAt) },
        'sandbox step ended'
      )
    }
  }

  const start = (step: WorkerSandboxStep) => {
    end()
    current.running = { step, startedAt: performance.now() }
    log.info({ ...step }, 'sandbox step started')
    emitSetup(step)
  }

  const fail = (error: unknown) => {
    const running = takeRunning()

    if (running !== undefined) {
      log.error(
        {
          ...running.step,
          durationMs: durationSince(running.startedAt),
          error
        },
        'sandbox step failed'
      )
    }
  }

  return { start, end, fail }
}

type SetupSteps = ReturnType<typeof setupSteps>

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
  const setupEmitters = new Map<string, EmitSetup>()

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

  const emitSetupOf = (threadId: string): EmitSetup => {
    return (event) => {
      setupEmitters.get(threadId)?.(event)
    }
  }

  const createFresh = async (
    sandbox: SandboxDefinition,
    run: RunContext,
    steps: SetupSteps
  ) => {
    const handle = await sandbox.ensure({
      ...contextOf(run),
      onStep: steps.start
    })
    const saved = await changes.load(run.threadId)

    if (saved === undefined) {
      return handle
    }

    steps.start({ step: 'restore' })

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

  const openWithSteps = async (
    sandbox: SandboxDefinition,
    run: RunContext,
    steps: SetupSteps
  ) => {
    const live = await sandbox.ensureExisting(contextOf(run))
    const handle = live ?? (await createFresh(sandbox, run, steps))
    steps.start({ step: 'bind' })
    await handle.env.set(workerIdentityEnv(gitIdentity))
    const backend = sandboxWorkspaceBackend(handle, { owned: true })
    opened.set(run.threadId, { handle, backend, sandbox })
    steps.end()

    return { live, backend }
  }

  const open = async (sandbox: SandboxDefinition, run: RunContext) => {
    const emitSetup = emitSetupOf(run.threadId)
    const steps = setupSteps(logOf(run), emitSetup)
    const { live, backend } = await openWithSteps(sandbox, run, steps)
      .catch((error: unknown) => {
        steps.fail(error)
        throw error
      })
      .finally(() => {
        emitSetup({ step: 'done' })
      })
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
          return value !== '' && captured.content.includes(value) ? [name] : []
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

  const plugin = definePlugin({
    name: SETUP_PLUGIN,
    setup: async (setupContext) => {
      const { threadId } = setupContext.session
      const emitSetup: EmitSetup = (event) => {
        setupContext.emit(WorkerSandboxSetup, event)
      }
      await setupContext.resources.acquire(
        () => {
          setupEmitters.set(threadId, emitSetup)
        },
        () => {
          if (setupEmitters.get(threadId) === emitSetup) {
            setupEmitters.delete(threadId)
          }
        }
      )

      return {}
    }
  })

  return { workspace, plugin, rebind, save, inspect, forget }
}

export type WorkerSandbox = ReturnType<typeof createWorkerSandbox>
