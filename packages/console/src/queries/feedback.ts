import { queryOptions } from '@tanstack/react-query'
import { listFeedback } from '#/server/feedback.functions.ts'

export const FEEDBACK_QUERY_KEY = ['feedback'] as const

export const listFeedbackQueryOpts = () => {
  return queryOptions({
    queryKey: FEEDBACK_QUERY_KEY,
    queryFn: () => {
      return listFeedback()
    }
  })
}
