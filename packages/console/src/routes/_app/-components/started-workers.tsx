import { ChevronRightIcon, CpuIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { WorkerView } from '@workcell/core'
import { StatusPill } from '#/components/status/status-pill.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '#/components/ui/item.tsx'
import { statusOfWorker } from '#/constants/worker-status.ts'

type StartedWorkersProps = {
  workers: readonly WorkerView[]
}

export const StartedWorkers = ({ workers }: StartedWorkersProps) => {
  if (workers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This thread started no worker. The bot answered it on its own.
      </p>
    )
  }

  return (
    <ul
      aria-label="Workers this thread started"
      className="flex flex-col gap-2"
    >
      {workers.map((worker) => {
        return (
          <li key={worker.threadId}>
            <Item
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/workers/$threadId"
                  params={{ threadId: worker.threadId }}
                />
              }
            >
              <ItemMedia variant="icon">
                <CpuIcon aria-hidden />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle dir="auto">{worker.name}</ItemTitle>
                <ItemDescription dir="auto" className="line-clamp-2">
                  {worker.topic}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <StatusPill status={statusOfWorker(worker)} />
                <ChevronRightIcon aria-hidden className="size-4" />
              </ItemActions>
            </Item>
          </li>
        )
      })}
    </ul>
  )
}
