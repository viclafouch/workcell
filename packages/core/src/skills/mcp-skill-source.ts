import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import {
  Client,
  StreamableHTTPClientTransport,
  type Transport
} from '@modelcontextprotocol/client'
import {
  SkillsClient,
  type Skill
} from '@modelcontextprotocol/client/ext/skills'
import {
  StdioClientTransport,
  type StdioServerParameters
} from '@modelcontextprotocol/client/stdio'
import type { SkillSource } from '@tanstack/ai-skills'
import type { LeveledLog } from '#/host/tanstack-logger.ts'

const SKILL_FILE = 'SKILL.md'

const CLIENT_INFO = { name: 'workcell', version: '1.0.0' }

type Connection = {
  client: Client
  skills: SkillsClient
}

type LiveConnection = {
  connection?: Promise<Connection>
}

export type McpSkillServer = {
  prefix: string
  server: StdioServerParameters | URL | (() => Transport)
}

type McpSkillSourceParams = McpSkillServer & {
  log: LeveledLog
}

function stdioTransport(server: StdioServerParameters, log: LeveledLog) {
  const transport = new StdioClientTransport({ ...server, stderr: 'pipe' })

  if (transport.stderr instanceof Readable) {
    createInterface({ input: transport.stderr }).on('line', (line) => {
      log.info({ stderr: line }, 'The skills server wrote to stderr.')
    })
  }

  return transport
}

function transportOf({ server }: McpSkillServer, log: LeveledLog) {
  if (typeof server === 'function') {
    return server()
  }

  return server instanceof URL
    ? new StreamableHTTPClientTransport(server)
    : stdioTransport(server, log)
}

function rootOf(skill: Skill) {
  return skill.uri.slice(0, -SKILL_FILE.length)
}

function resourcePaths(skill: Skill) {
  if (skill.resources === 'dynamic') {
    return []
  }

  return skill.resources
    .map(({ uri }) => {
      return uri.slice(rootOf(skill).length)
    })
    .filter((path) => {
      return path !== SKILL_FILE
    })
}

function hasManifest(skill: Skill) {
  return skill.resources !== 'dynamic'
}

export function mcpSkillSource({
  prefix,
  server,
  log
}: McpSkillSourceParams): SkillSource & AsyncDisposable {
  const live: LiveConnection = {}

  const open = async () => {
    const client = new Client(CLIENT_INFO)
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the SDK client exposes its close only as onclose
    client.onclose = () => {
      delete live.connection
    }

    await client.connect(transportOf({ prefix, server }, log))

    const skills = new SkillsClient(client)

    if (!skills.supported) {
      await client.close()
      throw new Error(
        `The MCP server of the ${prefix} skills does not serve the Skills extension.`
      )
    }

    return { client, skills }
  }

  const connect = async () => {
    live.connection ??= open()

    try {
      const { skills } = await live.connection

      return skills
    } catch (error) {
      delete live.connection
      throw error
    }
  }

  const prefixed = (skill: Skill) => {
    return `${prefix}:${skill.frontmatter.name}`
  }

  const listed = async () => {
    const skills = await connect()
    const listing = await skills.list()

    return listing.skills.filter(hasManifest)
  }

  const entryOf = async (name: string) => {
    const skills = await listed()
    const skill = skills.find((entry) => {
      return prefixed(entry) === name
    })

    if (skill === undefined) {
      throw new Error(`no skill named "${name}"`)
    }

    return skill
  }

  const read = async (name: string, ref?: string) => {
    const skill = await entryOf(name)
    const skills = await connect()

    return skills.read(skill, ref)
  }

  return {
    list: async () => {
      try {
        const skills = await listed()

        return skills.map((skill) => {
          return {
            name: prefixed(skill),
            description: skill.frontmatter.description
          }
        })
      } catch (error) {
        log.warn(
          { error, prefix },
          'The skills server is unavailable: the agents run without its skills.'
        )

        return []
      }
    },
    load: async (name) => {
      const file = await read(name)

      return file.text ?? new TextDecoder().decode(file.bytes)
    },
    listResources: async (name) => {
      const skill = await entryOf(name)

      return resourcePaths(skill)
    },
    readResource: async (name, path) => {
      const file = await read(name, path)

      return file.text ?? file.bytes
    },
    [Symbol.asyncDispose]: async () => {
      const [opened] = await Promise.allSettled([live.connection])
      delete live.connection

      if (opened.status === 'fulfilled') {
        await opened.value?.client.close()
      }
    }
  }
}

export function mcpSkillSources(
  servers: readonly McpSkillServer[],
  log: LeveledLog
) {
  const sources = new Map<string, SkillSource & AsyncDisposable>()

  for (const server of servers) {
    if (!sources.has(server.prefix)) {
      sources.set(server.prefix, mcpSkillSource({ ...server, log }))
    }
  }

  return {
    of: (listed: readonly McpSkillServer[] = []) => {
      return listed.flatMap(({ prefix }) => {
        return sources.get(prefix) ?? []
      })
    },
    [Symbol.asyncDispose]: async () => {
      await Promise.all(
        sources.values().map((source) => {
          return source[Symbol.asyncDispose]()
        })
      )
    }
  }
}
