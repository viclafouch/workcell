import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import {
  definePlugin,
  PermissionRules,
  type HarnessRunContext
} from '@tanstack/ai-harness'
import type { IsStarter } from '#/host/allowed-senders.ts'
import {
  ORCHESTRATOR_TOOLS_TEXT,
  repositoryChoice
} from '#/prompts/orchestrator.ts'
import type { Workers } from '#/workers/workers.ts'

const TOOLS_PLUGIN = 'workcell/orchestrator-tools'

const LIST_WORKERS = 'list_workers'

const WORKER_ACTIONS = ['start_worker', 'message_worker', 'stop_worker']

type OrchestratorToolsParams = {
  workers: Workers
  isStarter: IsStarter
  repositories: readonly string[]
}

type LiveWorkers = Awaited<ReturnType<Workers['listWorkers']>>

function firstLine(text: string) {
  return text.split('\n')[0] ?? text
}

function topicOf({ subject, branch, task }: LiveWorkers[number]) {
  return subject ?? branch ?? firstLine(task)
}

function busyLine(workers: LiveWorkers, subject: string | undefined) {
  const busy = workers.find((worker) => {
    return subject !== undefined && worker.subject === subject
  })

  return busy === undefined || subject === undefined
    ? ''
    : ` ${busy.name} already works on ${subject}: follow it in its thread.`
}

function starterOnlyRefusal(action: string) {
  return `The user of this message may not ${action}. Only an allowed starter can start, steer or stop a worker.`
}

export function orchestratorTools({
  workers,
  isStarter,
  repositories
}: OrchestratorToolsParams) {
  const liveWorkerNamed = async (name: string) => {
    const live = await workers.listWorkers()
    const worker = live.find((candidate) => {
      return candidate.name.toLowerCase() === name.toLowerCase()
    })

    if (worker === undefined) {
      throw new Error(
        `No live worker is named ${name}. ${LIST_WORKERS} names the live workers.`
      )
    }

    return worker
  }

  return definePlugin({
    name: TOOLS_PLUGIN,
    setup: () => {
      const listWorkers = toolDefinition({
        name: LIST_WORKERS,
        description: ORCHESTRATOR_TOOLS_TEXT.listWorkers,
        replay: 'safe',
        inputSchema: z.object({})
      }).server(async () => {
        const live = await workers.listWorkers()

        return live.map((worker) => {
          return {
            name: worker.name,
            topic: topicOf(worker),
            task: worker.task,
            repository: worker.repository,
            branch: worker.branch,
            status: worker.liveStatus,
            updatedAt: Temporal.Instant.fromEpochMilliseconds(
              worker.updatedAt
            ).toString({ smallestUnit: 'millisecond' })
          }
        })
      })

      const startWorker = toolDefinition({
        name: 'start_worker',
        description: ORCHESTRATOR_TOOLS_TEXT.startWorker,
        replay: 'safe',
        inputSchema: z.object({
          repository: z.string().describe(repositoryChoice(repositories)),
          task: z.string().describe(ORCHESTRATOR_TOOLS_TEXT.task),
          subject: z
            .string()
            .optional()
            .describe(ORCHESTRATOR_TOOLS_TEXT.subject)
        })
      }).server<HarnessRunContext>(
        async ({ repository, task, subject }, { context, toolCallId }) => {
          const starter = context.run.user

          if (!isStarter(starter)) {
            const live = await workers.listWorkers()

            return `${starterOnlyRefusal('start work')}${busyLine(live, subject)}`
          }

          const { name, isNew } = await workers.startWorker({
            starter,
            repository,
            task,
            subject,
            inputId: context.run.idempotencyKey('start_worker', toolCallId)
          })

          return isNew
            ? `${name} starts the task on ${repository}.`
            : `${name} already works on this task.`
        }
      )

      const messageWorker = toolDefinition({
        name: 'message_worker',
        description: ORCHESTRATOR_TOOLS_TEXT.messageWorker,
        replay: 'safe',
        inputSchema: z.object({
          name: z.string().describe(ORCHESTRATOR_TOOLS_TEXT.name),
          message: z.string()
        })
      }).server<HarnessRunContext>(
        async ({ name, message }, { context, toolCallId }) => {
          const sender = context.run.user

          if (!isStarter(sender)) {
            return starterOnlyRefusal('steer a worker')
          }

          const worker = await liveWorkerNamed(name)
          await workers.messageWorker({
            threadId: worker.threadId,
            sender,
            inputId: context.run.idempotencyKey('message_worker', toolCallId),
            message
          })

          return `${worker.name} got the message.`
        }
      )

      const stopWorker = toolDefinition({
        name: 'stop_worker',
        description: ORCHESTRATOR_TOOLS_TEXT.stopWorker,
        inputSchema: z.object({
          name: z.string().describe(ORCHESTRATOR_TOOLS_TEXT.name)
        })
      }).server<HarnessRunContext>(async ({ name }, { context }) => {
        const { user } = context.run

        if (!isStarter(user)) {
          return starterOnlyRefusal('stop a worker')
        }

        const worker = await liveWorkerNamed(name)
        const stopped = await workers.stopWorker({
          threadId: worker.threadId,
          user
        })

        return stopped
          ? `${worker.name} stopped its turn.`
          : `${worker.name} runs no turn now, so nothing stopped.`
      })

      return {
        tools: [listWorkers, startWorker, messageWorker, stopWorker],
        contribute: [
          PermissionRules.item({
            tool: LIST_WORKERS,
            decision: 'allow',
            kind: 'read'
          }),
          ...WORKER_ACTIONS.map((tool) => {
            return PermissionRules.item({ tool, decision: 'allow' })
          })
        ]
      }
    }
  })
}
