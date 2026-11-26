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
  SidebarRail,
  useSidebar
} from '#/components/ui/sidebar.tsx'
import { StatusDot } from '#/components/worker/status-dot.tsx'
import {
  BOT_THREADS_IN_SIDEBAR,
  OVERVIEW_ITEMS,
  UPCOMING_ITEMS
} from '#/constants/navigation.ts'
import { statusOfWorker } from '#/constants/worker-status.ts'
import { listBotThreadsQueryOpts } from '#/queries/bot-threads.ts'
import { listFeedbackQueryOpts } from '#/queries/feedback.ts'
import { listWorkersQueryOpts } from '#/queries/workers.ts'
import type { DashboardBrand } from '#/server/dashboard-context.ts'
import { BrandMark } from './brand-mark.tsx'

const BADGE_MEANINGS = {
  '/': 'Workers on a task',
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
  const runningWorkers = (workersQuery.data ?? []).filter(({ phase }) => {
    return phase !== 'finished'
  })
  const badges = {
    '/': runningWorkers.length,
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
            <SidebarGroupLabel>Overview</SidebarGroupLabel>
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
                      <SidebarMenuBadge>
                        <span className="sr-only">{BADGE_MEANINGS[to]}: </span>
                        {badges[to]}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Workers</SidebarGroupLabel>
            <SidebarMenu>
              {runningWorkers.length === 0 ? (
                <SidebarMenuItem className="px-2 text-label text-muted-foreground group-data-[collapsible=icon]:hidden">
                  No worker runs.
                </SidebarMenuItem>
              ) : null}
              {runningWorkers.map((worker) => {
                const status = statusOfWorker(worker)

                return (
                  <SidebarMenuItem key={worker.threadId}>
                    <SidebarMenuButton
                      tooltip={`${worker.name}: ${status.label}. ${worker.repository}`}
                      isActive={Boolean(
                        matchRoute({
                          to: '/workers/$threadId',
                          params: { threadId: worker.threadId }
                        })
                      )}
                      render={
                        <Link
                          to="/workers/$threadId"
                          params={{ threadId: worker.threadId }}
                          onClick={closeOnPhone}
                        />
                      }
                    >
                      <span className="grid size-4 shrink-0 place-items-center">
                        <StatusDot tone={status.tone} />
                      </span>
                      <span className="truncate">{worker.name}</span>
                      <span className="ml-auto truncate text-label text-muted-foreground">
                        {worker.repository}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Bot threads</SidebarGroupLabel>
            <SidebarMenu>
              {(botThreadsQuery.data ?? [])
                .slice(0, BOT_THREADS_IN_SIDEBAR)
                .map((thread) => {
                  const title = thread.title ?? thread.threadId

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
                        <span className="truncate">{title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
            </SidebarMenu>
          </SidebarGroup>
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
      <SidebarRail />
    </Sidebar>
  )
}
