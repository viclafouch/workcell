import type { ChatMiddleware } from '@tanstack/ai'
import {
  createExtensionPoint,
  definePlugin,
  type HarnessRunContext
} from '@tanstack/ai-harness'
import type { IsStarter } from '#/host/allowed-senders.ts'
import { starterOnlyActionRefusal } from '#/prompts/orchestrator.ts'

type StarterOnlyTool = {
  tool: string
  action: string
}

export const StarterOnlyTools = createExtensionPoint<StarterOnlyTool>(
  'workcell/starter-only-tools'
)

const STARTER_ONLY_GUARD = 'workcell/starter-only-guard'

export function starterOnlyGuard(isStarter: IsStarter) {
  return definePlugin({
    name: STARTER_ONLY_GUARD,
    setup: (setupContext) => {
      const starterOnlyTools = setupContext.collect(StarterOnlyTools)

      const guard: ChatMiddleware<HarnessRunContext> = {
        name: STARTER_ONLY_GUARD,
        onGuardToolCall: async ({ context }, { toolName }) => {
          const starterOnly = starterOnlyTools.find(({ tool }) => {
            return tool === toolName
          })

          return starterOnly === undefined || isStarter(context.run.user)
            ? undefined
            : {
                type: 'skip',
                result: starterOnlyActionRefusal(starterOnly.action)
              }
        }
      }

      return { middleware: [guard] }
    }
  })
}
