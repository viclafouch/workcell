import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { readHostGitIdentity } from '#/workers/identity.ts'

async function useTemporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  return directory
}

async function useGlobalGitConfig(content: string) {
  const directory = await useTemporaryDirectory('host-git-config-')
  const config = join(directory, 'gitconfig')
  await writeFile(config, content)
  vi.stubEnv('GIT_CONFIG_GLOBAL', config)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
}

async function useRepository(identity: { name: string; email: string }) {
  const directory = await useTemporaryDirectory('host-repository-')
  execFileSync('git', ['init', '--quiet'], { cwd: directory })
  execFileSync('git', ['config', 'set', 'user.name', identity.name], {
    cwd: directory
  })
  execFileSync('git', ['config', 'set', 'user.email', identity.email], {
    cwd: directory
  })

  return directory
}

describe('the host git identity', () => {
  it('comes from the repository config of the directory first', async () => {
    await useGlobalGitConfig(
      '[user]\n\tname = Global Developer\n\temail = global@example.com\n\tuseConfigOnly = true\n'
    )
    const directory = await useRepository({
      name: 'Repository Developer',
      email: 'repository@example.com'
    })

    expect(readHostGitIdentity({ directory })).toStrictEqual({
      name: 'Repository Developer',
      email: 'repository@example.com'
    })
  })

  it('falls back to the global git config of the host', async () => {
    await useGlobalGitConfig(
      '[user]\n\tname = Host Developer\n\temail = host@example.com\n'
    )
    const directory = await useTemporaryDirectory('host-directory-')

    expect(readHostGitIdentity({ directory })).toStrictEqual({
      name: 'Host Developer',
      email: 'host@example.com'
    })
  })

  it('fails with the command that sets a missing part', async () => {
    await useGlobalGitConfig('[user]\n\tname = Host Developer\n')
    const directory = await useTemporaryDirectory('host-directory-')

    expect(() => {
      readHostGitIdentity({ directory })
    }).toThrow(
      `The git config of ${directory} has no user.email: run git config set user.email <value> in its repository, or with --global.`
    )
  })
})
