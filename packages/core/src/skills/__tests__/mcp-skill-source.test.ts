import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { InMemoryTransport, type Transport } from '@modelcontextprotocol/client'
import type { LogLine } from '#/host/mcp-server-log.ts'
import {
  mcpSkillSource,
  type McpSkillServer
} from '#/skills/mcp-skill-source.ts'
import { createHostFreeSandbox } from '#/testing/host-free-sandbox.ts'
import { runWorkerToolCall, type ToolCall } from '#/testing/tool-call.ts'
import {
  REVIEW_BODY,
  serveSkillsOnHttp,
  SIGNATURES,
  skillFiles,
  STANDARDS,
  startSkillServer,
  testMcpServer
} from './skill-server.ts'
import {
  serveSkillsOnStdio,
  STDIO_SERVER_GREETING
} from './stdio-skill-server.ts'

const STDIO_SERVER = pathToFileURL(
  join(import.meta.dirname, 'stdio-skill-server.ts')
).href

const LOAD_REVIEW = { name: 'load_skill', input: { name: 'team:review' } }

const WRITE_EMPTY_TODOS = { name: 'todo_write', input: { todos: [] } }

function serverWithoutSkills(): Transport {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  void testMcpServer().connect(serverSide)

  return clientSide
}

function recordingLog() {
  return {
    debug: vi.fn<LogLine>(),
    info: vi.fn<LogLine>(),
    warn: vi.fn<LogLine>(),
    error: vi.fn<LogLine>()
  }
}

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

function readResource(skill: string, path: string) {
  return { name: 'read_skill_resource', input: { skill, path } }
}

async function runWithTeamSkills(
  toolCall: ToolCall,
  server: McpSkillServer['server'],
  log = recordingLog()
) {
  await using source = mcpSkillSource({ prefix: 'team', server, log })

  return await runWorkerToolCall({
    hostFree,
    toolCall,
    skillSources: [source]
  })
}

describe('the skills of an MCP server', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeSandbox()
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it('reach the worker under the prefix of the distribution, with the body the server serves', async () => {
    const server = await startSkillServer()

    const run = await runWithTeamSkills(LOAD_REVIEW, server.connect)

    expect(run.systemPrompt).toContain('team:review')
    expect(run.systemPrompt).toContain('team:break')
    expect(JSON.parse(run.result)).toMatchObject({
      skill: 'team:review',
      content: REVIEW_BODY.trimEnd()
    })
  })

  it('show the worker the whole description of each skill, as a coding agent shows it', async () => {
    const server = await startSkillServer()

    const run = await runWithTeamSkills(LOAD_REVIEW, server.connect)

    expect(run.systemPrompt).toContain(
      'Review a diff in two fresh contexts. Use when a person asks for a review.'
    )
  })

  it('give the worker each file of a skill, checked against the manifest', async () => {
    const server = await startSkillServer()

    const run = await runWithTeamSkills(
      readResource('team:review', 'STANDARDS.md'),
      server.connect
    )

    expect(JSON.parse(run.result)).toMatchObject({
      skill: 'team:review',
      path: 'STANDARDS.md',
      content: STANDARDS
    })
  })

  it('refuse a file whose bytes no longer match the manifest', async () => {
    const server = await startSkillServer({
      served: {
        ...skillFiles(),
        'review/STANDARDS.md': '# Standards\n\nAnything goes.\n'
      }
    })

    const run = await runWithTeamSkills(
      readResource('team:review', 'STANDARDS.md'),
      server.connect
    )

    expect(run.result).not.toContain('Anything goes.')
    expect(JSON.parse(run.result)).toHaveProperty('error')
  })

  it.each([
    'SIGNATURES.md',
    '../break/SIGNATURES.md',
    'skill://break/SIGNATURES.md'
  ])(
    'refuse %s, a file outside the manifest of the skill it reads through',
    async (path) => {
      const server = await startSkillServer()

      const run = await runWithTeamSkills(
        readResource('team:review', path),
        server.connect
      )

      expect(run.result).not.toContain(SIGNATURES)
      expect(JSON.parse(run.result)).toHaveProperty('error')
    }
  )

  it('read a file of another skill through the entry of that skill', async () => {
    const server = await startSkillServer()

    const run = await runWithTeamSkills(
      readResource('team:break', 'SIGNATURES.md'),
      server.connect
    )

    expect(JSON.parse(run.result)).toMatchObject({ content: SIGNATURES })
  })

  it('leave out a skill with no manifest', async () => {
    const server = await startSkillServer({ dynamicSkills: ['break'] })

    const run = await runWithTeamSkills(LOAD_REVIEW, server.connect)

    expect(run.systemPrompt).toContain('team:review')
    expect(run.systemPrompt).not.toContain('team:break')
  })

  it('come back on a new connection after the server drops the last one', async () => {
    const server = await startSkillServer()
    await using source = mcpSkillSource({
      prefix: 'team',
      server: server.connect,
      log: recordingLog()
    })
    await runWorkerToolCall({
      hostFree,
      toolCall: LOAD_REVIEW,
      skillSources: [source]
    })

    await server.dropConnections()
    const run = await runWorkerToolCall({
      hostFree,
      toolCall: LOAD_REVIEW,
      skillSources: [source]
    })

    expect(run.systemPrompt).toContain('team:review')
    expect(JSON.parse(run.result)).toMatchObject({
      content: REVIEW_BODY.trimEnd()
    })
    expect(server.connectionCount()).toBe(1)
  })

  it('reach the worker from a server the host starts on stdio, with its stderr in the host log', async () => {
    const log = recordingLog()

    const run = await runWithTeamSkills(
      LOAD_REVIEW,
      {
        command: process.execPath,
        args: [
          '--input-type=module',
          '--eval',
          `const server = await import(${JSON.stringify(STDIO_SERVER)}); await server[${JSON.stringify(serveSkillsOnStdio.name)}]()`
        ]
      },
      log
    )

    expect(JSON.parse(run.result)).toMatchObject({
      skill: 'team:review',
      content: REVIEW_BODY.trimEnd()
    })
    await expect
      .poll(() => {
        return log.info.mock.calls
      })
      .toContainEqual([
        { stderr: STDIO_SERVER_GREETING },
        'The skills server wrote to stderr.'
      ])
  })

  it('reach the worker from a server at a URL', async () => {
    await using server = await serveSkillsOnHttp()

    const run = await runWithTeamSkills(LOAD_REVIEW, server.url)

    expect(JSON.parse(run.result)).toMatchObject({
      skill: 'team:review',
      content: REVIEW_BODY.trimEnd()
    })
  })

  it('let the worker run when the server is down, and say so', async () => {
    const log = recordingLog()

    const run = await runWithTeamSkills(
      WRITE_EMPTY_TODOS,
      () => {
        throw new Error('The skills server is down.')
      },
      log
    )

    expect(run.modelTools).toContain('bash')
    expect(run.systemPrompt).not.toContain('team:review')
    expect(log.warn).toHaveBeenCalledWith(
      { error: new Error('The skills server is down.'), prefix: 'team' },
      'The skills server is unavailable: the workers run without its skills.'
    )
  })

  it('say when the server does not serve the Skills extension', async () => {
    const log = recordingLog()
    const run = await runWithTeamSkills(
      WRITE_EMPTY_TODOS,
      serverWithoutSkills,
      log
    )

    expect(run.systemPrompt).not.toContain('team:')
    expect(log.warn).toHaveBeenCalledWith(
      {
        error: new Error(
          'The MCP server of the team skills does not serve the Skills extension.'
        ),
        prefix: 'team'
      },
      'The skills server is unavailable: the workers run without its skills.'
    )
  })
})
