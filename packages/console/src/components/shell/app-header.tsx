import { ColorSchemeToggle } from '#/components/theme/color-scheme-toggle.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { SidebarTrigger } from '#/components/ui/sidebar.tsx'
import { AppBreadcrumbs } from './app-breadcrumbs.tsx'
import { HostConnection } from './host-connection.tsx'

export const AppHeader = () => {
  return (
    <header className="sticky top-0 z-sticky flex h-topbar shrink-0 items-center gap-3 border-b bg-background/90 px-3 backdrop-blur-sm supports-[not(backdrop-filter:blur(1px))]:bg-background sm:px-4">
      <SidebarTrigger />
      <Separator
        orientation="vertical"
        className="data-vertical:h-4 data-vertical:self-center"
      />
      <AppBreadcrumbs />
      <div className="ml-auto flex items-center gap-3">
        <HostConnection />
        <ColorSchemeToggle />
      </div>
    </header>
  )
}
