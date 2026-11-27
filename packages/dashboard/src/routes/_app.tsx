import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppHeader } from '#/components/shell/app-header.tsx'
import { AppShellSkeleton } from '#/components/shell/app-shell-skeleton.tsx'
import { AppSidebar } from '#/components/shell/app-sidebar.tsx'
import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar.tsx'
import { TooltipProvider } from '#/components/ui/tooltip.tsx'
import { DEFAULT_BRAND_NAME, pageTitleOf } from '#/constants/brand.ts'
import { useHostStatus } from '#/hooks/use-host-status.ts'
import { readIsSidebarOpen } from '#/lib/sidebar-state.ts'
import { getBrandQueryOpts } from '#/queries/brand.ts'
import { getChatMarksQueryOpts } from '#/queries/chat.ts'

const TOOLTIP_DELAY_MS = 400

const AppLayout = () => {
  const brand = Route.useLoaderData()
  useHostStatus('worker')
  useHostStatus('bot')

  return (
    <TooltipProvider delay={TOOLTIP_DELAY_MS}>
      <SidebarProvider defaultOpen={readIsSidebarOpen()}>
        <AppSidebar brand={brand} />
        <SidebarInset id="main-content" className="min-w-0">
          <AppHeader />
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

export const Route = createFileRoute('/_app')({
  loader: async ({ context }) => {
    const [brand] = await Promise.all([
      context.queryClient.query(getBrandQueryOpts()),
      context.queryClient.query(getChatMarksQueryOpts())
    ])

    return brand
  },
  head: ({ loaderData }) => {
    return {
      meta: [
        {
          title: pageTitleOf(loaderData?.name ?? DEFAULT_BRAND_NAME)
        }
      ]
    }
  },
  pendingComponent: AppShellSkeleton,
  component: AppLayout
})
