import { BotIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Link, useMatchRoute } from '@tanstack/react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '#/components/ui/sidebar.tsx'
import {
  BOT_THREADS_IN_SIDEBAR,
  OVERVIEW_ITEMS,
  UPCOMING_ITEMS
} from '#/constants/navigation.ts'
import { groupWorkers } from '#/constants/worker-status.ts'
import { formatAgo } from '#/lib/dates.ts'
import {
  listBotThreadsQueryOpts,
  titleOfThread
} from '#/queries/bot-threads.ts'
import { listFeedbackQueryOpts } from '#/queries/feedback.ts'
import { listWorkersQueryOpts } from '#/queries/workers.ts'
import type { DashboardBrand } from '#/server/dashboard-context.ts'
import { BrandMark } from './brand-mark.tsx'
import { SidebarResizer } from './sidebar-resizer.tsx'
import { SidebarAsleepWorkers, SidebarWorkerGroup } from './sidebar-workers.tsx'

const BADGE_MEANINGS = {
  '/': 'Workers that work or wait for you',
  '/feedback': 'Reports'
} as const

type AppSidebarProps = {
  brand: DashboardBrand
}

export const AppSidebar = ({ brand }: AppSidebarProps) => {
  const matchRoute = useMatchRoute()
  const { setOpenMobile } = useSidebar()
  const workersQuery = useQuery(listWorkersQueryOpts())
  const feedbackQuery = useQuery(listFeedbackQueryOpts())
  const botThreadsQuery = useQuery(listBotThreadsQueryOpts())
  const groups = groupWorkers(workersQuery.data ?? [])
  const badges = {
    '/': (groups.needsYou?.length ?? 0) + (groups.working?.length ?? 0),
    '/feedback': feedbackQuery.data?.length ?? 0
  }
  const closeOnPhone = () => {
    setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={brand.name}
              render={
                <Link to="/" aria-label={brand.name} onClick={closeOnPhone} />
              }
            >
              <BrandMark brand={brand} />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Sections" className="contents">
          <SidebarGroup>
            <SidebarMenu>
              {OVERVIEW_ITEMS.map(({ to, label, icon: Icon }) => {
                return (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      tooltip={
                        badges[to] === 0
                          ? label
                          : `${label}: ${badges[to]} ${BADGE_MEANINGS[to].toLowerCase()}`
                      }
                      isActive={Boolean(matchRoute({ to }))}
                      render={<Link to={to} onClick={closeOnPhone} />}
                    >
                      <Icon aria-hidden />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {badges[to] === 0 ? null : (
                      <SidebarMenuBadge className="tabular">
                        <span className="sr-only">{BADGE_MEANINGS[to]}: </span>
                        {badges[to]}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarWorkerGroup
            label="Needs you"
            workers={groups.needsYou}
            onNavigate={closeOnPhone}
          />
          <SidebarWorkerGroup
            label="Working"
            workers={groups.working}
            onNavigate={closeOnPhone}
          />
          {botThreadsQuery.data === undefined ||
          botThreadsQuery.data.length === 0 ? null : (
            <SidebarGroup>
              <SidebarGroupLabel>Bot threads</SidebarGroupLabel>
              <SidebarMenu>
                {botThreadsQuery.data
                  .slice(0, BOT_THREADS_IN_SIDEBAR)
                  .map((thread) => {
                    const title = titleOfThread(thread)

                    return (
                      <SidebarMenuItem key={thread.threadId}>
                        <SidebarMenuButton
                          tooltip={title}
                          isActive={Boolean(
                            matchRoute({
                              to: '/threads/$threadId',
                              params: { threadId: thread.threadId }
                            })
                          )}
                          render={
                            <Link
                              to="/threads/$threadId"
                              params={{ threadId: thread.threadId }}
                              onClick={closeOnPhone}
                            />
                          }
                        >
                          <BotIcon aria-hidden />
                          <span dir="auto" className="min-w-0 truncate">
                            {title}
                          </span>
                          <span className="ml-auto shrink-0 text-label text-muted-foreground tabular">
                            {formatAgo(thread.updatedAt)}
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
              </SidebarMenu>
            </SidebarGroup>
          )}
          <SidebarAsleepWorkers
            label="Asleep"
            workers={groups.asleep}
            onNavigate={closeOnPhone}
          />
          <SidebarGroup className="mt-auto">
            <SidebarGroupLabel>Coming</SidebarGroupLabel>
            <SidebarMenu>
              {UPCOMING_ITEMS.map(({ label, icon: Icon }) => {
                return (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      render={<span />}
                      className="text-muted-foreground hover:bg-transparent hover:text-muted-foreground"
                    >
                      <Icon aria-hidden />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge className="text-muted-foreground">
                      Soon
                    </SidebarMenuBadge>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="px-4 pb-3 text-label text-muted-foreground group-data-[collapsible=icon]:hidden">
        Read only. Steer the workers from the chat.
      </SidebarFooter>
      <SidebarResizer />
    </Sidebar>
  )
}
