import { z } from 'zod'
import {
  definePlugin,
  PermissionResources,
  PermissionRules,
  type PermissionRule
} from '@tanstack/ai-harness'
import { mcp } from '@tanstack/ai-mcp/harness'
import { agentMetadataSchema, StarterOnlyTools } from '@workcell/core'
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
  'list_milestones',
  'get_document',
  'get_project',
  'list_projects',
  'get_team',
  'list_teams',
  'get_user',
  'list_users',
  'list_issue_labels',
  'list_issue_statuses'
].map(linearTool)

const COMMENT_TOOL = linearTool('save_comment')

const ISSUE_TOOL = linearTool('save_issue')

const NEW_ISSUE = 'create an issue'

const issueInputSchema = z.looseObject({ id: z.string().optional() })

function issueTarget(input: unknown) {
  const { id } = issueInputSchema.parse(input)

  return id === undefined ? NEW_ISSUE : `edit issue ${id}`
}

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

type LinearAccess = 'read' | 'comment' | 'create'

type AgentMetadata = z.infer<typeof agentMetadataSchema>

const READ_RULES: PermissionRule[] = [
  { tool: linearTool('*'), decision: 'deny' },
  ...READ_TOOLS.map((tool): PermissionRule => {
    return { tool, decision: 'allow', kind: 'read' }
  })
]

const COMMENT_RULES: PermissionRule[] = [
  { tool: COMMENT_TOOL, decision: 'deny', kind: 'execute' },
  {
    tool: COMMENT_TOOL,
    resource: OWN_TICKET_COMMENT,
    decision: 'allow',
    kind: 'execute'
  }
]

const CREATE_RULES: PermissionRule[] = [
  { tool: ISSUE_TOOL, resource: NEW_ISSUE, decision: 'allow' }
]

const ACCESS_RULES: Record<LinearAccess, PermissionRule[]> = {
  read: READ_RULES,
  comment: [...READ_RULES, ...COMMENT_RULES],
  create: [...READ_RULES, ...CREATE_RULES]
}

const WRITE_TOOLS: Record<LinearAccess, string[]> = {
  read: [],
  comment: [COMMENT_TOOL],
  create: [ISSUE_TOOL]
}

const STARTER_ONLY: Record<LinearAccess, string[]> = {
  read: [],
  comment: [],
  create: [ISSUE_TOOL]
}

type LinearToolsParams = {
  apiKey: string
  access?: LinearAccess
}

export function linearTools({ apiKey, access = 'comment' }: LinearToolsParams) {
  const writeTools = WRITE_TOOLS[access]

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
                { readTools: READ_TOOLS, writeTools, access },
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
              },
              [ISSUE_TOOL]: {
                commands: (input) => {
                  return [issueTarget(input)]
                }
              }
            }),
            ...STARTER_ONLY[access].map((tool) => {
              return StarterOnlyTools.item({
                tool,
                action: 'create a Linear ticket'
              })
            })
          ]
        }
      }
    })
  ]
}
