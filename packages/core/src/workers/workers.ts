import { randomUUIDv7 } from 'node:crypto'
import type {
  HarnessHost,
  HarnessSession,
  HarnessUser,
  PendingWait,
  PermissionMode,
  SubmitInput
} from '@tanstack/ai-harness'
import { InMemoryLockStore } from '@tanstack/ai/locks'
import { refusalOf, type IsStarter } from '#/host/allowed-senders.ts'
import { logMcpServerChanges } from '#/host/mcp-server-log.ts'
import type { MessageFile, MessageReader } from '#/inputs/message-files.ts'
import { FILES_ANSWER } from '#/prompts/worker.ts'
import type { TaskEnd, WorkerMetadata } from '#/session/metadata.ts'
import type { WorkerHarness } from './harness.ts'
import {
  personInputId,
  type WorkerLifecycle,
  type WorkerLogger
} from './lifecycle.ts'
import {
  listedWorkerOf,
  trackWorkerChanges,
  type ListedWorker,
  type OnWorkerChange
} from './live-workers.ts'
import { pickFreeName } from './worker-names.ts'

const REJECTED_BY_A_PERSON =
  'A person rejected this call. Go on without it, with the calls that the rules allow.'

const WORKERS_LOCK = 'workcell/workers'

type WorkerLog = ReturnType<WorkerLogger['child']>

type WorkersOptions = {
  host: HarnessHost
  harness: WorkerHarness
  lifecycle: WorkerLifecycle
  isStarter: IsStarter
  repositories: readonly string[]
  workerNames: readonly string[]
  permissionMode: PermissionMode
  logger: WorkerLogger
  readMessage: MessageReader
  onWorkerStart?: OnWorkerStart
}

export type WorkerTask = {
  starter: HarnessUser
  task: string
  repository: string
  entrySkill?: string
  subject?: string
  branch?: string
  inputId?: string
}

export type OnWorkerStart = (
  worker: WorkerMetadata & { threadId: string }
) => Promise<Readonly<Record<string, unknown>>>

export type WakeWorkerParams = {
  threadId: string
  inputId: string
  message: string
  delivery: 'steer' | 'followUp'
}

export type WorkerFinish = {
  threadId: string
  report: string
  outcome: TaskEnd
}

export type UpdateWorkerParams = {
  threadId: string
  metadata: Readonly<Record<string, unknown>>
}

export type StopWorkerParams = { threadId: string; user: HarnessUser }

export type MessageWorkerParams = {
  threadId: string
  sender: HarnessUser
  inputId: string
  message: string
  files?: readonly MessageFile[]
}

export type WorkerApproval = {
  threadId: string
  waitId: string
  approver: HarnessUser
  answer: 'once' | 'reject'
}

function refuseSecondWorker(
  workers: ListedWorker[],
  { subject, branch }: WorkerTask
) {
  const busy = workers.find((worker) => {
    return (
      (subject !== undefined && worker.subject === subject) ||
      (branch !== undefined && worker.branch === branch)
    )
  })

  if (busy !== undefined) {
    throw new Error(
      `${busy.name} already works on ${busy.subject ?? busy.branch}: steer it in its thread ${busy.threadId}, or wait until it finishes.`
    )
  }
}

function turnWaitsOf(waits: readonly PendingWait[]) {
  return waits.filter(({ turn }) => {
    return turn === true
  })
}

function answersOf(waits: readonly PendingWait[], message: string) {
  return turnWaitsOf(waits).map(({ waitId, kind }) => {
    return {
      interruptId: waitId,
      status: 'resolved' as const,
      payload: kind === 'approval' ? { answer: 'reject', message } : message
    }
  })
}

function approvalAnswers(
  waits: readonly PendingWait[],
  askedWaitId: string,
  answer: WorkerApproval['answer']
) {
  const asked = waits.find(({ waitId, turn }) => {
    return waitId === askedWaitId && turn === true
  })
  const payload =
    answer === 'once' ? { answer } : { answer, message: REJECTED_BY_A_PERSON }

  return waits
    .filter(({ turn, kind, runId }) => {
      return turn === true && kind === 'approval' && runId === asked?.runId
    })
    .map(({ waitId }) => {
      return { interruptId: waitId, status: 'resolved' as const, payload }
    })
}

async function noStartMetadata() {
  return {}
}

type OpenedWorker = {
  session: HarnessSession<WorkerHarness>
  metadata: WorkerMetadata
}

type StartHookParams = {
  session: HarnessSession<WorkerHarness>
  metadata: WorkerMetadata
  log: WorkerLog
  onWorkerStart: OnWorkerStart
}

async function runStartHook({
  session,
  metadata,
  log,
  onWorkerStart
}: StartHookParams) {
  try {
    const started = await onWorkerStart({
      threadId: session.threadId,
      ...metadata
    })
    await session.updateIndexEntry((current) => {
      return current.metadata === undefined
        ? {}
        : { metadata: { ...started, ...current.metadata } }
    })
  } catch (error) {
    log.error({ error }, 'worker start hook failed')
  }
}

async function driveFirstTurn(
  session: HarnessSession<WorkerHarness>,
  log: WorkerLog
) {
  const stopListening = logMcpServerChanges(session, log)

  try {
    await session.whenIdle()
    log.info({ usage: session.usage().total }, 'first turn settled')
  } catch (error) {
    log.error({ error }, 'worker turn failed')
  } finally {
    stopListening()
    await session.close()
  }
}

type WorkerInput = {
  threadId: string
  user: HarnessUser
  input: SubmitInput
  inputId: string
}

async function submitInput(
  { host, harness }: Pick<WorkersOptions, 'host' | 'harness'>,
  { threadId, user, input, inputId }: WorkerInput
) {
  const receipt = await host.submit({
    harness,
    threadId,
    user,
    input,
    inputId
  })

  if (receipt.status === 'rejected' && receipt.reason === 'conflict') {
    return false
  }

  if (receipt.status === 'rejected') {
    throw new Error(
      `The worker of the thread ${threadId} refused the input ${inputId}: ${receipt.reason}.`
    )
  }

  await host.resumePending({ harnesses: [harness] })

  return true
}

function liveWorkerTracker(
  options: Pick<WorkersOptions, 'host' | 'harness' | 'lifecycle' | 'logger'>,
  readWorkers: () => Promise<ListedWorker[]>
) {
  return (onChange: OnWorkerChange = () => {}) => {
    return trackWorkerChanges({ ...options, readWorkers, onChange })
  }
}

type WorkerMessageOptions = Pick<
  WorkersOptions,
  'host' | 'harness' | 'readMessage'
>

async function readWorkerMessage(
  { host, harness, readMessage }: WorkerMessageOptions,
  { threadId, sender, files = [] }: MessageWorkerParams,
  text: string
) {
  if (files.length === 0) {
    return text
  }

  await using session = await host.open(harness, { threadId, user: sender })

  return await readMessage({ session, text, files })
}

async function sendWorkerMessage(
  options: WorkerMessageOptions,
  params: MessageWorkerParams
) {
  const { threadId, sender, inputId, message, files = [] } = params
  const view = await options.host.observe(options.harness, { threadId })
  const { pendingWaits } = await view.snapshot()
  const answers = answersOf(
    pendingWaits,
    message === '' && files.length > 0 ? FILES_ANSWER : message
  )

  if (answers.length === 0) {
    await submitInput(options, {
      threadId,
      user: sender,
      input: {
        op: 'steer',
        message: await readWorkerMessage(options, params, message)
      },
      inputId: personInputId(inputId)
    })

    return
  }

  await submitInput(options, {
    threadId,
    user: sender,
    input: { op: 'resolve', resume: answers },
    inputId: personInputId(inputId)
  })

  if (files.length > 0) {
    await submitInput(options, {
      threadId,
      user: sender,
      input: {
        op: 'followUp',
        message: await readWorkerMessage(options, params, '')
      },
      inputId: personInputId(`${inputId}:files`)
    })
  }
}

async function finishIdleWorker(
  {
    host,
    harness,
    lifecycle
  }: Pick<WorkersOptions, 'host' | 'harness' | 'lifecycle'>,
  { threadId, report, outcome }: WorkerFinish
) {
  const view = await host.observe(harness, { threadId })
  const { status, usage, plugins } = await view.snapshot()

  if (status === 'running' || lifecycle.isQueued(threadId)) {
    return false
  }

  const entry = await host.sessions.get({ threadId })
  const worker = entry === undefined ? undefined : listedWorkerOf(entry)

  if (worker === undefined || entry?.archived === true) {
    return true
  }

  await lifecycle.finish({
    worker: { threadId, name: worker.name },
    report,
    outcome,
    spending: { usage, plugins },
    updateIndexEntry: async (update) => {
      return host.sessions.update({ harness, threadId, update })
    }
  })

  return true
}

export function createWorkers({
  host,
  harness,
  lifecycle,
  isStarter,
  repositories,
  workerNames,
  permissionMode,
  logger,
  readMessage,
  onWorkerStart = noStartMetadata
}: WorkersOptions) {
  const locks = new InMemoryLockStore()

  const readWorkers = async (withArchived = false): Promise<ListedWorker[]> => {
    const { entries } = await host.sessions.list({
      harness: harness.name,
      withArchived
    })

    return entries.flatMap((entry) => {
      return listedWorkerOf(entry) ?? []
    })
  }

  const readFinishedWorkers = async (since: Temporal.Instant) => {
    const { entries } = await host.sessions.list({
      harness: harness.name,
      withArchived: true
    })

    return entries.flatMap((entry) => {
      const worker = entry.archived === true ? listedWorkerOf(entry) : undefined
      const outcome = worker?.outcome

      return worker !== undefined &&
        outcome !== undefined &&
        outcome.changedAt >= since.epochMilliseconds
        ? [{ ...worker, outcome }]
        : []
    })
  }

  const trackLiveWorkers = liveWorkerTracker(
    { host, harness, lifecycle, logger },
    readWorkers
  )

  const findWorkerOfInput = async (inputId: string) => {
    const workers = await readWorkers(true)

    return workers.find((worker) => {
      return worker.inputId === inputId
    })
  }

  const openNamedWorker = async (
    workerTask: WorkerTask
  ): Promise<OpenedWorker> => {
    const { starter, task, entrySkill, repository, subject, branch, inputId } =
      workerTask

    if (!isStarter(starter)) {
      throw refusalOf(starter)
    }

    const workers = await readWorkers()
    refuseSecondWorker(workers, workerTask)
    const liveNames = new Set(
      workers.map(({ name }) => {
        return name
      })
    )
    const metadata: WorkerMetadata = {
      name: pickFreeName(workerNames, liveNames),
      task,
      entrySkill,
      repository,
      subject,
      branch,
      inputId
    }
    const session = await host.open(harness, {
      threadId: randomUUIDv7(),
      user: starter
    })
    await session.updateIndexEntry({
      title: `${metadata.name} · ${subject ?? task}`,
      metadata
    })

    return { session, metadata }
  }

  const runNewWorker = async ({ session, metadata }: OpenedWorker) => {
    const { threadId } = session
    const { name, task, entrySkill, inputId } = metadata
    const log = logger.child({ module: 'agents', threadId, name })
    await runStartHook({ session, metadata, log, onWorkerStart })

    try {
      await session.setPluginSetting({ key: 'mode', value: permissionMode })
      await (entrySkill === undefined
        ? session.send(task, { inputId }).receipt
        : session.runCommand({ name: entrySkill, input: task, inputId }))
    } catch (error) {
      await session.close()
      throw error
    }

    log.info({ entrySkill }, 'worker started')

    return {
      threadId,
      name,
      isNew: true,
      firstTurn: driveFirstTurn(session, log)
    }
  }

  const startWorker = async (workerTask: WorkerTask) => {
    const { repository, inputId } = workerTask

    if (!repositories.includes(repository)) {
      throw new Error(
        `No sandbox runs the repository ${repository}. The workers run ${repositories.join(', ')}.`
      )
    }

    const opening = await locks.withLock(WORKERS_LOCK, async () => {
      const started =
        inputId === undefined ? undefined : await findWorkerOfInput(inputId)

      return started === undefined
        ? { opened: await openNamedWorker(workerTask) }
        : { started }
    })

    if (opening.started !== undefined) {
      const { threadId, name } = opening.started

      return { threadId, name, isNew: false, firstTurn: Promise.resolve() }
    }

    return runNewWorker(opening.opened)
  }

  const listWorkers = async () => {
    const workers = await readWorkers()

    return Promise.all(
      workers.map(async (worker) => {
        const view = await host.observe(harness, { threadId: worker.threadId })
        const { status } = await view.snapshot()
        const liveStatus = lifecycle.isQueued(worker.threadId)
          ? 'queued'
          : status

        return { ...worker, liveStatus }
      })
    )
  }

  const wakeWorker = async ({
    threadId,
    inputId,
    message,
    delivery
  }: WakeWorkerParams) => {
    const entry = await host.sessions.get({ threadId })
    const owner = entry?.members.find(({ role }) => {
      return role === 'owner'
    })

    if (owner === undefined) {
      throw new Error(`The worker of the thread ${threadId} has no starter.`)
    }

    await submitInput(
      { host, harness },
      {
        threadId,
        user: { id: owner.userId },
        input: { op: delivery, message },
        inputId
      }
    )
  }

  const finishWorker = async (finish: WorkerFinish) => {
    return finishIdleWorker({ host, harness, lifecycle }, finish)
  }

  const updateWorker = async ({ threadId, metadata }: UpdateWorkerParams) => {
    await host.sessions.update({
      harness,
      threadId,
      update: (current) => {
        return current.metadata === undefined
          ? {}
          : { metadata: { ...current.metadata, ...metadata } }
      }
    })
  }

  const messageWorker = async (params: MessageWorkerParams) => {
    await sendWorkerMessage({ host, harness, readMessage }, params)
  }

  const answerApproval = async ({
    threadId,
    waitId,
    approver,
    answer
  }: WorkerApproval) => {
    const view = await host.observe(harness, { threadId })
    const { pendingWaits } = await view.snapshot()
    const resume = approvalAnswers(pendingWaits, waitId, answer)

    if (resume.length === 0) {
      return false
    }

    return submitInput(
      { host, harness },
      {
        threadId,
        user: approver,
        input: { op: 'resolve', resume },
        inputId: `approval:${waitId}`
      }
    )
  }

  const stopWorker = async ({ threadId, user }: StopWorkerParams) => {
    const view = await host.observe(harness, { threadId })
    const { status, pendingWaits } = await view.snapshot()

    if (status === 'running') {
      const receipt = await host.submit({
        harness,
        threadId,
        user,
        input: { op: 'cancel' }
      })

      return receipt.status !== 'rejected'
    }

    const turnWaits = turnWaitsOf(pendingWaits)
    const [firstWait] = turnWaits

    if (firstWait === undefined) {
      return false
    }

    return submitInput(
      { host, harness },
      {
        threadId,
        user,
        input: {
          op: 'resolve',
          resume: turnWaits.map(({ waitId }) => {
            return { interruptId: waitId, status: 'cancelled' as const }
          })
        },
        inputId: `stop:${firstWait.waitId}`
      }
    )
  }

  const recover = async () => {
    await host.resumePending({ harnesses: [harness] })
    await lifecycle.sweep(await readWorkers())
  }

  return {
    startWorker,
    readWorkers,
    readFinishedWorkers,
    listWorkers,
    trackLiveWorkers,
    wakeWorker,
    finishWorker,
    updateWorker,
    messageWorker,
    answerApproval,
    stopWorker,
    recover
  }
}

export type Workers = ReturnType<typeof createWorkers>
