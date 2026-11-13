import { z } from 'zod'
import {
  definePlugin,
  PermissionResources,
  PermissionRules,
  type PermissionRule
} from '@tanstack/ai-harness'
import { mcp } from '@tanstack/ai-mcp/harness'
import { agentMetadataSchema } from '@workcell/core'
import { linearPrompt } from '#/prompts/linear.ts'

export const LINEAR_MCP_URL = 'https://mcp.linear.app/mcp'

const SERVER_NAME = 'linear'

function linearTool(name: string) {
  return `${SERVER_NAME}_${name}`
}

const READ_TOOLS = [
  'get_issue',
  'list_comments',
  'list_issues',
  'get_milestone',
  'get_document',
  'get_project'
].map(linearTool)

const COMMENT_TOOL = linearTool('save_comment')

const commentInputSchema = z.looseObject({
  id: z.string().optional(),
  parentId: z.string().optional(),
  issueId: z.string().optional()
})

const OWN_TICKET_COMMENT = 'comment on the own ticket'

function commentTarget(input: unknown, ownTicket: string | undefined) {
  const { id, parentId, issueId, ...rest } = commentInputSchema.parse(input)
  const hasOtherParent = Object.keys(rest).some((key) => {
    return key.endsWith('Id')
  })

  if (id !== undefined) {
    return `edit comment ${id}`
  }

  if (parentId !== undefined) {
    return `reply to comment ${parentId}`
  }

  if (issueId !== undefined && !hasOtherParent) {
    return issueId === ownTicket
      ? OWN_TICKET_COMMENT
      : `comment on issue ${issueId}`
  }

  return 'comment outside an issue'
}

type LinearAccess = 'read' | 'write'

type AgentMetadata = z.infer<typeof agentMetadataSchema>

const READ_RULES: PermissionRule[] = [
  { tool: linearTool('*'), decision: 'deny' },
  ...READ_TOOLS.map((tool): PermissionRule => {
    return { tool, decision: 'allow', kind: 'read' }
  })
]

const WRITE_RULES: PermissionRule[] = [
  { tool: COMMENT_TOOL, decision: 'deny', kind: 'execute' },
  {
    tool: COMMENT_TOOL,
    resource: OWN_TICKET_COMMENT,
    decision: 'allow',
    kind: 'execute'
  }
]

const ACCESS_RULES: Record<LinearAccess, PermissionRule[]> = {
  read: READ_RULES,
  write: [...READ_RULES, ...WRITE_RULES]
}

type LinearToolsParams = {
  apiKey: string
  access?: LinearAccess
}

export function linearTools({ apiKey, access = 'write' }: LinearToolsParams) {
  const writeTools = access === 'write' ? [COMMENT_TOOL] : []

  return [
    mcp({
      servers: {
        [SERVER_NAME]: {
          type: 'http',
          url: LINEAR_MCP_URL,
          headers: { authorization: `Bearer ${apiKey}` }
        }
      }
    }),
    definePlugin({
      name: 'workcell/linear-permissions',
      metadataSchema: agentMetadataSchema,
      setup: (setupContext) => {
        let metadata: AgentMetadata = {}

        return {
          onTurnStart: async () => {
            const entry = await setupContext.session.indexEntry()
            metadata = entry?.metadata ?? {}
          },
          prompts: [
            () => {
              return linearPrompt(
                { readTools: READ_TOOLS, writeTools },
                metadata.subject
              )
            }
          ],
          contribute: [
            ...ACCESS_RULES[access].map((rule) => {
              return PermissionRules.item(rule)
            }),
            PermissionResources.item({
              [COMMENT_TOOL]: {
                commands: (input) => {
                  return [commentTarget(input, metadata.subject)]
                }
              }
            })
          ]
        }
      }
    })
  ]
}
