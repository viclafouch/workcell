import type { StreamChunk } from '@tanstack/ai'
import type {
  HarnessHost,
  HarnessSession,
  HarnessUser
} from '@tanstack/ai-harness'
import type { OrchestratorHarness } from './orchestrator-harness.ts'

const MODE_KEY = 'mode'

const PLAN_MODE = 'plan'

type CreateOrchestratorParams = {
  host: HarnessHost
  harness: OrchestratorHarness
}

export type AskOrchestratorParams = {
  threadId: string
  user: HarnessUser
  inputId: string
  message: string
  onEvent: (event: StreamChunk) => void | Promise<void>
}

export type StopOrchestratorParams = { threadId: string; user: HarnessUser }

async function keepReadOnly(session: HarnessSession<OrchestratorHarness>) {
  const mode = session.describe().config.find(({ key }) => {
    return key === MODE_KEY
  })

  if (mode?.value !== PLAN_MODE) {
    await session.setPluginSetting({ key: MODE_KEY, value: PLAN_MODE })
  }
}

export function createOrchestrator({
  host,
  harness
}: CreateOrchestratorParams) {
  const ask = async ({
    threadId,
    user,
    inputId,
    message,
    onEvent
  }: AskOrchestratorParams) => {
    await using session = await host.open(harness, { threadId, user })
    await keepReadOnly(session)
    const operation = session.send(message, { inputId, busy: 'steer' })
    const receipt = await operation.receipt

    if (receipt.status === 'rejected') {
      throw new Error(
        `The orchestrator thread ${threadId} refused the input ${inputId}: ${receipt.reason}.`
      )
    }

    const isTurnOwner = receipt.operationId === operation.id

    if (isTurnOwner) {
      for await (const event of operation.stream()) {
        await onEvent(event)
      }
    }

    const { outcome, error } = await session.settled({ inputId })
    const waits = isTurnOwner
      ? session.snapshot().pendingWaits.map(({ message: wait }) => {
          return wait ?? ''
        })
      : []

    return { ownsTurn: isTurnOwner, outcome, error: error?.message, waits }
  }

  const stop = async ({ threadId, user }: StopOrchestratorParams) => {
    const view = await host.observe(harness, { threadId })
    const { status } = await view.snapshot()

    if (status !== 'running') {
      return false
    }

    const receipt = await host.submit({
      harness,
      threadId,
      user,
      input: { op: 'cancel' }
    })

    return receipt.status !== 'rejected'
  }

  const holds = async (threadId: string) => {
    const entry = await host.sessions.get({ threadId })

    return entry !== undefined
  }

  return { harness, ask, stop, holds }
}

export type Orchestrator = ReturnType<typeof createOrchestrator>
