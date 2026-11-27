import { z } from 'zod'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { DefaultPending } from '#/components/app/default-pending.tsx'
import { NotFound } from '#/components/app/not-found.tsx'
import { RouteError } from '#/components/app/route-error.tsx'
import { routeTree } from './routeTree.gen.ts'

const QUERY_STALE_TIME_MS = 30_000

z.config({ jitless: true })

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        refetchOnWindowFocus: false
      }
    }
  })

  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: DefaultPending,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    scrollRestoration: true,
    Wrap: ({ children }) => {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }
  })
}

declare module '@tanstack/react-router' {
  // oxlint-disable-next-line consistent-type-definitions -- a module augmentation needs an interface
  interface Register {
    router: ReturnType<typeof getRouter>
  }

  // oxlint-disable-next-line consistent-type-definitions -- a module augmentation needs an interface
  interface StaticDataRouteOption {
    section?: string
    crumb?: string
  }
}
