import { isCardElement, type CardElement } from 'chat'
import { z } from 'zod'

export const CARD_EVENT = 'workcell.card'

const cardEventSchema = z.object({ card: z.unknown() })

export function cardEventValue(card: CardElement) {
  return { card }
}

export function cardOfEvent(value: unknown): CardElement | undefined {
  const card = cardEventSchema.safeParse(value).data?.card

  return isCardElement(card) ? card : undefined
}
