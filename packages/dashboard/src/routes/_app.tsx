import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppHeader } from '#/components/shell/app-header.tsx'
import { AppShellSkeleton } from '#/components/shell/app-shell-skeleton.tsx'
import { AppSidebar } from '#/components/shell/app-sidebar.tsx'
import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar.tsx'
import { TooltipProvider } from '#/components/ui/tooltip.tsx'
import { useHostStatus } from '#/hooks/use-host-status.ts'
import { readIsSidebarOpen } from '#/lib/sidebar-state.ts'
import { getBrandQueryOpts } from '#/queries/brand.ts'

const TOOLTIP_DELAY_MS = 400

const AppLayout = () => {
  const brand = Route.useLoaderData()
  useHostStatus('worker')

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
  loader: ({ context }) => {
    return context.queryClient.query(getBrandQueryOpts())
  },
  head: ({ loaderData }) => {
    return {
      meta: [
        {
          title:
            loaderData === undefined
              ? 'What runs now'
              : `${loaderData.name}: what runs now`
        }
      ],
      links:
        loaderData?.stylesheetUrl === undefined
          ? []
          : [{ rel: 'stylesheet', href: loaderData.stylesheetUrl }]
    }
  },
  pendingComponent: AppShellSkeleton,
  component: AppLayout
})
