import {
  ActivityIcon,
  ExternalLinkIcon,
  GitPullRequestIcon
} from 'lucide-react'
import type { WorkerView } from '@workcell/core'
import { Hint } from '#/components/status/hint.tsx'
import { StatusPill } from '#/components/status/status-pill.tsx'
import { SpendMeter } from '#/components/worker/spend-meter.tsx'
import { statusOfWorker } from '#/constants/worker-status.ts'

type WorkerHeaderProps = {
  worker: WorkerView & { traceUrl?: string }
}

export const WorkerHeader = ({ worker }: WorkerHeaderProps) => {
  const status = statusOfWorker(worker)

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="flex items-center gap-3">
          <span className="font-semibold">{worker.name}</span>
          <StatusPill status={status} />
        </p>
        <h1 className="max-w-measure text-2xl leading-tight font-semibold sm:text-3xl">
          {worker.topic}
        </h1>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Hint label="The repository it works in">
            <span>{worker.repository}</span>
          </Hint>
          {worker.branch === undefined ? null : (
            <Hint label="The branch it pushes to">
              <code>{worker.branch}</code>
            </Hint>
          )}
          {worker.pullRequest === undefined ? null : (
            <a
              href={worker.pullRequest}
              className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
            >
              <GitPullRequestIcon aria-hidden className="size-4" />
              Pull request
              <ExternalLinkIcon aria-hidden className="size-3" />
            </a>
          )}
          {worker.traceUrl === undefined ? null : (
            <a
              href={worker.traceUrl}
              className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
            >
              <ActivityIcon aria-hidden className="size-4" />
              Trace of its turns
              <ExternalLinkIcon aria-hidden className="size-3" />
            </a>
          )}
        </p>
        {worker.outcome?.cause === undefined ? null : (
          <p data-status={status.tone} className="max-w-measure text-status">
            {worker.outcome.cause}
          </p>
        )}
      </div>
      <SpendMeter spentUsd={worker.spentUsd} budgetUsd={worker.budgetUsd} />
    </div>
  )
}
