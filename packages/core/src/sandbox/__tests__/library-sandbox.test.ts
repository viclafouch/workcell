import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryPersistence } from '@tanstack/ai-persistence'
import {
  defineSandbox,
  defineWorkspace,
  InMemorySandboxInstanceStore,
  type SandboxInstanceStore
} from '@tanstack/ai-sandbox'
import {
  createLibrarySandbox,
  type LibraryRepositories
} from '#/sandbox/library-sandbox.ts'
import { createHostFreeProvider } from '#/testing/host-free-sandbox.ts'
import {
  askLibraryQuestion,
  openLibraryQuestion,
  openQuestionHost
} from '#/testing/library-question.ts'

const SILENT_LIBRARY_LOGGER = {
  child: () => {
    return { info: () => {}, warn: () => {}, error: () => {} }
  }
}

type LibraryLogger = Parameters<typeof createLibrarySandbox>[0]['logger']

const FOLDERS = ['app', 'tooling', 'design'] as const

function recordPulls(
  pulled: string[],
  firstPull: PromiseWithResolvers<null>
): LibraryLogger {
  return {
    child: () => {
      return {
        info: (fields: { folder?: string }, message: string) => {
          if (message === 'library pulled') {
            pulled.push(fields.folder ?? '')
            firstPull.resolve(null)
          }
        },
        warn: () => {},
        error: () => {}
      }
    }
  }
}

let hostFree: Awaited<ReturnType<typeof createHostFreeProvider>>
let originsDir: string

function runGit(cwd: string, args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

async function commitTo(folder: string, file: string, text: string) {
  const clone = join(originsDir, `${folder}-work`)
  await writeFile(join(clone, file), text)
  runGit(clone, ['add', '.'])
  runGit(clone, ['commit', '--quiet', '-m', `Change ${file}`])
  runGit(clone, ['push', '--quiet', 'origin', 'dev'])
}

async function createOrigin(folder: string) {
  const origin = join(originsDir, `${folder}.git`)
  const clone = join(originsDir, `${folder}-work`)
  runGit(originsDir, ['init', '--quiet', '--bare', origin])
  runGit(originsDir, ['init', '--quiet', '--initial-branch', 'dev', clone])
  runGit(clone, ['config', 'user.name', 'Test'])
  runGit(clone, ['config', 'user.email', 'test@example.com'])
  runGit(clone, ['remote', 'add', 'origin', origin])
  await commitTo(folder, 'README.md', `The ${folder} repository.\n`)
}

const READ_APP_README = { name: 'read_file', input: { path: 'app/README.md' } }

function originOf(folder: string) {
  return { url: `file://${join(originsDir, `${folder}.git`)}`, ref: 'dev' }
}

function openLibrary(
  sandboxId: string,
  {
    pullIntervalMs = 60_000,
    mapFolders = [],
    repositories = Object.fromEntries(
      FOLDERS.map((folder) => {
        return [folder, originOf(folder)]
      })
    ),
    logger = SILENT_LIBRARY_LOGGER,
    instances = new InMemorySandboxInstanceStore()
  }: {
    pullIntervalMs?: number
    mapFolders?: readonly string[]
    repositories?: LibraryRepositories
    logger?: LibraryLogger
    instances?: SandboxInstanceStore
  } = {}
) {
  return createLibrarySandbox({
    sandbox: defineSandbox({
      id: sandboxId,
      provider: hostFree.provider,
      workspace: defineWorkspace({ source: { type: 'none' } }),
      lifecycle: { reuse: 'thread', snapshot: 'none' }
    }),
    repositories,
    mapFolders,
    pullIntervalMs,
    listSandboxes: hostFree.list,
    instances,
    logger
  })
}

async function liveSandboxOf(key: string) {
  const listed = await hostFree.list()
  const [sandbox, ...others] = listed.filter((candidate) => {
    return candidate.key === key
  })

  if (sandbox === undefined || others.length > 0) {
    throw new Error(`Not one live sandbox for the key ${key}.`)
  }

  return sandbox
}

describe('the library sandbox', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeProvider()
    originsDir = await mkdtemp(join(tmpdir(), 'library-origins-'))
    await Promise.all(FOLDERS.map(createOrigin))
  })

  afterAll(async () => {
    await hostFree.destroy()
    await rm(originsDir, { recursive: true, force: true })
  })

  it('answers a question from the three repositories, with no setup', async () => {
    const library = openLibrary('library-question')
    await library.pullOnce()

    const results = await askLibraryQuestion({
      workspace: library.workspace,
      toolCalls: [{ name: 'grep', input: { pattern: 'repository' } }]
    })

    expect(results.join('\n')).toMatch(
      /app\/README\.md[\s\S]*design\/README\.md[\s\S]*tooling\/README\.md/u
    )
  })

  it('refuses every write and every command, in plan mode and in its read-only tree', async () => {
    const library = openLibrary('library-writes')
    await library.pullOnce()
    const writes = [
      {
        name: 'write_file',
        input: { path: 'app/README.md', content: 'Changed.\n' }
      },
      { name: 'write_file', input: { path: 'NOTES.md', content: 'New.\n' } }
    ]

    const planned = await askLibraryQuestion({
      workspace: library.workspace,
      toolCalls: [...writes, { name: 'bash', input: { command: 'git push' } }]
    })
    const bypassed = await askLibraryQuestion({
      workspace: library.workspace,
      toolCalls: writes,
      mode: 'bypass'
    })
    const read = await askLibraryQuestion({
      workspace: library.workspace,
      toolCalls: [
        { name: 'read_file', input: { path: 'app/README.md' } },
        { name: 'list_files', input: {} }
      ]
    })

    expect(planned).toStrictEqual(
      Array.from({ length: 3 }, () => {
        return '{"error":"This tool is not allowed in plan mode."}'
      })
    )
    expect(bypassed).toStrictEqual([
      expect.stringContaining('EACCES: permission denied'),
      expect.stringContaining('EACCES: permission denied')
    ])
    expect(read.join('\n')).toContain('The app repository.')
    expect(read.join('\n')).not.toContain('NOTES.md')
  })

  it('maps its repositories and the folders it is told, again after each pull', async () => {
    await createOrigin('mapped')
    const library = openLibrary('library-map', {
      mapFolders: ['mapped/apps'],
      repositories: { mapped: originOf('mapped') }
    })
    await mkdir(join(originsDir, 'mapped-work', 'apps', 'web'), {
      recursive: true
    })
    await commitTo('mapped', 'apps/web/README.md', 'The web app.\n')
    await library.pullOnce()
    const firstMap = library.map()
    await mkdir(join(originsDir, 'mapped-work', 'apps', 'admin'))
    await commitTo('mapped', 'apps/admin/README.md', 'The admin app.\n')
    await library.pullOnce()

    expect(firstMap).toBe('mapped/: README.md apps\nmapped/apps/: web')
    expect(library.map()).toBe(
      'mapped/: README.md apps\nmapped/apps/: admin web'
    )
  })

  it('stays at most one pull interval behind the default branch', async () => {
    const library = openLibrary('library-pulls', { pullIntervalMs: 20 })
    await using pulling = library.start()
    await library.pullOnce()

    await commitTo('app', 'PULLED.md', 'Pulled from dev.\n')

    await expect
      .poll(async () => {
        const results = await askLibraryQuestion({
          workspace: library.workspace,
          toolCalls: [{ name: 'read_file', input: { path: 'app/PULLED.md' } }]
        })

        return results.join('\n')
      })
      .toContain('Pulled from dev.')
  })

  it('pulls no other repository once its run stops', async () => {
    const pulled: string[] = []
    const firstPull = Promise.withResolvers<null>()
    const library = openLibrary('library-stop', {
      logger: recordPulls(pulled, firstPull)
    })

    {
      await using pulling = library.start()
      await firstPull.promise
    }

    expect(pulled).toStrictEqual(['app'])
  })

  it('stays alive and answers the next question when a question session is deleted', async () => {
    const library = openLibrary('library-delete')
    const host = openQuestionHost()
    await askLibraryQuestion({
      workspace: library.workspace,
      toolCalls: [READ_APP_README],
      host
    })

    await host.sessions.delete({ threadId: 'library-question' })
    await host.close()

    await expect(hostFree.list()).resolves.toContainEqual(
      expect.objectContaining({ key: library.key })
    )
    const results = await askLibraryQuestion({
      workspace: library.workspace,
      toolCalls: [READ_APP_README]
    })
    expect(results.join('\n')).toContain('The app repository.')
  })

  it('reattaches the same sandbox after a host restart, and goes on with the question of a thread', async () => {
    const persistence = memoryPersistence()
    const instances = new InMemorySandboxInstanceStore()
    const before = openLibrary('library-restart', { instances })
    const beforeHost = openQuestionHost(persistence)
    await askLibraryQuestion({
      workspace: before.workspace,
      toolCalls: [READ_APP_README],
      host: beforeHost
    })
    const bound = await liveSandboxOf(before.key)
    await beforeHost.close()

    const after = openLibrary('library-restart', { instances })
    const results = await askLibraryQuestion({
      workspace: after.workspace,
      toolCalls: [READ_APP_README],
      host: openQuestionHost(persistence)
    })

    expect(results.join('\n')).toContain('The app repository.')
    await expect(liveSandboxOf(after.key)).resolves.toStrictEqual(bound)
  })

  it('recreates its sandbox at the next pull when the sandbox is gone, under a question session already bound', async () => {
    const library = openLibrary('library-gone')
    const { ask } = await openLibraryQuestion({
      workspace: library.workspace,
      turns: [[READ_APP_README], [READ_APP_README]]
    })
    await ask()
    const gone = await liveSandboxOf(library.key)
    await hostFree.provider.destroy({ id: gone.id })

    await library.pullOnce()
    const results = await ask()

    expect(results.join('\n')).toContain('The app repository.')
    const recreated = await liveSandboxOf(library.key)
    expect(recreated.id).not.toBe(gone.id)
  })

  it('answers at once after a host restart, from the tree in place, with no pull before the question', async () => {
    const instances = new InMemorySandboxInstanceStore()
    const before = openLibrary('library-no-pull', { instances })
    await before.pullOnce()
    await commitTo('tooling', 'UNPULLED.md', 'Not pulled yet.\n')

    const after = openLibrary('library-no-pull', { instances })
    const results = await askLibraryQuestion({
      workspace: after.workspace,
      toolCalls: [
        { name: 'read_file', input: { path: 'tooling/README.md' } },
        { name: 'list_files', input: { path: 'tooling' } }
      ]
    })

    expect(results.join('\n')).toContain('The tooling repository.')
    expect(results.join('\n')).not.toContain('UNPULLED.md')
  })

  it('pulls every other repository when one of them fails', async () => {
    const library = openLibrary('library-one-fails', {
      repositories: { missing: originOf('missing'), app: originOf('app') }
    })

    await library.pullOnce()
    const results = await askLibraryQuestion({
      workspace: library.workspace,
      toolCalls: [READ_APP_README]
    })

    expect(results.join('\n')).toContain('The app repository.')
  })
})
