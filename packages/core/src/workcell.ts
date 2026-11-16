import type { AnyTextAdapter } from '@tanstack/ai'
import type { HarnessPlugin, PermissionMode } from '@tanstack/ai-harness'
import type { SandboxDefinition } from '@tanstack/ai-sandbox'
import type { ModelPricing } from './budget/budget.ts'
import type { BudgetLimits } from './budget/limits.ts'
import { createAgentHost } from './host/agent-host.ts'
import {
  acceptAllowedSenders,
  isStarterIn,
  type AcceptAllowedSendersParams
} from './host/allowed-senders.ts'
import { readOnlyCredentials } from './host/read-only-credentials.ts'
import { toTanStackLogger, type LeveledLog } from './host/tanstack-logger.ts'
import { waitUntilReady } from './host/wait-until-ready.ts'
import { defineOrchestratorHarness } from './orchestrator/orchestrator-harness.ts'
import { createOrchestrator } from './orchestrator/orchestrator.ts'
import {
  createLibrarySandbox,
  type LibraryRepositories
} from './sandbox/library-sandbox.ts'
import { workerMetadataSchema } from './session/metadata.ts'
import type { Database } from './store/database.ts'
import { createHarnessPersistence } from './store/harness-persistence.ts'
import { createSandboxInstanceStore } from './store/sandbox-instance-store.ts'
import { createWorkerChangesStore } from './store/worker-changes-store.ts'
import type { WorkerObservability } from './telemetry/worker-telemetry.ts'
import { defineWorkerHarness } from './workers/harness.ts'
import type { WorkerIdentityEnvParams } from './workers/identity.ts'
import {
  createWorkerLifecycle,
  destroyEverySandbox,
  type ListedSandboxProvider,
  type RepositorySandboxes
} from './workers/lifecycle.ts'
import { createWorkerActivity } from './workers/worker-activity.ts'
import { createWorkerSandbox } from './workers/worker-sandbox.ts'
import { createWorkerView } from './workers/worker-view.ts'
import { createWorkers } from './workers/workers.ts'

type WorkcellLogger = {
  child: (bindings: Record<string, unknown>) => LeveledLog
}

type OpenWorkcellParams = {
  database: Database
  logger: WorkcellLogger
  models: {
    orchestrator: AnyTextAdapter
    worker: AnyTextAdapter
    compaction: AnyTextAdapter
  }
  pricing: ModelPricing
  secrets: Readonly<Record<string, string>>
  sandboxes: RepositorySandboxes
  sandboxProvider: ListedSandboxProvider
  library: {
    sandbox: SandboxDefinition
    repositories: LibraryRepositories
    mapFolders?: readonly string[]
    pullIntervalMs: number
  }
  senders: AcceptAllowedSendersParams
  orchestrator: {
    name: string
    limits: BudgetLimits
    plugins: readonly HarnessPlugin[]
  }
  gitIdentity: WorkerIdentityEnvParams
  workerNames: readonly string[]
  skillDirs: readonly string[]
  defaultLimits: BudgetLimits
  plugins: readonly HarnessPlugin[]
  maxRunningTurns: number
  permissionMode?: PermissionMode
  idleSandboxMs?: number
  observability?: WorkerObservability
}

export async function openWorkcell({
  database,
  logger,
  models,
  pricing,
  secrets,
  sandboxes,
  sandboxProvider,
  library: libraryOptions,
  senders,
  orchestrator: orchestratorOptions,
  gitIdentity,
  workerNames,
  skillDirs,
  defaultLimits,
  plugins,
  permissionMode = 'acceptEdits',
  maxRunningTurns,
  idleSandboxMs,
  observability
}: OpenWorkcellParams) {
  pricing.requirePrices([
    models.orchestrator.model,
    models.worker.model,
    models.compaction.model
  ])
  const isStarter = isStarterIn(senders.starterIds)
  const secretValues = Object.values(secrets)
  const activity = createWorkerActivity({ pricing, secretValues })
  const host = createAgentHost({
    acceptInput: acceptAllowedSenders(senders),
    observability: { onOperation: activity.onOperation },
    persistence: createHarnessPersistence({
      database,
      logger: logger.child({ module: 'store' })
    }),
    credentials: readOnlyCredentials(secrets),
    logger: toTanStackLogger(logger.child({ module: 'harness' }))
  })
  const repositoryOf = async (threadId: string) => {
    const entry = await host.sessions.get({ threadId })

    return workerMetadataSchema.parse(entry?.metadata).repository
  }
  const instances = createSandboxInstanceStore(database)
  const workerSandbox = createWorkerSandbox({
    sandboxes,
    repositoryOf,
    listSandboxes: sandboxProvider.list,
    instances,
    changes: createWorkerChangesStore(database),
    gitIdentity,
    logger
  })
  const library = createLibrarySandbox({
    ...libraryOptions,
    listSandboxes: sandboxProvider.list,
    instances,
    logger
  })
  const lifecycle = createWorkerLifecycle({
    host,
    sandboxes,
    sandboxProvider,
    sharedSandboxKeys: [library.key],
    workerSandbox,
    logger,
    secretValues,
    maxRunningTurns,
    idleSandboxMs
  })
  const harness = defineWorkerHarness({
    adapter: models.worker,
    compactionAdapter: models.compaction,
    workspace: workerSandbox.workspace,
    lifecycle: lifecycle.plugin,
    skillDirs,
    redactedSecretNames: Object.keys(secrets),
    pricing,
    defaultLimits,
    plugins: [activity.plugin, ...plugins],
    observability
  })
  const repositories = Object.keys(sandboxes)
  const workers = createWorkers({
    host,
    harness,
    lifecycle,
    isStarter,
    repositories,
    workerNames,
    permissionMode,
    logger
  })
  const orchestratorHarness = defineOrchestratorHarness({
    ...orchestratorOptions,
    adapter: models.orchestrator,
    compactionAdapter: models.compaction,
    library,
    workers,
    isStarter,
    repositories,
    pricing,
    observability
  })
  const startLog = logger.child({ module: 'host' })
  await waitUntilReady(
    'database',
    async () => {
      return database.query('host-start', 'SELECT 1')
    },
    startLog
  )
  await waitUntilReady('sandbox provider', sandboxProvider.list, startLog)
  await workers.recover()

  return {
    host,
    harness,
    workers,
    library,
    orchestrator: createOrchestrator({ host, harness: orchestratorHarness }),
    viewWorkers: createWorkerView({
      host,
      harness,
      lifecycle,
      activity,
      workerSandbox,
      pricing
    }),
    [Symbol.asyncDispose]: async () => {
      await host.close({ recoverable: true })
      await lifecycle.stopIdleTimers()
      await destroyEverySandbox(sandboxProvider, logger)
    }
  }
}
