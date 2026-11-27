import { queryOptions } from '@tanstack/react-query'
import { getIntegrationMarks } from '#/server/marks.functions.ts'

export const getIntegrationMarksQueryOpts = () => {
  return queryOptions({
    queryKey: ['integration-marks'],
    queryFn: () => {
      return getIntegrationMarks()
    },
    staleTime: Infinity
  })
}
