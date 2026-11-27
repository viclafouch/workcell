import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { WorkerMetadata } from '@workcell/core'
import {
  createHostFreeSandbox,
  runWorkerToolCall
} from '@workcell/core/testing'
import { pullRequestMergeGate } from '#/plugins/merge-gate.ts'

const EXECUTABLE_MODE = 0o755

const SYSTEM_PATH = '/usr/bin:/bin'

const MERGEABLE_URL = 'https://github.com/acme/app/pull/42'

const REFUSED_URL = 'https://github.com/acme/app/pull/43'

const FAKE_GH = `#!/bin/sh
case "$2:$3" in
  merge:*pull/43) echo "GraphQL: Pull request is not mergeable (mergePullRequest)" >&2; exit 1 ;;
  merge:*) echo "Merged $3" ;;
  *) echo "Viewed $3" ;;
esac
`

const WORKER_METADATA: WorkerMetadata = {
  name: 'Alpha',
  task: 'Take TASK-7 to a merged pull request.',
  repository: 'acme/app',
  branch: 'task-7-login'
}

function commandOf(url: string) {
  return `gh pr merge ${url} --squash --match-head-commit head-1`
}

let fakeBin: string

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

function runBash(command: string, mergeCommand?: string) {
  return runWorkerToolCall({
    hostFree,
    toolCall: { name: 'bash', input: { command } },
    mode: 'bypass',
    metadata: { ...WORKER_METADATA, mergeCommand },
    plugins: [pullRequestMergeGate]
  })
}

describe('the merge gate of a worker', () => {
  beforeAll(async () => {
    fakeBin = await mkdtemp(join(tmpdir(), 'fake-gh-'))
    await writeFile(join(fakeBin, 'gh'), FAKE_GH)
    await chmod(join(fakeBin, 'gh'), EXECUTABLE_MODE)
    hostFree = await createHostFreeSandbox({
      PATH: `${fakeBin}:${SYSTEM_PATH}`
    })
  })

  afterAll(async () => {
    await hostFree.destroy()
    await rm(fakeBin, { recursive: true, force: true })
  })

  it.each([
    ['no command is recorded', commandOf(MERGEABLE_URL), undefined],
    [
      'it adds --admin to the recorded command',
      `${commandOf(MERGEABLE_URL)} --admin`,
      commandOf(MERGEABLE_URL)
    ],
    [
      'it runs another merge after a step',
      `cd app && gh pr merge 42 --auto`,
      commandOf(MERGEABLE_URL)
    ],
    [
      'it calls gh by its path',
      `/usr/bin/gh pr merge 42 --squash`,
      commandOf(MERGEABLE_URL)
    ],
    [
      'it wraps the merge in a shell string',
      `bash -c "gh pr merge 42 --squash"`,
      commandOf(MERGEABLE_URL)
    ]
  ])(
    'refuses a merge when %s, and runs nothing',
    async (_case, command, recorded) => {
      const run = await runBash(command, recorded)

      expect(run.result).toContain(
        'A merge runs only once the pull request is ready'
      )
      expect(run.result).not.toContain('Merged')
    }
  )

  it('runs the recorded command as it is, and lets other gh commands through', async () => {
    const merge = await runBash(
      commandOf(MERGEABLE_URL),
      commandOf(MERGEABLE_URL)
    )
    const view = await runBash('gh pr view 42 --json mergeable')

    expect(merge.result).toContain(`Merged ${MERGEABLE_URL}`)
    expect(view.result).toContain('Viewed 42')
  })

  it('records the answer of GitHub when it refuses the recorded command', async () => {
    const run = await runBash(commandOf(REFUSED_URL), commandOf(REFUSED_URL))

    expect(run.metadata).toMatchObject({
      mergeRefusal: 'GraphQL: Pull request is not mergeable (mergePullRequest)'
    })
  })
})
