import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHarnessHost, defineHarness } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import { instructionFiles } from '#/prompts/instruction-files.ts'
import { SILENT_HOST_LOGGER } from '#/testing/test-doubles.ts'

const REPOSITORY = 'acme/app'

let folder: string

function fileOf(name: string) {
  return join(folder, `${name}.md`)
}

async function openAgent(repository?: string) {
  const systemPrompts: string[][] = []
  const model = fakeText()
  const recordPrompts: FakeResponseStep = ({ request }) => {
    systemPrompts.push(
      (request.systemPrompts ?? []).map((prompt) => {
        return typeof prompt === 'string' ? prompt : prompt.content
      })
    )

    return { text: 'Done.' }
  }
  model.setResponses([recordPrompts, recordPrompts])
  const host = createHarnessHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER
  })
  const agent = defineHarness({
    name: 'test/instruction-files',
    adapter: model,
    plugins: () => {
      return [
        instructionFiles({
          files: [fileOf('shared'), fileOf('worker')],
          repositories: { [REPOSITORY]: fileOf('app') }
        })
      ]
    }
  })
  const session = await host.open(agent, { threadId: 'instruction-files' })

  if (repository !== undefined) {
    await session.updateIndexEntry({
      metadata: { name: 'Alpha', task: 'Fix the login.', repository }
    })
  }

  return { host, session, systemPrompts }
}

describe('the instruction files', () => {
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'instruction-files-'))
  })

  beforeEach(async () => {
    await writeFile(fileOf('shared'), '# Shared\n')
    await writeFile(fileOf('worker'), '# Worker\n')
    await writeFile(fileOf('app'), '# App\n')
  })

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('give the files in their order, then the file of the repository of the session', async () => {
    const { host, session, systemPrompts } = await openAgent(REPOSITORY)

    await session.send('Hello.')
    await host.close()

    expect(systemPrompts).toStrictEqual([
      ['# Shared\n', '# Worker\n', '# App\n']
    ])
  })

  it('give no repository file to a session on a repository with none', async () => {
    const { host, session, systemPrompts } = await openAgent('acme/other')

    await session.send('Hello.')
    await host.close()

    expect(systemPrompts).toStrictEqual([['# Shared\n', '# Worker\n']])
  })

  it('read the files again at each turn, so an edit needs no restart', async () => {
    const { host, session, systemPrompts } = await openAgent()

    await session.send('Hello.')
    await writeFile(fileOf('worker'), '# Worker, edited\n')
    await session.send('Again.')
    await host.close()

    expect(systemPrompts.at(-1)).toStrictEqual([
      '# Shared\n',
      '# Worker, edited\n'
    ])
  })
})
