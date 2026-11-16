import { z } from 'zod'
import {
  CardSpecError,
  standardComponentDefinitions,
  toCard,
  type CardLimits
} from '@json-render/chat'
import { toolDefinition } from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import { CARD_TOOL_TEXT, cardToolDescription } from '#/prompts/cards.ts'
import { CARD_EVENT, cardEventValue } from './card-event.ts'

const CARD_PLUGIN = 'workcell/chat-cards'

export const SHOW_CARD_TOOL = 'show_card'

const BUTTONS_WITH_NO_HANDLER = new Set(['Button'])

const cardComponents = Object.fromEntries(
  Object.entries(standardComponentDefinitions).filter(([name]) => {
    return !BUTTONS_WITH_NO_HANDLER.has(name)
  })
)

const elementSchema = z.object({
  type: z.string(),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.string()).optional()
})

const specSchema = z.object({
  root: z.string(),
  elements: z.record(z.string(), elementSchema),
  state: z.record(z.string(), z.unknown()).optional()
})

const showCardInputSchema = z.object({
  spec: specSchema.describe(CARD_TOOL_TEXT.spec)
})

type ChatCardsParams = { limits?: CardLimits }

export function chatCards({ limits }: ChatCardsParams = {}) {
  const description = cardToolDescription(
    Object.entries(cardComponents).map(([name, definition]) => {
      return {
        name,
        description: definition.description,
        props: Object.keys(definition.props.shape),
        example: definition.example,
        hasChildren: definition.slots.length > 0
      }
    })
  )

  const showCard = toolDefinition({
    name: SHOW_CARD_TOOL,
    description,
    inputSchema: showCardInputSchema
  }).server(({ spec }, context) => {
    try {
      const card = toCard(spec, { components: cardComponents, limits })
      context?.emitCustomEvent(CARD_EVENT, cardEventValue(card))

      return CARD_TOOL_TEXT.shown
    } catch (error) {
      const issues = error instanceof CardSpecError ? error.issues : undefined

      if (issues === undefined) {
        throw error
      }

      throw new Error(CARD_TOOL_TEXT.invalid(issues), { cause: error })
    }
  })

  return definePlugin({
    name: CARD_PLUGIN,
    lifetime: 'host',
    setup: () => {
      return { tools: [showCard] }
    }
  })
}
