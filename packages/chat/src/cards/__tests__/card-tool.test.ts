import type { CardElement } from 'chat'
import { describe, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import type { CardLimits } from '@json-render/chat'
import { createHarnessHost, defineHarness } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import { SILENT_HOST_LOGGER } from '@workcell/core/testing'
import { CARD_EVENT, cardOfEvent } from '#/cards/card-event.ts'
import { chatCards, SHOW_CARD_TOOL } from '#/cards/card-tool.ts'

const DEPLOYS_SPEC = {
  root: 'card',
  elements: {
    card: {
      type: 'Card',
      props: { title: 'Weekly deploys' },
      children: ['summary', 'table']
    },
    summary: { type: 'Text', props: { content: 'Deploys are up.' } },
    table: {
      type: 'Table',
      props: { headers: ['Project', 'Deploys'], rows: [['web', '412']] }
    }
  }
}

const toolsSchema = z.array(
  z.object({ name: z.string(), description: z.string() })
)

type ShowCardParams = { spec: unknown; limits?: CardLimits }

async function showCard({ spec, limits }: ShowCardParams) {
  const toolResults: unknown[] = []
  const toolDescriptions: z.infer<typeof toolsSchema> = []
  const cards: (CardElement | undefined)[] = []
  const call: FakeResponseStep = ({ request }) => {
    toolDescriptions.push(...toolsSchema.parse(request.tools ?? []))

    return { toolCalls: [{ name: SHOW_CARD_TOOL, input: { spec } }] }
  }
  const answer: FakeResponseStep = ({ request }) => {
    toolResults.push(
      ...request.messages
        .filter(({ role }) => {
          return role === 'tool'
        })
        .map(({ content }) => {
          return content
        })
    )

    return { text: 'Here are the deploys.' }
  }
  const model = fakeText()
  model.setResponses([call, answer])
  const harness = defineHarness({
    name: 'test/cards',
    adapter: model,
    plugins: () => {
      return [chatCards({ limits })]
    }
  })
  const host = createHarnessHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER
  })
  onTestFinished(async () => {
    await host.close()
  })
  const session = await host.open(harness, { threadId: 'cards-1' })
  session.onEvent('CUSTOM', ({ event }) => {
    if (event.name === CARD_EVENT) {
      cards.push(cardOfEvent(event.value))
    }
  })

  await session.send('Show the deploys of the week.')
  await session.close()

  return { cards, toolResults, toolDescriptions }
}

describe('the show_card tool', () => {
  it('turns a valid spec into a card event of the turn, and tells the model the card is shown', async () => {
    const { cards, toolResults } = await showCard({ spec: DEPLOYS_SPEC })

    expect(cards).toStrictEqual([
      {
        type: 'card',
        title: 'Weekly deploys',
        subtitle: undefined,
        imageUrl: undefined,
        children: [
          { type: 'text', content: 'Deploys are up.', style: undefined },
          {
            type: 'table',
            headers: ['Project', 'Deploys'],
            rows: [['web', '412']],
            align: undefined,
            caption: undefined
          }
        ]
      }
    ])
    expect(toolResults).toStrictEqual([
      expect.stringContaining('The card is shown in the thread.')
    ])
  })

  it('answers an invalid spec with a tool error that lists what to fix, and shows no card', async () => {
    const { cards, toolResults } = await showCard({
      spec: {
        root: 'card',
        elements: {
          card: { type: 'Card', props: {}, children: ['go', 'empty'] },
          go: { type: 'Button', props: { id: 'go', label: 'Go' } },
          empty: { type: 'Text', props: { content: '' } }
        }
      }
    })

    expect(cards).toStrictEqual([])
    expect(toolResults).toStrictEqual([
      expect.stringMatching(
        /The card spec is not valid:[\s\S]*go: unknown component \\?"Button\\?"[\s\S]*empty\.props\.content/u
      )
    ])
  })

  it('holds a card to the limits of the platform', async () => {
    const { cards, toolResults } = await showCard({
      spec: DEPLOYS_SPEC,
      limits: { tableRows: 1 }
    })

    expect(cards).toStrictEqual([])
    expect(toolResults).toStrictEqual([
      expect.stringContaining('table: at most 1 rows including the header')
    ])
  })

  it('describes each component it can show to the model, and no button with no handler', async () => {
    const { toolDescriptions } = await showCard({ spec: DEPLOYS_SPEC })
    const [showCardTool] = toolDescriptions

    expect(showCardTool?.name).toBe(SHOW_CARD_TOOL)
    expect(showCardTool?.description).toContain('- Table: ')
    expect(showCardTool?.description).toContain('- LinkButton: ')
    expect(showCardTool?.description).not.toContain('- Button: ')
  })
})
