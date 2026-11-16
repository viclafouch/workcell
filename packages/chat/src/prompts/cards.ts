type CardComponent = {
  name: string
  description: string
  props: readonly string[]
  example: unknown
  hasChildren: boolean
}

export function cardToolDescription(components: readonly CardComponent[]) {
  const catalog = components
    .map(({ name, description, props, example, hasChildren }) => {
      const children = hasChildren ? ' Takes children.' : ''
      const propNames = props.length === 0 ? 'none' : props.join(', ')

      return `- ${name}: ${description}${children} Props: ${propNames}. Example: ${JSON.stringify(example)}`
    })
    .join('\n')

  return [
    'Show a card in the chat thread, after your answer: a table, a chart, key figures or links.',
    'Call it when the data reads better as a table or a chart than as text, such as counts over time or a list with several columns. Answer in plain text otherwise.',
    'With a card, your text answer is one line that gives the result, and leaves every figure of the card to the card.',
    'Give each Table a caption and each Chart a title.',
    'The spec is a flat tree. root is the id of a Card element. elements maps each id to { type, props, children }, and children lists the ids of the child elements.',
    'A tool error lists what to fix in the spec: fix it and call again.',
    `The components:\n${catalog}`
  ].join('\n')
}

export const CARD_TOOL_TEXT = {
  spec: 'The card, as { root, elements }.',
  shown: 'The card is shown in the thread.',
  invalid: (issues: readonly string[]) => {
    return `The card spec is not valid:\n${issues.join('\n')}`
  }
}
