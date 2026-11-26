import { queryOptions } from '@tanstack/react-query'
import { getBrand } from '#/server/brand.functions.ts'

export const getBrandQueryOpts = () => {
  return queryOptions({
    queryKey: ['brand'],
    queryFn: () => {
      return getBrand()
    },
    staleTime: Infinity
  })
}
