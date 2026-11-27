import { createServerFn } from '@tanstack/react-start'

export const listFeedback = createServerFn({ method: 'GET' }).handler(
  async ({ context }) => {
    return context.feedback.recent()
  }
)
