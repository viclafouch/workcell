import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import {
  definePlugin,
  PermissionRules,
  type HarnessRunContext
} from '@tanstack/ai-harness'
import type { IsStarter } from '#/host/allowed-senders.ts'
import {
  NO_LIVE_WORKER,
  ORCHESTRATOR_TOOLS_TEXT,
  repositoryChoice,
  senderPrompt,
  STARTER_RULE,
  workerLine
} from '#/prompts/orchestrator.ts'
import type { ViewWorkers } from '#/workers/worker-view.ts'
import { NoFreePlaceError, type Workers } from '#/workers/workers.ts'

const TOOLS_PLUGIN = 'workcell/orchestrator-tools'

const LIST_WORKERS = 'list_workers'

const WORKER_ACTIONS = ['start_worker', 'message_worker', 'stop_worker']

type OrchestratorToolsParams = {
  workers: Workers
  viewWorkers: ViewWorkers
  isStarter: IsStarter
  repositories: readonly string[]
}

type LiveWorkers = Awaited<ReturnType<Workers['listWorkers']>>

function busyLine(workers: LiveWorkers, subject: string | undefined) {
  const busy = workers.find((worker) => {
    return subject !== undefined && worker.subject === subject
  })

  return busy === undefined || subject === undefined
    ? ''
    : ` ${busy.name} already works on ${subject}: follow it in its thread.`
}

function starterOnlyRefusal(action: string) {
  return `The user of this message may not ${action}. ${STARTER_RULE}`
}

export function orchestratorTools({
  workers,
  viewWorkers,
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
        const views = await viewWorkers()

        return views.length === 0
          ? NO_LIVE_WORKER
          : views.map(workerLine).join('\n')
      })

      const startWorker = toolDefinition({
        name: 'start_worker',
        description: ORCHESTRATOR_TOOLS_TEXT.startWorker,
        replay: 'safe',
        inputSchema: z.object({
          repository: z.string().describe(repositoryChoice(repositories)),
          task: z.string().describe(ORCHESTRATOR_TOOLS_TEXT.task),
          subject: z.string().describe(ORCHESTRATOR_TOOLS_TEXT.subject)
        })
      }).server<HarnessRunContext>(
        async ({ repository, task, subject }, { context, toolCallId }) => {
          const starter = context.run.user

          if (!isStarter(starter)) {
            const live = await workers.listWorkers()

            return `${starterOnlyRefusal('start work')}${busyLine(live, subject)}`
          }

          try {
            const { name, isNew } = await workers.startWorker({
              starter,
              repository,
              task,
              subject,
              originThreadId: context.run.threadId,
              inputId: context.run.idempotencyKey('start_worker', toolCallId)
            })

            return isNew
              ? `${name} starts the task on ${repository}.`
              : `${name} already works on this task.`
          } catch (error) {
            if (error instanceof NoFreePlaceError) {
              return error.message
            }

            throw error
          }
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
        prompts: [
          {
            id: `${TOOLS_PLUGIN}:sender`,
            placement: 'context',
            text: ({ run }) => {
              return senderPrompt(run.user, isStarter)
            }
          }
        ],
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
