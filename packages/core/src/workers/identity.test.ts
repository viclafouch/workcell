import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { readHostGitIdentity } from './identity.ts'

async function useGlobalGitConfig(content: string) {
  const directory = await mkdtemp(join(tmpdir(), 'host-git-config-'))
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const config = join(directory, 'gitconfig')
  await writeFile(config, content)
  vi.stubEnv('GIT_CONFIG_GLOBAL', config)
}

describe('the host git identity', () => {
  it('comes from the global git config of the host', async () => {
    await useGlobalGitConfig(
      '[user]\n\tname = Host Developer\n\temail = host@example.com\n'
    )

    expect(readHostGitIdentity()).toStrictEqual({
      name: 'Host Developer',
      email: 'host@example.com'
    })
  })

  it('fails with the command that sets a missing part', async () => {
    await useGlobalGitConfig('[user]\n\tname = Host Developer\n')

    expect(() => {
      readHostGitIdentity()
    }).toThrow(
      'The host git config has no user.email: run git config set --global user.email <value>.'
    )
  })
})
