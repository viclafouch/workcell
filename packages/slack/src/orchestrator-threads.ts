import { z } from 'zod'
import { EventType, type StreamChunk } from '@tanstack/ai'
import { BUDGET_END_EVENT, type Orchestrator } from '@workcell/core'
import type { LogLine } from './bolt-logger.ts'
import type { SlackThread } from './channel-poster.ts'
import { SLACK_LINES, type SlackLines } from './prompts/slack.ts'
import type { SlackPrompt } from './slack-connection.ts'
import type { SessionStatus, SlackTask, SlackWeb } from './slack-web.ts'

const TASK_DETAILS_MAX_LENGTH = 300

const SLACK_LINK = /<(?:[^<>|]+\|)?([^<>]+)>/gu

const toolOutputErrorSchema = z.object({
  tanstack: z.object({ state: z.literal('output-error') })
})

const budgetEndSchema = z.object({ message: z.string() })

type ThreadLog = {
  info: LogLine
  warn: LogLine
  error: LogLine
  child: (bindings: Record<string, unknown>) => { error: LogLine }
}

type CreateOrchestratorThreadsParams = {
  web: SlackWeb
  orchestrator: Pick<Orchestrator, 'ask' | 'stop' | 'holds'>
  allowedStarters: readonly string[]
  allowedChannels: readonly string[]
  logger: { child: (bindings: Record<string, unknown>) => ThreadLog }
  lines?: SlackLines
}

type Outcome = Awaited<ReturnType<Orchestrator['ask']>>['outcome']

const END_STATUS: Record<Outcome, SessionStatus> = {
  completed: 'active',
  aborted: 'active',
  failed: 'active',
  interrupted: 'suspended'
}

export type OrchestratorRoute = {
  ask: (prompt: SlackPrompt) => Promise<void>
  reply: (prompt: SlackPrompt) => Promise<void>
  stop: (thread: SlackThread, user: string) => Promise<void>
}

function channelPrefixOf(channel: string) {
  return `slack/${channel}/`
}

function threadIdOf({ channel, threadTs }: SlackThread) {
  return `${channelPrefixOf(channel)}${threadTs}`
}

export function isOrchestratorThreadIn(channels: readonly string[]) {
  return (threadId: string) => {
    return channels.some((channel) => {
      return threadId.startsWith(channelPrefixOf(channel))
    })
  }
}

function titleOf(text: string) {
  const [firstLine = ''] = text.trim().split('\n', 1)

  return firstLine.replaceAll(SLACK_LINK, '$1').trim()
}

function detailsOf(input: unknown) {
  return input === undefined
    ? undefined
    : JSON.stringify(input).slice(0, TASK_DETAILS_MAX_LENGTH)
}

type TurnEnding = { budgetEnd?: string }

type ClosingLinesParams = {
  outcome: Outcome
  waits: readonly string[]
  budgetEnd: string | undefined
  lines: SlackLines
}

function closingLines({
  outcome,
  waits,
  budgetEnd,
  lines
}: ClosingLinesParams) {
  if (budgetEnd !== undefined) {
    return [budgetEnd]
  }

  if (outcome === 'aborted') {
    return [lines.stoppedTurn]
  }

  if (outcome === 'failed') {
    return [lines.failedTurn]
  }

  return outcome === 'interrupted' ? waits : []
}

export function createOrchestratorThreads({
  web,
  orchestrator,
  allowedStarters,
  allowedChannels,
  logger,
  lines = SLACK_LINES
}: CreateOrchestratorThreadsParams): OrchestratorRoute {
  const log = logger.child({ module: 'slack' })
  const heldThreads = new Set<string>()

  const mayTalk = (user: string, channel: string) => {
    return allowedStarters.includes(user) || allowedChannels.includes(channel)
  }

  const holds = async (thread: SlackThread) => {
    const threadId = threadIdOf(thread)

    if (heldThreads.has(threadId)) {
      return true
    }

    const isHeld = await orchestrator.holds(threadId)

    if (isHeld) {
      heldThreads.add(threadId)
    }

    return isHeld
  }

  const titleThread = async (prompt: SlackPrompt) => {
    const title = titleOf(prompt.text)

    if (title === '') {
      return
    }

    try {
      await web.rename({ ...prompt, title })
    } catch (error) {
      log.warn(
        { error, threadId: threadIdOf(prompt) },
        'orchestrator thread title failed'
      )
    }
  }

  const answer = async (prompt: SlackPrompt) => {
    const threadId = threadIdOf(prompt)
    const tasks = new Map<string, SlackTask>()
    const stream = web.stream({
      ...prompt,
      recipient: { user: prompt.user, team: prompt.team }
    })
    let text = ''
    const turnLog = log.child({ threadId })
    let isStreamed = false
    let isBroken = false
    const ending: TurnEnding = {}

    const toStream = async (call: () => Promise<void>) => {
      if (isBroken) {
        return
      }

      try {
        await call()
        isStreamed = true
      } catch (error) {
        isBroken = true
        turnLog.error({ error }, 'orchestrator stream failed')
      }
    }

    const updateTask = async (id: string, change: Partial<SlackTask>) => {
      const task = tasks.get(id)

      if (task === undefined) {
        return
      }

      const next = { ...task, ...change }
      tasks.set(id, next)
      await toStream(() => {
        return stream.updateTask(next)
      })
    }

    const onEvent = async (event: StreamChunk) => {
      if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
        text += event.delta
        await toStream(() => {
          return stream.appendText(event.delta)
        })
      }

      if (event.type === EventType.TOOL_CALL_START) {
        const task: SlackTask = {
          id: event.toolCallId,
          title: event.toolCallName,
          status: 'in_progress'
        }
        tasks.set(task.id, task)
        await toStream(() => {
          return stream.updateTask(task)
        })
      }

      if (event.type === EventType.TOOL_CALL_END) {
        await updateTask(event.toolCallId, { details: detailsOf(event.input) })
      }

      if (event.type === EventType.TOOL_CALL_RESULT) {
        await updateTask(event.toolCallId, {
          status: toolOutputErrorSchema.safeParse(event.metadata).success
            ? 'error'
            : 'complete'
        })
      }

      if (event.type === EventType.CUSTOM && event.name === BUDGET_END_EVENT) {
        ending.budgetEnd = budgetEndSchema.safeParse(event.value).data?.message
      }
    }

    const isNewThread = !(await holds(prompt))
    await web.setStatus({
      ...prompt,
      status: 'processing',
      initiator: prompt.user
    })
    heldThreads.add(threadId)

    if (isNewThread) {
      await titleThread(prompt)
    }

    const { ownsTurn, outcome, error, waits } = await orchestrator.ask({
      threadId,
      user: { id: prompt.user },
      inputId: `slack:${prompt.channel}:${prompt.ts}`,
      message: prompt.text,
      onEvent
    })

    if (!ownsTurn) {
      return
    }

    if (outcome === 'failed') {
      turnLog.error({ error }, 'orchestrator turn failed')
    }

    const closing = closingLines({
      outcome,
      waits,
      budgetEnd: ending.budgetEnd,
      lines
    }).join('\n\n')
    const status = END_STATUS[outcome]

    if (closing !== '') {
      text = text === '' ? closing : `${text}\n\n${closing}`
      await toStream(() => {
        return stream.appendText(`\n\n${closing}`)
      })
    }

    if (isStreamed && !isBroken) {
      await toStream(() => {
        return stream.stop(status)
      })
    }

    if (isBroken && text !== '') {
      await web.post({ ...prompt, markdown: text })
    }

    if (!isStreamed || isBroken) {
      await web.setStatus({ ...prompt, status })
    }
  }

  const ask = async (prompt: SlackPrompt) => {
    if (!mayTalk(prompt.user, prompt.channel)) {
      log.info(
        { user: prompt.user, channel: prompt.channel },
        'a mention outside the allowed channels left alone'
      )

      return
    }

    try {
      await answer(prompt)
    } catch (error) {
      log.error(
        { error, channel: prompt.channel, threadTs: prompt.threadTs },
        'orchestrator turn failed'
      )
      await web.post({ ...prompt, markdown: lines.failedTurn })
      await web.setStatus({ ...prompt, status: 'active' })
    }
  }

  const reply = async (prompt: SlackPrompt) => {
    if (mayTalk(prompt.user, prompt.channel) && (await holds(prompt))) {
      await ask(prompt)
    }
  }

  const stop = async (thread: SlackThread, user: string) => {
    if (!mayTalk(user, thread.channel)) {
      log.info(
        { user, ...thread },
        'a stop outside the allowed channels left alone'
      )

      return
    }

    const stopped = await orchestrator.stop({
      threadId: threadIdOf(thread),
      user: { id: user }
    })
    log.info({ user, ...thread, stopped }, 'slack stop button')

    if (!stopped) {
      await web.setStatus({ ...thread, status: 'active' })
    }
  }

  return { ask, reply, stop }
}
