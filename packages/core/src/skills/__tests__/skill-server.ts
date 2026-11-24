import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { InMemoryTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import {
  memorySkillFiles,
  SkillCatalog,
  skillEntry,
  SkillsExtension
} from '@modelcontextprotocol/server/ext/skills'

const SKILL_SCHEME = 'skill://'

export const REVIEW_BODY =
  '# Review\n\nRead `STANDARDS.md`, then `skill://break/SIGNATURES.md`.\n'

export const STANDARDS = '# Standards\n\nNames carry the intent.\n'

export const SIGNATURES = '# Signatures\n\nA long name breaks the row.\n'

type SkillFiles = Record<string, string>

export function skillFiles() {
  return {
    'review/SKILL.md': `---\nname: review\ndescription: Review a diff in two fresh contexts. Use when a person asks for a review.\n---\n\n${REVIEW_BODY}`,
    'review/STANDARDS.md': STANDARDS,
    'break/SKILL.md':
      '---\nname: break\ndescription: Break a component with worst-case data.\n---\n\n# Break\n',
    'break/SIGNATURES.md': SIGNATURES
  }
}

export function testMcpServer(skills?: SkillsExtension) {
  const server = new McpServer({ name: 'test-skills', version: '1.0.0' })
  skills?.attach(server)

  return server
}

export function loadSkillCatalog() {
  return SkillCatalog.load(memorySkillFiles(skillFiles()), { strict: true })
}

function filesOfSkill(files: SkillFiles, skill: string) {
  return Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => {
        return path.startsWith(`${skill}/`)
      })
      .map(([path, content]) => {
        return [path.slice(skill.length + 1), content]
      })
  )
}

type StartSkillServerParams = {
  served?: SkillFiles
  dynamicSkills?: readonly string[]
}

export async function startSkillServer({
  served = skillFiles(),
  dynamicSkills = []
}: StartSkillServerParams = {}) {
  const files = skillFiles()
  const skillNames = [
    ...new Set(
      Object.keys(files).map((path) => {
        return path.split('/')[0] ?? path
      })
    )
  ]
  const entries = await Promise.all(
    skillNames.map(async (skill) => {
      const entry = await skillEntry(skill, filesOfSkill(files, skill))

      return dynamicSkills.includes(skill)
        ? { ...entry, resources: 'dynamic' as const }
        : entry
    })
  )
  const extension = new SkillsExtension({
    source: {
      list: async () => {
        return { skills: entries }
      },
      get: async (uri) => {
        return entries.find((entry) => {
          return entry.uri === uri
        })
      },
      read: async (uri) => {
        const text = served[uri.slice(SKILL_SCHEME.length)]

        return text === undefined ? undefined : { text }
      }
    }
  })
  const connections: InMemoryTransport[] = []

  const connect = () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    void testMcpServer(extension).connect(serverSide)
    connections.push(serverSide)

    return clientSide
  }

  const dropConnections = async () => {
    await Promise.all(
      connections.splice(0).map((connection) => {
        return connection.close()
      })
    )
  }

  return {
    connect,
    dropConnections,
    connectionCount: () => {
      return connections.length
    }
  }
}

async function bodyOf(request: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

function relayTo(handler: ReturnType<typeof createMcpHandler>) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const answer = await handler.fetch(
      new Request(`http://127.0.0.1${request.url ?? '/'}`, {
        method: request.method,
        headers: Object.entries(request.headers).flatMap(([name, value]) => {
          return value === undefined ? [] : [[name, String(value)]]
        }),
        body: hasBody ? await bodyOf(request) : undefined
      })
    )
    response.writeHead(answer.status, Object.fromEntries(answer.headers))

    if (answer.body !== null) {
      for await (const chunk of answer.body) {
        response.write(chunk)
      }
    }

    response.end()
  }
}

export async function serveSkillsOnHttp() {
  const catalog = await loadSkillCatalog()
  const relay = relayTo(
    createMcpHandler(() => {
      return testMcpServer(catalog)
    })
  )
  const server = createServer((request, response) => {
    void relay(request, response)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()

  if (address === null || typeof address === 'string') {
    throw new Error('The test skills server listens on no port.')
  }

  return {
    url: new URL(`http://127.0.0.1:${address.port}/mcp`),
    [Symbol.asyncDispose]: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    }
  }
}
