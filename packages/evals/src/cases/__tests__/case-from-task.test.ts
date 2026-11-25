import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkerMetadata } from '@workcell/core'
import { caseFromTask, type MergedChange } from '#/cases/case-from-task.ts'
import { readEvalCases, verifierScript } from '#/cases/eval-case.ts'

const BASE_COMMIT = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const MERGED_DIFF = 'diff --git a/config.ts b/config.ts\n'

const WORKER_PULL_REQUEST = 'https://github.com/acme/app/pull/12'

const PERSON_PULL_REQUEST = 'https://github.com/acme/app/pull/13'

const FLAWED_WORKER: WorkerMetadata = {
  name: 'Ada',
  task: 'Rename the config key `timeout` to `timeoutMs` everywhere.',
  repository: 'acme/app',
  pullRequest: WORKER_PULL_REQUEST,
  outcome: { value: 'flawed', costUsd: 1.25, changedAt: 1 }
}

let root: string

function checkCommandsOf(repository: string) {
  return repository === 'acme/app' ? 'npm test' : undefined
}

function sessionsWith(metadata?: WorkerMetadata) {
  return {
    get: async () => {
      return metadata === undefined
        ? undefined
        : {
            threadId: 'thread-1',
            metadata,
            members: [],
            createdAt: 0,
            updatedAt: 0
          }
    }
  }
}

function mergedChanges(merged: Readonly<Record<string, MergedChange>>) {
  return async (pullRequest: string) => {
    return merged[pullRequest]
  }
}

describe('a case from a finished task', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-cases-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('turns a flawed task into a case at the base of the pull request that merged', async () => {
    await caseFromTask({
      sessions: sessionsWith(FLAWED_WORKER),
      readMergedChange: mergedChanges({
        [WORKER_PULL_REQUEST]: { baseCommit: BASE_COMMIT, diff: MERGED_DIFF }
      }),
      threadId: 'thread-1',
      name: 'rename-the-config-key',
      checkCommandOf: checkCommandsOf,
      root
    })

    expect(await readEvalCases(root)).toStrictEqual([
      {
        name: 'rename-the-config-key',
        instruction: `${FLAWED_WORKER.task}\n`,
        repository: 'acme/app',
        baseCommit: BASE_COMMIT,
        pullRequest: WORKER_PULL_REQUEST,
        threadId: 'thread-1',
        outcome: { value: 'flawed', costUsd: 1.25 },
        solution: MERGED_DIFF,
        verifier: verifierScript('npm test')
      }
    ])
  })

  it('takes the pull request a person merged in place of a blocked task', async () => {
    await caseFromTask({
      sessions: sessionsWith({
        ...FLAWED_WORKER,
        pullRequest: undefined,
        outcome: {
          value: 'blocked',
          cause: 'a flaky test',
          costUsd: 0.5,
          changedAt: 1
        }
      }),
      readMergedChange: mergedChanges({
        [PERSON_PULL_REQUEST]: { baseCommit: BASE_COMMIT, diff: MERGED_DIFF }
      }),
      threadId: 'thread-1',
      name: 'blocked-on-a-flaky-test',
      pullRequest: PERSON_PULL_REQUEST,
      checkCommandOf: checkCommandsOf,
      root
    })

    expect(await readEvalCases(root)).toMatchObject([
      {
        pullRequest: PERSON_PULL_REQUEST,
        outcome: { value: 'blocked', cause: 'a flaky test' }
      }
    ])
  })

  it('refuses a task that has not finished', async () => {
    await expect(
      caseFromTask({
        sessions: sessionsWith({ ...FLAWED_WORKER, outcome: undefined }),
        readMergedChange: mergedChanges({}),
        threadId: 'thread-1',
        name: 'unfinished',
        checkCommandOf: checkCommandsOf,
        root
      })
    ).rejects.toThrow('thread-1 has not finished')
  })

  it('refuses a thread that holds no task', async () => {
    await expect(
      caseFromTask({
        sessions: sessionsWith(),
        readMergedChange: mergedChanges({}),
        threadId: 'thread-1',
        name: 'missing',
        checkCommandOf: checkCommandsOf,
        root
      })
    ).rejects.toThrow('thread-1 holds no task')
  })

  it('asks for the pull request a person merged when the task names none', async () => {
    await expect(
      caseFromTask({
        sessions: sessionsWith({ ...FLAWED_WORKER, pullRequest: undefined }),
        readMergedChange: mergedChanges({}),
        threadId: 'thread-1',
        name: 'no-pull-request',
        checkCommandOf: checkCommandsOf,
        root
      })
    ).rejects.toThrow('name the pull request a person merged')
  })

  it('refuses a repository that declares no check command', async () => {
    await expect(
      caseFromTask({
        sessions: sessionsWith({ ...FLAWED_WORKER, repository: 'acme/docs' }),
        readMergedChange: mergedChanges({}),
        threadId: 'thread-1',
        name: 'no-check-command',
        checkCommandOf: checkCommandsOf,
        root
      })
    ).rejects.toThrow('No check command verifies acme/docs')
  })

  it('refuses a pull request that never merged', async () => {
    await expect(
      caseFromTask({
        sessions: sessionsWith(FLAWED_WORKER),
        readMergedChange: mergedChanges({}),
        threadId: 'thread-1',
        name: 'open-pull-request',
        checkCommandOf: checkCommandsOf,
        root
      })
    ).rejects.toThrow(`${WORKER_PULL_REQUEST} has not merged`)
  })
})
