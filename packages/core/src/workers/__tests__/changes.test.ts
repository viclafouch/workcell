import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SandboxHandle } from '@tanstack/ai-sandbox'
import { createHostFreeProvider } from '#/testing/host-free-sandbox.ts'
import { captureChanges, restoreChanges } from '#/workers/changes.ts'

const AS_WORKER = 'git -c user.name=Worker -c user.email=worker@example.com'

const AS_SEED = 'git -c user.name=Seed -c user.email=seed@example.com'

const BRANCH = 'task-1-stale'

const HISTORY_COMMITS = 12

const STALE_FORK_DEPTH = 8

const BYTES_PER_MEBIBYTE = 1_048_576

const ABOVE_THE_LIMIT_MEBIBYTES = 9

const ABOVE_THE_LIMIT_BYTES = ABOVE_THE_LIMIT_MEBIBYTES * BYTES_PER_MEBIBYTE

const SEED_ORIGIN = `set -eu
git init --quiet --bare --initial-branch=dev origin.git
git -C origin.git config uploadpack.allowAnySHA1InWant true
git -C origin.git config uploadpack.allowFilter true
git init --quiet --initial-branch=dev seed
cd seed
for i in $(seq ${HISTORY_COMMITS}); do
  echo "history-$i" > history.md
  git add history.md
  ${AS_SEED} commit --quiet -m "history $i"
done
git switch --quiet -c ${BRANCH} HEAD~${STALE_FORK_DEPTH}
echo stale-marker > stale.md
git add stale.md
${AS_SEED} commit --quiet -m "stale work"
git push --quiet ../origin.git dev ${BRANCH}`

const MERGE_THE_STALE_BRANCH = [
  `git switch --quiet -c ${BRANCH}`,
  'echo mine > mine.md',
  'git add mine.md',
  `${AS_WORKER} commit --quiet -m "my work"`,
  `git fetch --quiet origin ${BRANCH}`,
  `${AS_WORKER} merge --quiet -s ours --allow-unrelated-histories -m "keep my work" FETCH_HEAD`,
  'echo two > uncommitted.md'
].join(' && ')

const PUSH = `git push --quiet origin ${BRANCH}`

const DELETE_THE_REMOTE_BRANCH = `git push --quiet origin --delete ${BRANCH}`

const LEFT_NOTHING_BEHIND = `find .git -maxdepth 1 -name '*.bundle' && git for-each-ref refs/workcell`

let hostFree: Awaited<ReturnType<typeof createHostFreeProvider>>

async function exec(handle: SandboxHandle, command: string) {
  const { exitCode, stdout, stderr } = await handle.process.exec(command, {
    cwd: '/workspace'
  })

  if (exitCode !== 0) {
    throw new Error(`The command failed with the exit code ${exitCode}.`, {
      cause: stderr
    })
  }

  return stdout
}

async function seedOrigin() {
  const seeded = await hostFree.provider.create({})
  await exec(seeded, SEED_ORIGIN)

  return `file://${join(seeded.id, 'origin.git')}`
}

async function shallowClone(origin: string) {
  const sandbox = await hostFree.provider.create({})
  await exec(
    sandbox,
    `git clone --quiet --depth 1 --single-branch --branch dev ${origin} .`
  )

  return sandbox
}

async function fullClone(origin: string) {
  const sandbox = await hostFree.provider.create({})
  await exec(sandbox, `git clone --quiet --branch dev ${origin} .`)

  return sandbox
}

async function bloblessClone(origin: string) {
  const sandbox = await hostFree.provider.create({})
  await exec(
    sandbox,
    `git clone --quiet --filter=blob:none --branch dev ${origin} .`
  )

  return sandbox
}

async function workerOnTheStaleBranch(clone = shallowClone) {
  const origin = await seedOrigin()
  const sandbox = await clone(origin)
  await exec(sandbox, MERGE_THE_STALE_BRANCH)

  return { origin, sandbox }
}

async function capture(handle: SandboxHandle) {
  const captured = await captureChanges(handle)

  if (captured === null) {
    throw new Error('The sandbox holds no repository.')
  }

  return captured
}

describe('the save of the worker changes', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeProvider()
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it('leaves out the history of the remote branch the worker merged', async () => {
    const { sandbox } = await workerOnTheStaleBranch()

    const { content } = await capture(sandbox)

    expect(content).toContain('mine\n')
    expect(content).toContain('two\n')
    expect(content).not.toContain('stale-marker')
    expect(content).not.toContain('history-')
  })

  it('leaves out the commits the worker pushed', async () => {
    const { sandbox } = await workerOnTheStaleBranch()
    await exec(sandbox, PUSH)

    const { content } = await capture(sandbox)

    expect(content).not.toContain('mine\n')
    expect(content).toContain('two\n')
  })

  it('leaves no bundle in the sandbox', async () => {
    const { sandbox } = await workerOnTheStaleBranch()

    await capture(sandbox)

    await expect(exec(sandbox, LEFT_NOTHING_BEHIND)).resolves.toBe('')
  })

  it('refuses changes above the size limit and leaves no bundle', async () => {
    const { sandbox } = await workerOnTheStaleBranch()
    await exec(
      sandbox,
      `head -c ${ABOVE_THE_LIMIT_BYTES} /dev/urandom > big.bin`
    )

    await expect(captureChanges(sandbox)).rejects.toThrow(
      /above the limit of \d+ bytes/u
    )
    await expect(exec(sandbox, LEFT_NOTHING_BEHIND)).resolves.toBe('')
  })

  it.each([
    { kind: 'shallow', clone: shallowClone },
    { kind: 'blobless', clone: bloblessClone }
  ])(
    'saves the changes of a $kind clone when the remote is out of reach',
    async ({ clone }) => {
      const { sandbox } = await workerOnTheStaleBranch(clone)
      await exec(sandbox, 'git remote set-url origin file:///nowhere')

      const { content } = await capture(sandbox)

      expect(content).toContain('mine\n')
      expect(content).toContain('two\n')
    }
  )

  it('comes back in a fresh blobless clone from the save of a blobless clone', async () => {
    const { origin, sandbox } = await workerOnTheStaleBranch(bloblessClone)
    const captured = await capture(sandbox)
    const fresh = await bloblessClone(origin)

    await restoreChanges(fresh, captured)

    await expect(
      exec(
        fresh,
        'git status --short --branch && git log --format=%s -1 && cat mine.md uncommitted.md'
      )
    ).resolves.toBe(
      `## ${BRANCH}\n?? uncommitted.md\nkeep my work\nmine\ntwo\n`
    )
  })

  it.each([
    { moment: 'before the push', push: 'true' },
    { moment: 'after the push', push: PUSH }
  ])('comes back in a fresh shallow clone $moment', async ({ push }) => {
    const { origin, sandbox } = await workerOnTheStaleBranch()
    await exec(sandbox, push)
    const captured = await capture(sandbox)
    const fresh = await shallowClone(origin)

    await restoreChanges(fresh, captured)

    await expect(
      exec(
        fresh,
        'git status --short --branch && git log --format=%s -1 && cat mine.md uncommitted.md'
      )
    ).resolves.toBe(
      `## ${BRANCH}\n?? uncommitted.md\nkeep my work\nmine\ntwo\n`
    )
  })

  it('comes back in a fresh full clone that lacks its pushed commit, and the clone keeps its whole history', async () => {
    const { origin, sandbox } = await workerOnTheStaleBranch()
    await exec(sandbox, PUSH)
    const captured = await capture(sandbox)
    await exec(sandbox, DELETE_THE_REMOTE_BRANCH)
    const fresh = await fullClone(origin)

    await restoreChanges(fresh, captured)

    await expect(
      exec(
        fresh,
        'git rev-parse --is-shallow-repository && git rev-list --count dev && cat mine.md uncommitted.md'
      )
    ).resolves.toBe(`false\n${HISTORY_COMMITS}\nmine\ntwo\n`)
  })
})
