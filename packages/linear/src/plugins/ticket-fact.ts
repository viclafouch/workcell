import { definePlugin } from '@tanstack/ai-harness'
import { TaskFacts } from '@workcell/core'
import { ticketFact } from '#/prompts/linear.ts'

export const ticketTaskFact = definePlugin({
  name: 'workcell/linear-task-facts',
  setup: () => {
    return {
      contribute: [
        TaskFacts.item(({ subject }) => {
          return subject === undefined ? undefined : ticketFact(subject)
        })
      ]
    }
  }
})
