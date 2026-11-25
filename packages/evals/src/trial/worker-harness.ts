import { createHarness, type SimpleHarnessResult } from 'vitest-evals/harness'
import type {
  HarnessPlugin,
  HarnessUser,
  PermissionMode
} from '@tanstack/ai-harness'
import type { SandboxConfig, SandboxDefinition } from '@tanstack/ai-sandbox'
import type { openWorkcell } from '@workcell/core'
import type { EvalCase } from '#/cases/eval-case.ts'
import { CASE_ARTIFACT } from './case-artifact.ts'
import type { Grade } from './grade.ts'
import {
  InfrastructureError,
  matchIsInfrastructureError
} from './infrastructure-error.ts'
import { transcriptEvents } from './transcript-events.ts'
import { trialPlugin } from './trial-plugin.ts'
import { trialSandbox, type TrialSandbox } from './trial-sandbox.ts'

type Workcell = Awaited<ReturnType<typeof openWorkcell>>

export type TrialWorkcell = Pick<
  Workcell,
  'host' | 'harness' | 'workers' | 'viewWorkers'
> &
  AsyncDisposable

export type OpenTrialWorkcell = (trial: {
  sandboxes: Readonly<Record<string, SandboxDefinition>>
  plugins: readonly HarnessPlugin[]
  permissionMode: PermissionMode
}) => Promise<TrialWorkcell>

export type TrialOutput = Grade

type WorkerHarnessParams = {
  name: string
  starter: HarnessUser
  sandboxAt: (evalCase: EvalCase) => SandboxConfig
  openWorkcell: OpenTrialWorkcell
}

async function openTrial(
  openWorkcell: OpenTrialWorkcell,
  trial: Parameters<OpenTrialWorkcell>[0]
) {
  try {
    return await openWorkcell(trial)
  } catch (error) {
    throw new InfrastructureError('The host of the trial did not open.', {
      cause: error
    })
  }
}

async function trialResultOf(
  workcell: TrialWorkcell,
  sandbox: TrialSandbox,
  { name, input, threadId }: { name: string; input: EvalCase; threadId: string }
) {
  const grade = await sandbox.grade(threadId)
  const view = await workcell.host.observe(workcell.harness, { threadId })
  const { usage } = await view.snapshot()
  const workers = await workcell.viewWorkers()
  const spentUsd = workers.find((worker) => {
    return worker.threadId === threadId
  })?.spentUsd

  return {
    output: grade,
    events: [
      { type: 'message', role: 'user', content: input.instruction },
      ...transcriptEvents(await view.transcript())
    ],
    usage: {
      model: name,
      inputTokens: usage.total.promptTokens,
      outputTokens: usage.total.completionTokens,
      totalTokens: usage.total.totalTokens,
      ...(spentUsd === undefined ? {} : { costUsd: spentUsd })
    }
  } satisfies SimpleHarnessResult<TrialOutput>
}

export function workerHarness({
  name,
  starter,
  sandboxAt,
  openWorkcell
}: WorkerHarnessParams) {
  return createHarness<EvalCase, TrialOutput>({
    name,
    run: async ({ input, setArtifact }) => {
      setArtifact(CASE_ARTIFACT, input.name)
      const startedAt = Date.now()
      const sandbox = trialSandbox(sandboxAt(input), input)
      await using workcell = await openTrial(openWorkcell, {
        sandboxes: { [input.repository]: sandbox.definition },
        plugins: [trialPlugin],
        permissionMode: 'bypass'
      })

      try {
        const { threadId, firstTurn } = await workcell.workers.startWorker({
          starter,
          repository: input.repository,
          task: input.instruction
        })
        setArtifact('threadId', threadId)

        try {
          await firstTurn

          return {
            ...(await trialResultOf(workcell, sandbox, {
              name,
              input,
              threadId
            })),
            timings: { totalMs: Date.now() - startedAt }
          }
        } finally {
          await workcell.host.sessions.delete({ threadId })
        }
      } catch (error) {
        throw matchIsInfrastructureError(error)
          ? error
          : new InfrastructureError('The trial broke before its end.', {
              cause: error
            })
      }
    }
  })
}
