import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bootstrapWorkspace,
  defineWorkspace,
  type SandboxHandle
} from '@tanstack/ai-sandbox'
import { workerRepo } from '#/sandbox/worker-repo.ts'
import { createHostFreeProvider } from '#/testing/host-free-sandbox.ts'

const AS_SEED = 'git -c user.name=Seed -c user.email=seed@example.com'

const SEED_ORIGIN = `set -eu
git init --quiet --bare --initial-branch=dev origin.git
git -C origin.git config uploadpack.allowFilter true
git init --quiet --initial-branch=dev seed
cd seed
for version in one two three; do
  echo "$version" > notes.md
  git add notes.md
  ${AS_SEED} commit --quiet -m "notes $version"
done
git push --quiet ../origin.git dev`

const MISSING_OBJECTS = `git rev-list --objects --missing=print --all | grep -c '^?' || true`

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

function bloblessWorkerWorkspaceFrom(url: string) {
  const source = workerRepo({
    repo: 'owner/repository',
    ref: 'dev',
    filter: 'blob:none'
  })

  if (source.type !== 'git') {
    throw new Error('A worker repository is a git source.')
  }

  return defineWorkspace({ source: { ...source, url } })
}

describe('the clone of a worker repository', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeProvider()
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it('keeps the whole history of a blobless clone, with only the file contents of its checkout', async () => {
    const seeded = await hostFree.provider.create({})
    await exec(seeded, SEED_ORIGIN)
    const sandbox = await hostFree.provider.create({})

    await bootstrapWorkspace(
      sandbox,
      bloblessWorkerWorkspaceFrom(`file://${join(seeded.id, 'origin.git')}`)
    )

    await expect(
      exec(sandbox, `git rev-list --count HEAD && ${MISSING_OBJECTS}`)
    ).resolves.toBe('3\n2\n')
    await expect(exec(sandbox, 'cat notes.md')).resolves.toBe('three\n')
  })
})
