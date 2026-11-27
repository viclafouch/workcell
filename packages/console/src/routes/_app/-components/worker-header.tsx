import { ActivityIcon, BotIcon, ExternalLinkIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { WorkerView } from '@workcell/core'
import { Hint } from '#/components/status/hint.tsx'
import { StatusPill } from '#/components/status/status-pill.tsx'
import { SpendMeter } from '#/components/worker/spend-meter.tsx'
import { statusOfWorker } from '#/constants/worker-status.ts'
import { PullRequestChip, TicketChip, WorkerTitle } from './work-chips.tsx'

const LINK_CLASS =
  'inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline'

type WorkerHeaderProps = {
  worker: WorkerView & { traceUrl?: string }
}

export const WorkerHeader = ({ worker }: WorkerHeaderProps) => {
  const status = statusOfWorker(worker)
  const cause =
    worker.outcome?.cause ??
    (status.tone === 'failed' ? status.hint : undefined)

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-3">
          <span dir="auto" className="font-semibold">
            {worker.name}
          </span>
          <StatusPill status={status} />
        </p>
        <WorkerTitle worker={worker} />
        <p className="flex flex-wrap items-center gap-2 empty:hidden">
          <TicketChip worker={worker} />
          <PullRequestChip worker={worker} />
        </p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Hint label="The repository it works in">
            <span dir="auto" className="min-w-0 truncate">
              {worker.repository}
            </span>
          </Hint>
          {worker.branch === undefined ? null : (
            <Hint label={`The branch it pushes to: ${worker.branch}`}>
              <code className="max-w-64 truncate">{worker.branch}</code>
            </Hint>
          )}
          {worker.originThreadId === undefined ? null : (
            <Link
              to="/threads/$threadId"
              params={{ threadId: worker.originThreadId }}
              className={LINK_CLASS}
            >
              <BotIcon aria-hidden className="size-4" />
              Started in a bot thread
            </Link>
          )}
          {worker.traceUrl === undefined ? null : (
            <a href={worker.traceUrl} className={LINK_CLASS}>
              <ActivityIcon aria-hidden className="size-4" />
              Trace of its turns
              <ExternalLinkIcon aria-hidden className="size-3" />
            </a>
          )}
        </p>
        {cause === undefined ? null : (
          <p
            data-status={status.tone}
            className="line-clamp-3 max-w-measure text-sm text-status"
          >
            {cause}
          </p>
        )}
      </div>
      <SpendMeter spentUsd={worker.spentUsd} budgetUsd={worker.budgetUsd} />
    </div>
  )
}
