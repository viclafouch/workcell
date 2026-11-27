import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toolDefinition, type TextOptions } from '@tanstack/ai'
import {
  createHarnessHost,
  type HarnessUser,
  type PermissionMode
} from '@tanstack/ai-harness'
import { createMCPServer } from '@tanstack/ai-mcp/server'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import type { WorkerMetadata } from '@workcell/core'
import {
  createHostFreeLifecycle,
  createHostFreeSandbox,
  createMessageReader,
  createWorkers,
  defineTestWorker,
  HOST_FREE_REPOSITORY,
  isStarterIn,
  readOnlyCredentials,
  runWorkerToolCall,
  SILENT_HOST_LOGGER,
  starterOnlyGuard,
  TEST_STARTER,
  type ToolCall
} from '@workcell/core/testing'
import { LINEAR_MCP_URL, linearTools } from '#/plugins/linear-tools.ts'

const LINEAR_API_KEY = 'lin_api_test_key_value'

const OWN_TICKET = 'TASK-7'

const RULE_DENIAL = 'A permission rule denies this tool.'

const PLAN_DENIAL = 'This tool is not allowed in plan mode.'

const LONG_DOCUMENT_ID = 'long-document'

const LONG_DOCUMENT_LINES = 2_000

const LONG_DOCUMENT = 'A paragraph of a long Linear document.\n'.repeat(
  LONG_DOCUMENT_LINES
)

type LinearCall = { tool: string; input: unknown }

const linearCalls: LinearCall[] = []

function fakeLinearTool(name: string, inputSchema: z.ZodObject) {
  return toolDefinition({
    name,
    description: `The ${name} tool of Linear.`,
    inputSchema
  }).server(async (input) => {
    linearCalls.push({ tool: name, input })

    return { ok: true }
  })
}

const fakeLinear = createMCPServer({
  name: 'linear',
  version: '1.0.0',
  tools: [
    fakeLinearTool('get_issue', z.object({ id: z.string() })),
    fakeLinearTool('list_comments', z.object({ issueId: z.string() })),
    fakeLinearTool('list_issues', z.object({ query: z.string() })),
    fakeLinearTool('get_milestone', z.object({ query: z.string() })),
    toolDefinition({
      name: 'get_document',
      description: 'The get_document tool of Linear.',
      inputSchema: z.object({ id: z.string() })
    }).server(async (input) => {
      linearCalls.push({ tool: 'get_document', input })

      return input.id === LONG_DOCUMENT_ID ? LONG_DOCUMENT : { ok: true }
    }),
    fakeLinearTool('get_project', z.object({ query: z.string() })),
    fakeLinearTool(
      'save_comment',
      z.object({
        body: z.string(),
        issueId: z.string().optional(),
        documentId: z.string().optional(),
        parentId: z.string().optional(),
        id: z.string().optional()
      })
    ),
    fakeLinearTool(
      'save_issue',
      z.object({ title: z.string(), id: z.string().optional() })
    ),
    fakeLinearTool('delete_comment', z.object({ id: z.string() })),
    fakeLinearTool('list_teams', z.object({ query: z.string() }))
  ]
})

const network = setupServer(
  http.all(LINEAR_MCP_URL, ({ request }) => {
    if (request.headers.get('authorization') !== `Bearer ${LINEAR_API_KEY}`) {
      return new HttpResponse(null, { status: 401 })
    }

    return fakeLinear.fetch(request)
  })
)

const toolListSchema = z.array(z.object({ name: z.string() }))

function toolNames(request: TextOptions) {
  return toolListSchema.parse(request.tools ?? []).map(({ name }) => {
    return name
  })
}

const WORKER_METADATA: WorkerMetadata = {
  name: 'Alpha',
  task: `Work on ${OWN_TICKET}.`,
  repository: 'acme/app',
  subject: OWN_TICKET
}

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

function linearToolNames(names: readonly string[]) {
  return names.filter((name) => {
    return name.startsWith('linear_')
  })
}

type LinearAccess = Parameters<typeof linearTools>[0]['access']

const COLLEAGUE: HarnessUser = { id: 'colleague' }

type RunOptions = {
  mode?: PermissionMode
  access?: LinearAccess
  user?: HarnessUser
}

async function runToolCall(
  toolCall: ToolCall,
  { mode, access, user }: RunOptions = {}
) {
  const run = await runWorkerToolCall({
    hostFree,
    toolCall,
    mode,
    user,
    metadata: WORKER_METADATA,
    plugins: [
      ...linearTools({ apiKey: LINEAR_API_KEY, access }),
      starterOnlyGuard(isStarterIn([TEST_STARTER.id]))
    ]
  })

  return { ...run, modelTools: linearToolNames(run.modelTools) }
}

function createIssue(input: Record<string, unknown>, user?: HarnessUser) {
  return runToolCall(
    { name: 'linear_save_issue', input: { title: 'Fix the header', ...input } },
    { mode: 'plan', access: 'create', user }
  )
}

function comment(input: Record<string, unknown>, mode?: PermissionMode) {
  return runToolCall(
    { name: 'linear_save_comment', input: { body: 'Done.', ...input } },
    { mode }
  )
}

describe('the Linear tools', () => {
  beforeAll(async () => {
    network.listen({ onUnhandledFrame: 'error' })
    hostFree = await createHostFreeSandbox()
  })

  beforeEach(() => {
    linearCalls.length = 0
  })

  afterAll(async () => {
    network.close()
    await hostFree.destroy()
  })

  it('gives the model the Linear tools of a worker, and hides the others, in bypass mode', async () => {
    const run = await runToolCall(
      { name: 'linear_get_issue', input: { id: OWN_TICKET } },
      { mode: 'bypass' }
    )

    expect(run.modelTools.toSorted()).toStrictEqual([
      'linear_get_document',
      'linear_get_issue',
      'linear_get_milestone',
      'linear_get_project',
      'linear_list_comments',
      'linear_list_issues',
      'linear_list_teams',
      'linear_save_comment'
    ])
  })

  it('gives a reader only the Linear read tools, and tells it that it writes nothing', async () => {
    const run = await runToolCall(
      {
        name: 'linear_save_comment',
        input: { body: 'Done.', issueId: OWN_TICKET }
      },
      { mode: 'plan', access: 'read' }
    )

    expect(run.modelTools.toSorted()).toStrictEqual([
      'linear_get_document',
      'linear_get_issue',
      'linear_get_milestone',
      'linear_get_project',
      'linear_list_comments',
      'linear_list_issues',
      'linear_list_teams'
    ])
    expect(run.systemPrompt).toContain('You write nothing in Linear.')
    expect(run.systemPrompt).not.toContain('You comment on')
    expect(linearCalls).toStrictEqual([])
  })

  it('reads a ticket with the key in the bearer header, with no question', async () => {
    const run = await runToolCall({
      name: 'linear_get_issue',
      input: { id: OWN_TICKET }
    })

    expect(run.asked).toBe(false)
    expect(linearCalls).toStrictEqual([
      { tool: 'get_issue', input: { id: OWN_TICKET } }
    ])
  })

  it('cuts a long document before the model reads it', async () => {
    const run = await runToolCall({
      name: 'linear_get_document',
      input: { id: LONG_DOCUMENT_ID }
    })

    expect(run.result).toMatch(
      /\[Output cut\. Showing the first \d+ of 2000 lines, 51200 of 78000 bytes\.\]$/u
    )
    expect(run.modelContext).toContain('[Output cut.')
  })

  it('comments on its own ticket with no question', async () => {
    const run = await comment({ issueId: OWN_TICKET })

    expect(run.asked).toBe(false)
    expect(linearCalls).toStrictEqual([
      { tool: 'save_comment', input: { body: 'Done.', issueId: OWN_TICKET } }
    ])
  })

  it.each([
    { name: 'a comment on another ticket', input: { issueId: 'TASK-8' } },
    {
      name: 'a reply',
      input: { issueId: OWN_TICKET, parentId: 'comment-1' }
    },
    { name: 'a comment edit', input: { issueId: OWN_TICKET, id: 'comment-1' } },
    {
      name: 'a comment with a second parent',
      input: { issueId: OWN_TICKET, documentId: 'document-1' }
    }
  ])('refuses $name with no question', async ({ input }) => {
    const run = await comment(input)

    expect(run.asked).toBe(false)
    expect(run.result).toContain(RULE_DENIAL)
    expect(linearCalls).toStrictEqual([])
  })

  it('refuses a comment on another ticket in bypass mode', async () => {
    const run = await comment({ issueId: 'TASK-8' }, 'bypass')

    expect(run.result).toContain(RULE_DENIAL)
    expect(linearCalls).toStrictEqual([])
  })

  it('comments on its own ticket in bypass mode', async () => {
    await comment({ issueId: OWN_TICKET }, 'bypass')

    expect(linearCalls).toStrictEqual([
      { tool: 'save_comment', input: { body: 'Done.', issueId: OWN_TICKET } }
    ])
  })

  it('blocks a Linear write in plan mode', async () => {
    const run = await runToolCall(
      {
        name: 'linear_save_comment',
        input: { body: 'Done.', issueId: OWN_TICKET }
      },
      { mode: 'plan' }
    )

    expect(run.result).toContain(PLAN_DENIAL)
    expect(linearCalls).toStrictEqual([])
  })

  it('gives a ticket creator the Linear read tools and save_issue, and no comment', async () => {
    const run = await createIssue({})

    expect(run.modelTools.toSorted()).toStrictEqual([
      'linear_get_document',
      'linear_get_issue',
      'linear_get_milestone',
      'linear_get_project',
      'linear_list_comments',
      'linear_list_issues',
      'linear_list_teams',
      'linear_save_issue'
    ])
    expect(run.systemPrompt).toContain(
      'You create a Linear ticket with linear_save_issue'
    )
  })

  it('creates a ticket for an allowed starter in plan mode, with no question', async () => {
    const run = await createIssue({})

    expect(run.asked).toBe(false)
    expect(linearCalls).toStrictEqual([
      { tool: 'save_issue', input: { title: 'Fix the header' } }
    ])
  })

  it('refuses to edit a ticket that exists', async () => {
    const run = await createIssue({ id: 'TASK-8' })

    expect(run.asked).toBe(false)
    expect(run.result).toContain(PLAN_DENIAL)
    expect(linearCalls).toStrictEqual([])
  })

  it('refuses a ticket to a colleague, and names who can create one', async () => {
    const run = await createIssue({}, COLLEAGUE)

    expect(run.result).toContain(
      'The user of this message may not create a Linear ticket: only an allowed starter can.'
    )
    expect(linearCalls).toStrictEqual([])
  })

  it('tells the model to say so when the Linear server is down', async () => {
    const run = await runToolCall({
      name: 'linear_get_issue',
      input: { id: OWN_TICKET }
    })

    expect(run.systemPrompt).toContain(
      'When one of these tools is missing, the Linear server is down: say so, and never guess what a ticket says.'
    )
  })

  it('logs a refused key as a failed server, runs the turn, and never logs the key', async () => {
    const lines: string[] = []
    const record = (details: Record<string, unknown>, message: string) => {
      lines.push(JSON.stringify({ ...details, message }))
    }
    const model = fakeText()
    const modelTools: string[] = []
    model.setResponses([
      ({ request }: { request: TextOptions }) => {
        modelTools.push(...linearToolNames(toolNames(request)))

        return { text: 'The Linear server is down.' }
      }
    ])
    const host = createHarnessHost({
      persistence: memoryPersistence(),
      logger: SILENT_HOST_LOGGER,
      credentials: readOnlyCredentials({ LINEAR_API_KEY: 'lin_api_revoked' })
    })
    const lifecycle = createHostFreeLifecycle(host, hostFree)
    const harness = defineTestWorker({
      host,
      model,
      hostFree,
      lifecycle,
      plugins: linearTools({ apiKey: 'lin_api_revoked' })
    })
    const workers = createWorkers({
      host,
      harness,
      lifecycle,
      isStarter: isStarterIn([TEST_STARTER.id]),
      repositories: [HOST_FREE_REPOSITORY],
      workerNames: ['Alpha'],
      capacity: 1,
      permissionMode: 'bypass',
      readMessage: createMessageReader({
        modalities: undefined,
        logger: SILENT_HOST_LOGGER
      }),
      logger: {
        child: () => {
          return { info: record, warn: record, error: record }
        }
      }
    })

    const worker = await workers.startWorker({
      starter: TEST_STARTER,
      repository: HOST_FREE_REPOSITORY,
      task: `Read ${OWN_TICKET}.`,
      subject: OWN_TICKET
    })
    await worker.firstTurn
    const view = await host.observe(harness, { threadId: worker.threadId })
    const transcript = await view.transcript()
    await host.close()

    expect(transcript.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'The Linear server is down.'
    })
    expect(modelTools).toStrictEqual([])
    expect(lines.join('\n')).toContain('"server":"linear","status":"failed"')
    expect(lines.join('\n')).not.toContain('lin_api_revoked')
  })
})
