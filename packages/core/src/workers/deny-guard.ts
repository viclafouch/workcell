import { z } from 'zod'
import type { ChatMiddleware, ToolCall } from '@tanstack/ai'
import {
  decidePermission,
  definePlugin,
  PermissionDecisionCapability,
  PermissionResources,
  PermissionRules,
  type PermissionRule,
  type ToolResources
} from '@tanstack/ai-harness'
import type { CommandDenial } from './permission-rules.ts'

const DENY_GUARD = 'workcell/deny-guard'

const RULE_DENIAL = 'A permission rule denies this tool.'

const ruleDenialSchema = z.object({ error: z.literal(RULE_DENIAL) })

type DeclaredResources = Readonly<Record<string, ToolResources>>

const commandCallSchema = z.object({ command: z.string() })

type CommandCall = z.infer<typeof commandCallSchema>

function commandCallOf({
  function: { arguments: text }
}: ToolCall): CommandCall | null {
  try {
    return commandCallSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

async function listed(
  entries: readonly ToolResources[],
  field: keyof ToolResources,
  input: unknown
) {
  const lists = await Promise.all(
    entries.map(async (entry) => {
      return (await entry[field]?.(input)) ?? []
    })
  )

  return lists.flat()
}

async function resourcesOf(
  declared: readonly DeclaredResources[],
  tool: string,
  input: unknown
) {
  const entries = declared.flatMap((item) => {
    return item[tool] === undefined ? [] : [item[tool]]
  })

  if (entries.length === 0) {
    return
  }

  const [paths, commands, outside, actions] = await Promise.all([
    listed(entries, 'paths', input),
    listed(entries, 'commands', input),
    listed(entries, 'outside', input),
    listed(entries, 'actions', input)
  ])

  return { paths, commands, outside, actions }
}

function matchesTool(rule: PermissionRule, tool: string) {
  return rule.tool.endsWith('*')
    ? tool.startsWith(rule.tool.slice(0, -1))
    : rule.tool === tool
}

function isHidden(rules: readonly PermissionRule[], tool: { name: string }) {
  const last = rules.findLast((rule) => {
    return matchesTool(rule, tool.name)
  })

  return last?.decision === 'deny' && last.resource === undefined
}

export function denyGuard(denials: readonly CommandDenial[]) {
  return definePlugin({
    name: DENY_GUARD,
    requires: [PermissionDecisionCapability],
    setup: (setupContext) => {
      const decide = setupContext.get(PermissionDecisionCapability)
      const declared = setupContext.collect(PermissionResources)
      const rules = setupContext.collect(PermissionRules)

      const isDenied = async (tool: string, input: unknown) => {
        try {
          const resources = await resourcesOf(declared, tool, input)

          return decide(tool, 'default', resources) === 'deny'
        } catch {
          return true
        }
      }

      const reasonOf = async (tool: string, input: unknown) => {
        const resources = await resourcesOf(declared, tool, input)
        const denial = denials.find(({ rules: denialRules }) => {
          return (
            decidePermission(denialRules, tool, 'default', { resources }) ===
            'deny'
          )
        })

        return denial?.reason
      }

      const guard: ChatMiddleware = {
        name: DENY_GUARD,
        onGuardToolCall: async (_ctx, { toolName, args }) => {
          return (await isDenied(toolName, args))
            ? { type: 'skip', result: { error: RULE_DENIAL } }
            : undefined
        },
        onAfterToolCall: async (_ctx, { toolName, toolCall, result }) => {
          const commandCall = commandCallOf(toolCall)

          if (
            commandCall === null ||
            !ruleDenialSchema.safeParse(result).success
          ) {
            return
          }

          const reason = await reasonOf(toolName, commandCall)

          return reason === undefined
            ? undefined
            : {
                type: 'replaceResult',
                result: { error: `${RULE_DENIAL} ${reason}` }
              }
        }
      }

      return {
        middleware: [guard],
        prepareTools: ({ tools }) => {
          return tools.filter((tool) => {
            return !isHidden(rules, tool)
          })
        }
      }
    }
  })
}
