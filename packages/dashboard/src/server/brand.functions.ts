import { createServerFn } from '@tanstack/react-start'

export const getBrand = createServerFn({ method: 'GET' }).handler(
  ({ context }) => {
    return context.brand
  }
)
