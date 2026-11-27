import { ChevronRightIcon } from 'lucide-react'
import { Link, useMatchRoute } from '@tanstack/react-router'
import type { WorkerView } from '@workcell/core'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '#/components/ui/collapsible.tsx'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '#/components/ui/sidebar.tsx'
import { StatusDot } from '#/components/worker/status-dot.tsx'
import { statusOfWorker } from '#/constants/worker-status.ts'
import { formatAgo } from '#/lib/dates.ts'

type WorkerMenuItemProps = {
  worker: WorkerView
  onNavigate: () => void
  showsLastActivity?: boolean
}

const WorkerMenuItem = ({
  worker,
  onNavigate,
  showsLastActivity = false
}: WorkerMenuItemProps) => {
  const matchRoute = useMatchRoute()
  const status = statusOfWorker(worker)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={`${worker.name}, ${status.label.toLowerCase()}: ${worker.topic}`}
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
            onClick={onNavigate}
          />
        }
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <StatusDot tone={status.tone} />
        </span>
        <span dir="auto" className="shrink-0 font-medium">
          {worker.name}
        </span>
        <span dir="auto" className="min-w-0 truncate text-muted-foreground">
          {worker.topic}
        </span>
        {showsLastActivity && worker.lastActiveAt !== undefined ? (
          <span className="ml-auto shrink-0 text-label text-muted-foreground tabular">
            {formatAgo(worker.lastActiveAt)}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

type SidebarWorkerGroupProps = {
  label: string
  workers: readonly WorkerView[] | undefined
  onNavigate: () => void
}

export const SidebarWorkerGroup = ({
  label,
  workers,
  onNavigate
}: SidebarWorkerGroupProps) => {
  if (workers === undefined || workers.length === 0) {
    return null
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {workers.map((worker) => {
          return (
            <WorkerMenuItem
              key={worker.threadId}
              worker={worker}
              onNavigate={onNavigate}
            />
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

type SidebarAsleepWorkersProps = SidebarWorkerGroupProps

export const SidebarAsleepWorkers = ({
  label,
  workers,
  onNavigate
}: SidebarAsleepWorkersProps) => {
  if (workers === undefined || workers.length === 0) {
    return null
  }

  return (
    <Collapsible
      render={<SidebarGroup />}
      className="group/asleep group-data-[collapsible=icon]:hidden"
    >
      <SidebarGroupLabel
        render={<CollapsibleTrigger />}
        className="w-full gap-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <ChevronRightIcon
          aria-hidden
          className="transition-transform duration-(--duration-fast) ease-(--ease-out-strong) group-data-[open]/asleep:rotate-90 motion-reduce:transition-none"
        />
        {label}
        <span className="ml-auto tabular">{workers.length}</span>
      </SidebarGroupLabel>
      <CollapsibleContent hiddenUntilFound>
        <SidebarMenu>
          {workers.map((worker) => {
            return (
              <WorkerMenuItem
                key={worker.threadId}
                worker={worker}
                onNavigate={onNavigate}
                showsLastActivity
              />
            )
          })}
        </SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  )
}
