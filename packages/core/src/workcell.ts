import { isDeepStrictEqual } from 'node:util'
import type { AnyTextAdapter } from '@tanstack/ai'
import {
  createHarnessHost,
  type HarnessPlugin,
  type PermissionMode
} from '@tanstack/ai-harness'
import {
  resolveAllSecrets,
  type SandboxDefinition,
  type Secrets
} from '@tanstack/ai-sandbox'
import type { ModelPricing } from './budget/budget.ts'
import type { BudgetLimits } from './budget/limits.ts'
import type { FeedbackOptions } from './feedback/feedback.ts'
import { createRecentFeedback } from './feedback/recent-feedback.ts'
import { sendFiles, type ReadAgentFile } from './files/send-files.ts'
import {
  acceptAllowedSenders,
  isStarterIn,
  type AcceptAllowedSendersParams
} from './host/allowed-senders.ts'
import { readOnlyCredentials } from './host/read-only-credentials.ts'
import { toTanStackLogger, type LeveledLog } from './host/tanstack-logger.ts'
import { waitUntilReady } from './host/wait-until-ready.ts'
import {
  createMessageReader,
  type MessageFileOptions
} from './inputs/message-files.ts'
import { defineOrchestratorHarness } from './orchestrator/orchestrator-harness.ts'
import { createOrchestrator } from './orchestrator/orchestrator.ts'
import {
  createLibrarySandbox,
  type LibraryRepositories
} from './sandbox/library-sandbox.ts'
import { workerMetadataSchema } from './session/metadata.ts'
import {
  mcpSkillSources,
  type McpSkillServer
} from './skills/mcp-skill-source.ts'
import type { Database } from './store/database.ts'
import { createHarnessPersistence } from './store/harness-persistence.ts'
import { createSandboxInstanceStore } from './store/sandbox-instance-store.ts'
import type { SentFileStore } from './store/sent-file-store.ts'
import { createWorkerChangesStore } from './store/worker-changes-store.ts'
import {
  workcellTracer,
  type WorkerObservability
} from './telemetry/worker-telemetry.ts'
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
import { createWorkers, type OnWorkerStart } from './workers/workers.ts'

const FINISHED_TASK_DAYS = 7

type WorkcellLogger = {
  child: (bindings: Record<string, unknown>) => LeveledLog
}

type OpenWorkcellParams = {
  database: Database
  migrateCommand: string
  logger: WorkcellLogger
  models: {
    orchestrator: AnyTextAdapter
    worker: AnyTextAdapter
    compaction: AnyTextAdapter
    subagent?: AnyTextAdapter
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
    scope?: string
    skills?: {
      dirs: readonly string[]
      servers?: readonly McpSkillServer[]
    }
  }
  gitIdentity: WorkerIdentityEnvParams
  workerNames: readonly string[]
  skills: {
    dirs: readonly string[]
    servers?: readonly McpSkillServer[]
  }
  defaultLimits: BudgetLimits
  plugins: readonly HarnessPlugin[]
  maxRunningTurns: number
  finishedTaskDays?: number
  permissionMode?: PermissionMode
  idleSandboxMs?: number
  observability?: WorkerObservability
  onWorkerStart?: OnWorkerStart
  messageFiles?: MessageFileOptions
  sentFiles?: SentFileStore
  feedback?: FeedbackOptions
}

export abstract class StartRefusalError extends Error {
  abstract readonly details: Record<string, unknown>

  constructor(message: string) {
    super(message)
    this.name = 'StartRefusalError'
  }
}

export class SchemaBehindError extends StartRefusalError {
  readonly pendingMigrations: readonly string[]

  constructor(pendingMigrations: readonly string[], migrateCommand: string) {
    super(
      `The database schema is behind the code: ${pendingMigrations.join(', ')} never ran. Run ${migrateCommand}, then start again.`
    )
    this.name = 'SchemaBehindError'
    this.pendingMigrations = pendingMigrations
  }

  get details() {
    return { pendingMigrations: this.pendingMigrations }
  }
}

export class DuplicateSandboxPackageError extends StartRefusalError {
  readonly sandboxIds: readonly string[]

  constructor(sandboxIds: readonly string[]) {
    super(
      `The core cannot read the workspace secrets of ${sandboxIds.join(', ')}: two copies of @tanstack/ai-sandbox are loaded. Install from the parent workspace only, then force a reinstall, such as \`pnpm install --force\`.`
    )
    this.name = 'DuplicateSandboxPackageError'
    this.sandboxIds = sandboxIds
  }

  get details() {
    return { sandboxIds: this.sandboxIds }
  }
}

export class SkillPrefixConflictError extends StartRefusalError {
  readonly prefix: string

  constructor(prefix: string) {
    super(
      `Two different skill servers share the prefix ${prefix}: give each prefix one server, or each server its own prefix.`
    )
    this.name = 'SkillPrefixConflictError'
    this.prefix = prefix
  }

  get details() {
    return { prefix: this.prefix }
  }
}

function isSameSkillServer(
  first: McpSkillServer['server'],
  second: McpSkillServer['server']
) {
  if (first instanceof URL && second instanceof URL) {
    return first.href === second.href
  }

  return isDeepStrictEqual(first, second)
}

function requireOneServerPerPrefix(servers: readonly McpSkillServer[]) {
  const conflict = servers.find((server, index) => {
    return servers.slice(0, index).some((earlier) => {
      return (
        earlier.prefix === server.prefix &&
        !isSameSkillServer(earlier.server, server.server)
      )
    })
  })

  if (conflict !== undefined) {
    throw new SkillPrefixConflictError(conflict.prefix)
  }
}

function isReadableByTheCore(secrets: Secrets) {
  try {
    resolveAllSecrets(secrets)

    return true
  } catch {
    return false
  }
}

function requireOneSandboxPackage(sandboxes: readonly SandboxDefinition[]) {
  const unreadableIds = sandboxes.flatMap(({ id, workspace }) => {
    return workspace?.secrets === undefined ||
      isReadableByTheCore(workspace.secrets)
      ? []
      : [id]
  })

  if (unreadableIds.length > 0) {
    throw new DuplicateSandboxPackageError(unreadableIds)
  }
}

async function requireCurrentSchema(
  database: Database,
  migrateCommand: string,
  log: LeveledLog
) {
  await waitUntilReady(
    'database',
    async () => {
      return database.query('host-start', 'SELECT 1')
    },
    log
  )
  const pendingMigrations = await database.pendingMigrations()

  if (pendingMigrations.length > 0) {
    throw new SchemaBehindError(pendingMigrations, migrateCommand)
  }
}

export async function openWorkcell({
  database,
  migrateCommand,
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
  skills,
  defaultLimits,
  plugins,
  permissionMode = 'acceptEdits',
  maxRunningTurns,
  finishedTaskDays = FINISHED_TASK_DAYS,
  idleSandboxMs,
  observability,
  onWorkerStart,
  messageFiles,
  sentFiles,
  feedback
}: OpenWorkcellParams) {
  requireOneSandboxPackage([
    ...Object.values(sandboxes),
    libraryOptions.sandbox
  ])
  const recentFeedback = createRecentFeedback()
  const feedbackOptions = {
    ...feedback,
    deliver: recentFeedback.deliverThrough(feedback?.deliver)
  }
  const skillServers = [
    ...(skills.servers ?? []),
    ...(orchestratorOptions.skills?.servers ?? [])
  ]
  requireOneServerPerPrefix(skillServers)
  const startLog = logger.child({ module: 'host' })
  await requireCurrentSchema(database, migrateCommand, startLog)
  const subagentModel = models.subagent ?? models.worker
  pricing.requirePrices([
    models.orchestrator.model,
    models.worker.model,
    models.compaction.model,
    subagentModel.model
  ])
  const isStarter = isStarterIn(senders.starterIds)
  const filesLog = logger.child({ module: 'files' })
  const messageReaderOf = (model: AnyTextAdapter) => {
    return createMessageReader({
      modalities: model.inputModalities,
      options: messageFiles,
      logger: filesLog
    })
  }
  const secretValues = Object.values(secrets)
  const sendFilesFrom = (readFile: ReadAgentFile) => {
    return sentFiles === undefined
      ? []
      : [sendFiles({ sentFiles, readFile, secretValues })]
  }
  const activity = createWorkerActivity({ pricing, secretValues })
  const skillSources = mcpSkillSources(
    skillServers,
    logger.child({ module: 'skills' })
  )
  const tracer = workcellTracer(observability)
  const host = createHarnessHost({
    acceptInput: acceptAllowedSenders(senders),
    observability: {
      tracer,
      onOperation: activity.onOperation
    },
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
    pricing,
    tracer,
    idleSandboxMs
  })
  const harness = defineWorkerHarness({
    adapter: models.worker,
    compactionAdapter: models.compaction,
    subagentAdapter: subagentModel,
    workspace: workerSandbox.workspace,
    lifecycle: lifecycle.plugin,
    skills: { dirs: skills.dirs, sources: skillSources.of(skills.servers) },
    redactedSecretNames: Object.keys(secrets),
    pricing,
    defaultLimits,
    plugins: [
      activity.plugin,
      workerSandbox.plugin,
      ...sendFilesFrom(workerSandbox.readFile),
      ...plugins
    ],
    feedback: feedbackOptions,
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
    logger,
    readMessage: messageReaderOf(models.worker),
    onWorkerStart
  })
  const { viewWorkers, inspectWorkers, readWorkerDiff } = createWorkerView({
    host,
    harness,
    readWorkers: workers.readWorkers,
    readFinishedWorkers: async () => {
      return workers.readFinishedWorkers(
        Temporal.Now.zonedDateTimeISO('UTC')
          .subtract({ days: finishedTaskDays })
          .toInstant()
      )
    },
    lifecycle,
    activity,
    workerSandbox,
    pricing,
    secretValues
  })
  const orchestratorHarness = defineOrchestratorHarness({
    ...orchestratorOptions,
    skills: {
      dirs: orchestratorOptions.skills?.dirs ?? [],
      sources: skillSources.of(orchestratorOptions.skills?.servers)
    },
    plugins: [
      ...orchestratorOptions.plugins,
      ...sendFilesFrom(async (_threadId, path) => {
        return library.readFile(path)
      })
    ],
    adapter: models.orchestrator,
    compactionAdapter: models.compaction,
    library,
    workers,
    viewWorkers,
    isStarter,
    repositories,
    pricing,
    feedback: feedbackOptions,
    observability
  })
  await waitUntilReady('sandbox provider', sandboxProvider.list, startLog)
  await workers.recover()

  return {
    host,
    harness,
    workers,
    library,
    orchestrator: createOrchestrator({
      host,
      harness: orchestratorHarness,
      readMessage: messageReaderOf(models.orchestrator)
    }),
    viewWorkers,
    inspectWorkers,
    readWorkerDiff,
    listRecentFeedback: recentFeedback.listRecentFeedback,
    [Symbol.asyncDispose]: async () => {
      await host.close({ recoverable: true })
      await skillSources[Symbol.asyncDispose]()
      await lifecycle.stopIdleTimers()
      await destroyEverySandbox(sandboxProvider, logger)
    }
  }
}
