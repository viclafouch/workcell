import { once } from 'node:events'
import { z } from 'zod'
import {
  EventType,
  toolDefinition,
  type ChatMiddleware,
  type Interrupt,
  type StreamChunk
} from '@tanstack/ai'
import {
  createExtensionPoint,
  definePlugin,
  durableTool,
  PermissionRules,
  SHUTDOWN_REASON,
  waitKind,
  type HarnessHost,
  type HarnessRunContext
} from '@tanstack/ai-harness'
import type { SandboxDefinition, SandboxProvider } from '@tanstack/ai-sandbox'
import { scrubSecrets } from '@tanstack/ai/byok'
import { AsyncQueuer } from '@tanstack/pacer'
import type { LogLine } from '#/host/mcp-server-log.ts'
import {
  branchFact,
  FINISH_TASK_TEXT,
  FINISH_WITHOUT_STOP_REFUSAL,
  shallowCloneFact,
  workerIdentityPrompt
} from '#/prompts/worker.ts'
import type { ListSandboxes } from '#/sandbox/sandboxes-under-keys.ts'
import {
  workerMetadataSchema,
  type WorkerMetadata
} from '#/session/metadata.ts'
import type { WorkerSandbox } from './worker-sandbox.ts'

const MS_PER_MINUTE = 60_000

const IDLE_SANDBOX_MINUTES = 30

const IDLE_SANDBOX_MS = IDLE_SANDBOX_MINUTES * MS_PER_MINUTE

const FINISH_TASK = 'finish_task'

const LIFECYCLE_PLUGIN = 'workcell/worker-lifecycle'

const PERSON_INPUT = 'person:'

export function personInputId(inputId: string) {
  return `${PERSON_INPUT}${inputId}`
}

function isPersonInput(inputId: string | undefined) {
  return inputId?.startsWith(PERSON_INPUT) === true
}

const commandSchema = z.object({ command: z.string() })

export type ListedSandboxProvider = Pick<SandboxProvider, 'destroy'> & {
  list: ListSandboxes
}

export type RepositorySandboxes = Readonly<Record<string, SandboxDefinition>>

type WorkerLog = { info: LogLine; warn: LogLine; error: LogLine }

export type WorkerLogger = {
  child: (bindings: Record<string, unknown>) => WorkerLog
}

type CreateWorkerLifecycleParams = {
  host: HarnessHost
  sandboxes: RepositorySandboxes
  sandboxProvider: ListedSandboxProvider
  sharedSandboxKeys: readonly string[]
  workerSandbox: Pick<WorkerSandbox, 'rebind' | 'save' | 'forget'>
  logger: WorkerLogger
  secretValues: readonly string[]
  maxRunningTurns: number
  idleSandboxMs?: number
}

type TurnSlot = {
  threadId: string
  signal: AbortSignal
  started: PromiseWithResolvers<null>
  ended: PromiseWithResolvers<null>
}

export type NamedWorker = { threadId: string; name?: string }

type SweptWorker = NamedWorker & { updatedAt: number }

type IndexEntryUpdate = (current: { metadata?: WorkerMetadata }) => {
  metadata?: WorkerMetadata
}

type WorkerEnd = {
  worker: NamedWorker
  report: string
  updateIndexEntry: (update: IndexEntryUpdate) => Promise<void>
}

type FinishStep = { name: string; run: () => Promise<void> }

type FinishStepsParams = WorkerEnd & {
  log: WorkerLog
  destroySandbox: () => Promise<void>
  workerSandbox: Pick<WorkerSandbox, 'forget'>
  host: HarnessHost
}

function finishSteps({
  worker,
  report,
  updateIndexEntry,
  log,
  destroySandbox,
  workerSandbox,
  host
}: FinishStepsParams): FinishStep[] {
  return [
    {
      name: 'report',
      run: async () => {
        log.info({ report }, 'worker report')
        await updateIndexEntry((current) => {
          return current.metadata === undefined
            ? {}
            : { metadata: { ...current.metadata, report } }
        })
      }
    },
    { name: 'destroy-sandbox', run: destroySandbox },
    {
      name: 'forget-changes',
      run: async () => {
        await workerSandbox.forget(worker)
      }
    },
    {
      name: 'archive',
      run: async () => {
        await host.sessions.archive({ threadId: worker.threadId })
        log.info({}, 'worker finished')
      }
    }
  ]
}

type TaskFact = (metadata: WorkerMetadata) => string | undefined

export const TaskFacts = createExtensionPoint<TaskFact>('workcell/task-facts')

type FinishRefusal = (metadata: WorkerMetadata) => Promise<string | undefined>

export const FinishRefusals = createExtensionPoint<FinishRefusal>(
  'workcell/finish-refusals'
)

async function refuseFinish(
  refusals: readonly FinishRefusal[],
  metadata: WorkerMetadata | null
) {
  if (metadata === null) {
    return
  }

  const reasons = await Promise.all(
    refusals.map((refusal) => {
      return refusal(metadata)
    })
  )
  const refusal = reasons.find((reason) => {
    return reason !== undefined
  })

  if (refusal !== undefined) {
    throw new Error(refusal)
  }
}

const branchOfTask: TaskFact = ({ branch }) => {
  return branch === undefined ? undefined : branchFact(branch)
}

function cloneHistoryOf(sandboxes: RepositorySandboxes): TaskFact {
  return ({ repository }) => {
    const source = sandboxes[repository]?.workspace?.source

    return source?.type === 'git' && source.depth !== 'full'
      ? shallowCloneFact(source.depth ?? 1)
      : undefined
  }
}

type PromptFacts = () => {
  metadata: WorkerMetadata | null
  facts: readonly TaskFact[]
}

function workerPrompts(factsOf: PromptFacts) {
  return [
    {
      id: 'workcell/worker-identity',
      text: () => {
        const { metadata } = factsOf()

        return metadata === null ? '' : workerIdentityPrompt(metadata.name)
      }
    },
    {
      id: 'workcell/worker-facts',
      text: () => {
        const { metadata, facts } = factsOf()

        return taskFactsText(facts, metadata)
      },
      placement: 'context' as const
    }
  ]
}

function taskFactsText(
  facts: readonly TaskFact[],
  metadata: WorkerMetadata | null
) {
  return metadata === null
    ? ''
    : facts
        .flatMap((fact) => {
          return fact(metadata) ?? []
        })
        .join('\n')
}

const finishTaskDefinition = toolDefinition({
  name: FINISH_TASK,
  description: FINISH_TASK_TEXT.description,
  inputSchema: z.object({
    report: z.string().describe(FINISH_TASK_TEXT.report)
  })
})

function restartToFillTheFreeSlots(turns: AsyncQueuer<TurnSlot>) {
  turns.stop()
  turns.start()
}

function createTurnQueue(maxRunningTurns: number) {
  const turns = new AsyncQueuer<TurnSlot>(
    async (slot) => {
      if (slot.signal.aborted) {
        return
      }

      slot.started.resolve(null)
      await slot.ended.promise
    },
    { concurrency: maxRunningTurns }
  )

  const waitForSlot = async (slot: TurnSlot, log: WorkerLog) => {
    turns.addItem(slot)
    restartToFillTheFreeSlots(turns)

    if (turns.peekPendingItems().includes(slot)) {
      log.info({}, 'worker queued')
    }

    await Promise.race([slot.started.promise, once(slot.signal, 'abort')])
  }

  const isQueued = (threadId: string) => {
    return turns.peekPendingItems().some((slot) => {
      return slot.threadId === threadId && !slot.signal.aborted
    })
  }

  return { waitForSlot, isQueued }
}

function createIdleTimers(
  destroyIdleSandbox: (worker: NamedWorker) => Promise<void>
) {
  const timers = new Map<string, NodeJS.Timeout>()
  const destroys = new Map<string, Promise<void>>()

  const clear = (threadId: string) => {
    clearTimeout(timers.get(threadId))
    timers.delete(threadId)
  }

  const destroyOnce = async (worker: NamedWorker) => {
    try {
      await destroyIdleSandbox(worker)
    } finally {
      destroys.delete(worker.threadId)
    }
  }

  const start = (worker: NamedWorker, delayMs: number) => {
    clear(worker.threadId)
    const timer = setTimeout(() => {
      timers.delete(worker.threadId)
      destroys.set(worker.threadId, destroyOnce(worker))
    }, delayMs)
    timer.unref()
    timers.set(worker.threadId, timer)
  }

  const stop = async (threadId: string) => {
    clear(threadId)
    await destroys.get(threadId)
  }

  const stopAll = async () => {
    for (const threadId of timers.keys()) {
      clear(threadId)
    }

    await Promise.all(destroys.values())
  }

  return { start, stop, stopAll }
}

export function pausedInterrupts(chunk: StreamChunk): Interrupt[] | undefined {
  return chunk.type === EventType.RUN_FINISHED &&
    chunk.outcome?.type === 'interrupt'
    ? chunk.outcome.interrupts
    : undefined
}

function turnLogs(
  logOfTurn: () => WorkerLog,
  secretValues: readonly string[]
): ChatMiddleware {
  return {
    name: 'workcell/worker-turn-logs',
    onBeforeToolCall: (_ctx, { args }) => {
      const call = commandSchema.safeParse(args)

      if (call.success) {
        logOfTurn().info(
          { command: scrubSecrets(call.data.command, secretValues) },
          'bash call'
        )
      }
    },
    onChunk: (_ctx, chunk) => {
      for (const interrupt of pausedInterrupts(chunk) ?? []) {
        logOfTurn().info(
          { kind: waitKind(interrupt), question: interrupt.message },
          'worker waits for a person'
        )
      }
    }
  }
}

const stopOnCancelledAnswers: ChatMiddleware = {
  name: 'workcell/worker-stop-on-cancelled-answers',
  onInterruptResolution: (_ctx, resolutions) => {
    const answers = resolutions.all()
    const isStopped =
      answers.length > 0 &&
      answers.every(({ status }) => {
        return status === 'cancelled'
      })

    return isStopped ? { toolResume: 'stop' } : undefined
  }
}

export async function destroyEverySandbox(
  sandboxProvider: ListedSandboxProvider,
  logger: WorkerLogger
) {
  const log = logger.child({ module: 'agents' })
  const listed = await sandboxProvider.list()
  await Promise.all(
    listed.map(async ({ id }) => {
      try {
        await sandboxProvider.destroy({ id })
      } catch (error) {
        log.error({ sandboxId: id, error }, 'sandbox not destroyed at stop')
      }
    })
  )
  log.info({ count: listed.length }, 'sandboxes destroyed at stop')
}

export function createWorkerLifecycle({
  host,
  sandboxes,
  sandboxProvider,
  sharedSandboxKeys,
  workerSandbox,
  logger,
  secretValues,
  maxRunningTurns,
  idleSandboxMs = IDLE_SANDBOX_MS
}: CreateWorkerLifecycleParams) {
  const busyThreads = new Set<string>()
  const turnQueue = createTurnQueue(maxRunningTurns)

  const logOf = ({ threadId, name }: NamedWorker) => {
    return logger.child({ module: 'agents', threadId, name })
  }

  const sandboxKeysOf = (threadId: string) => {
    return Object.values(sandboxes).map((sandbox) => {
      return sandbox.key({ threadId, runId: threadId })
    })
  }

  const destroySandboxOf = async (worker: NamedWorker) => {
    const keys = new Set(sandboxKeysOf(worker.threadId))
    const listed = await sandboxProvider.list()
    const owned = listed.filter(({ key }) => {
      return keys.has(key)
    })
    await Promise.all(
      owned.map(({ id }) => {
        return sandboxProvider.destroy({ id })
      })
    )

    if (owned.length > 0) {
      logOf(worker).info({}, 'worker sandbox destroyed')
    }
  }

  const idleTimers = createIdleTimers(async (worker) => {
    try {
      await destroySandboxOf(worker)
    } catch (error) {
      logOf(worker).error({ error }, 'idle sandbox not destroyed')
    }
  })

  const stepsOf = (end: WorkerEnd) => {
    return finishSteps({
      ...end,
      log: logOf(end.worker),
      destroySandbox: async () => {
        await idleTimers.stop(end.worker.threadId)
        await destroySandboxOf(end.worker)
      },
      workerSandbox,
      host
    })
  }

  const finish = async (end: WorkerEnd) => {
    for (const { run } of stepsOf(end)) {
      // oxlint-disable-next-line no-await-in-loop -- the finish steps run in order
      await run()
    }
  }

  const plugin = definePlugin({
    name: LIFECYCLE_PLUGIN,
    metadataSchema: workerMetadataSchema,
    setup: (setupContext) => {
      const { threadId } = setupContext.session
      let worker: NamedWorker = { threadId }
      let metadata: WorkerMetadata | null = null
      let slot: TurnSlot | null = null
      let isFinished = false
      let isPersonTurn = false

      const saveChanges = async () => {
        const branch = await workerSandbox.save(worker)
        const turnMetadata = metadata

        if (
          turnMetadata === null ||
          branch === null ||
          branch === turnMetadata.branch
        ) {
          return
        }

        const entry = await setupContext.session.updateIndexEntry((current) => {
          return { metadata: { ...(current.metadata ?? turnMetadata), branch } }
        })
        metadata = entry?.metadata ?? null
      }

      const endTurn = async ({ isShutdown = false } = {}) => {
        const endedSlot = slot

        if (endedSlot === null) {
          return
        }

        slot = null

        if (!isFinished) {
          await saveChanges()
        }

        endedSlot.ended.resolve(null)
        busyThreads.delete(threadId)

        if (isFinished || isShutdown) {
          return
        }

        logOf(worker).info({}, 'worker idle')
        idleTimers.start(worker, idleSandboxMs)
      }

      const turnSlots: ChatMiddleware<HarnessRunContext> = {
        name: 'workcell/worker-turn-slots',
        onStart: async ({ context }) => {
          busyThreads.add(threadId)
          isFinished = false
          const turnSlot: TurnSlot = {
            threadId,
            signal: context.run.signal,
            started: Promise.withResolvers(),
            ended: Promise.withResolvers()
          }
          slot = turnSlot
          await turnQueue.waitForSlot(turnSlot, logOf(worker))
          logOf(worker).info({}, 'worker running')
        },
        onAfterToolCall: (_ctx, { toolName, ok }) => {
          if (toolName === FINISH_TASK && ok) {
            isFinished = true
          }
        },
        onShouldContinue: () => {
          return !isFinished
        },
        onChunk: async (_ctx, chunk) => {
          if (pausedInterrupts(chunk) !== undefined) {
            await endTurn()
          }
        },
        onFinish: async () => {
          await endTurn()
        },
        onAbort: async (_ctx, { reason }) => {
          await endTurn({ isShutdown: reason === SHUTDOWN_REASON })
        },
        onError: async () => {
          await endTurn()
        }
      }

      const finishTask = durableTool(
        finishTaskDefinition,
        async ({ report }, { step }) => {
          if (!isPersonTurn) {
            throw new Error(FINISH_WITHOUT_STOP_REFUSAL)
          }

          await saveChanges()
          await refuseFinish(setupContext.collect(FinishRefusals), metadata)
          const steps = stepsOf({
            worker,
            report,
            updateIndexEntry: async (update) => {
              await setupContext.session.updateIndexEntry(update)
            }
          })

          for (const { name, run } of steps) {
            // oxlint-disable-next-line no-await-in-loop -- the finish steps run in order
            await step.do(name, async () => {
              await run()

              return true
            })
          }

          return 'The task is finished.'
        }
      )

      return {
        onTurnStart: async ({ run, inputId }) => {
          isPersonTurn = isPersonInput(inputId)
          await idleTimers.stop(threadId)
          const entry = await setupContext.session.indexEntry()
          metadata = entry?.metadata ?? null
          worker = { threadId, name: metadata?.name }
          await workerSandbox.rebind(run)
        },
        prompts: workerPrompts(() => {
          return { metadata, facts: setupContext.collect(TaskFacts) }
        }),
        middleware: [
          turnLogs(() => {
            return logOf(worker)
          }, secretValues),
          turnSlots,
          stopOnCancelledAnswers
        ],
        tools: [finishTask],
        contribute: [
          TaskFacts.item(branchOfTask),
          TaskFacts.item(cloneHistoryOf(sandboxes)),
          PermissionRules.item({
            tool: FINISH_TASK,
            decision: 'allow',
            kind: 'execute'
          })
        ]
      }
    }
  })

  const sweep = async (liveWorkers: SweptWorker[]) => {
    const workersByKey = new Map<string, SweptWorker>(
      liveWorkers.flatMap((worker) => {
        return sandboxKeysOf(worker.threadId).map((key) => {
          return [key, worker]
        })
      })
    )
    const listed = await sandboxProvider.list()
    const workerSandboxes = listed.filter(({ key }) => {
      return !sharedSandboxKeys.includes(key)
    })
    await Promise.all(
      workerSandboxes.map(async ({ id, key }) => {
        const worker = workersByKey.get(key)

        if (worker !== undefined && busyThreads.has(worker.threadId)) {
          return
        }

        if (worker === undefined) {
          await sandboxProvider.destroy({ id })
          logger
            .child({ module: 'agents' })
            .info({ sandboxId: id }, 'orphan sandbox destroyed')

          return
        }

        const idleMs =
          Temporal.Now.instant().epochMilliseconds - worker.updatedAt

        if (idleMs >= idleSandboxMs) {
          await destroySandboxOf(worker)

          return
        }

        idleTimers.start(worker, idleSandboxMs - idleMs)
      })
    )
  }

  return {
    plugin,
    finish,
    isQueued: turnQueue.isQueued,
    sweep,
    stopIdleTimers: idleTimers.stopAll
  }
}

export type WorkerLifecycle = ReturnType<typeof createWorkerLifecycle>
