import type { HostSessions } from '@tanstack/ai-harness'
import { workerMetadataSchema } from '@workcell/core'
import { verifierScript, writeEvalCase, type EvalCase } from './eval-case.ts'

export type MergedChange = {
  baseCommit: string
  diff: string
}

export type ReadMergedChange = (
  pullRequest: string
) => Promise<MergedChange | undefined>

type CaseFromTaskParams = {
  sessions: Pick<HostSessions, 'get'>
  readMergedChange: ReadMergedChange
  threadId: string
  name: string
  checkCommandOf: (repository: string) => string | undefined
  root: string
  pullRequest?: string
}

async function readFinishedTask(
  sessions: CaseFromTaskParams['sessions'],
  threadId: string
) {
  const entry = await sessions.get({ threadId })
  const worker = workerMetadataSchema.safeParse(entry?.metadata)

  if (!worker.success) {
    throw new Error(`The thread ${threadId} holds no task of a worker.`)
  }

  const { outcome } = worker.data

  if (outcome === undefined) {
    throw new Error(
      `The task of the thread ${threadId} has not finished: make a case once it has an outcome.`
    )
  }

  return { ...worker.data, outcome }
}

export async function caseFromTask({
  sessions,
  readMergedChange,
  threadId,
  name,
  checkCommandOf,
  root,
  pullRequest
}: CaseFromTaskParams) {
  const task = await readFinishedTask(sessions, threadId)
  const solvedBy = pullRequest ?? task.pullRequest

  if (solvedBy === undefined) {
    throw new Error(
      `The task of the thread ${threadId} opened no pull request: name the pull request a person merged in its place.`
    )
  }

  const checkCommand = checkCommandOf(task.repository)

  if (checkCommand === undefined) {
    throw new Error(
      `No check command verifies ${task.repository}: declare one before you make a case of its tasks.`
    )
  }

  const merged = await readMergedChange(solvedBy)

  if (merged === undefined) {
    throw new Error(
      `The pull request ${solvedBy} has not merged: a case needs the change a person merged.`
    )
  }

  const { changedAt: _changedAt, ...outcome } = task.outcome
  const evalCase: EvalCase = {
    name,
    instruction: `${task.task}\n`,
    repository: task.repository,
    baseCommit: merged.baseCommit,
    pullRequest: solvedBy,
    threadId,
    outcome,
    solution: merged.diff,
    verifier: verifierScript(checkCommand)
  }
  await writeEvalCase(root, evalCase)

  return evalCase
}
