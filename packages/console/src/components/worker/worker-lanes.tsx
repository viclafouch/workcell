import { ExternalLinkIcon, GitPullRequestIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { WorkerView } from '@workcell/core'
import { Hint } from '#/components/status/hint.tsx'
import { StatusPill } from '#/components/status/status-pill.tsx'
import { Card } from '#/components/ui/card.tsx'
import { stageOfWorker, statusOfWorker } from '#/constants/worker-status.ts'
import { LifecycleRail } from './lifecycle-rail.tsx'
import { SpendMeter } from './spend-meter.tsx'

const COLUMNS = ['Worker', 'Task', 'Stage', 'Spend'] as const

type WorkerRowProps = {
  worker: WorkerView
}

const WorkerRow = ({ worker }: WorkerRowProps) => {
  const status = statusOfWorker(worker)

  return (
    <li
      data-status={status.tone}
      className="items-start gap-x-6 gap-y-3 border-t px-4 py-4 max-md:first:border-t-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 md:flex-col md:items-start">
        <Link
          to="/workers/$threadId"
          params={{ threadId: worker.threadId }}
          className="font-semibold underline-offset-4 hover:underline"
        >
          {worker.name}
        </Link>
        <StatusPill status={status} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Link
          to="/workers/$threadId"
          params={{ threadId: worker.threadId }}
          className="max-w-measure text-pretty underline-offset-4 hover:underline"
        >
          {worker.topic}
        </Link>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground">
          <Hint label="The repository it works in">
            <span>{worker.repository}</span>
          </Hint>
          {worker.branch === undefined ? null : (
            <Hint label="The branch it pushes to">
              <code className="truncate text-label">{worker.branch}</code>
            </Hint>
          )}
          {worker.pullRequest === undefined ? null : (
            <a
              href={worker.pullRequest}
              className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
            >
              <GitPullRequestIcon aria-hidden className="size-3.5" />
              Pull request
              <ExternalLinkIcon aria-hidden className="size-3" />
            </a>
          )}
        </p>
        {worker.command === undefined ? null : (
          <Hint label={worker.command}>
            <code className="block w-fit max-w-full truncate rounded-sm bg-muted px-2 py-1 text-label">
              <span className="sr-only">Runs </span>
              <span aria-hidden className="text-muted-foreground select-none">
                ${' '}
              </span>
              {worker.command}
            </code>
          </Hint>
        )}
      </div>
      <LifecycleRail stage={stageOfWorker(worker)} tone={status.tone} />
      <SpendMeter spentUsd={worker.spentUsd} budgetUsd={worker.budgetUsd} />
    </li>
  )
}

type WorkerLanesProps = {
  workers: readonly WorkerView[]
  label: string
}

export const WorkerLanes = ({ workers, label }: WorkerLanesProps) => {
  return (
    <Card className="gap-0 py-0">
      <div className="worker-grid">
        <div
          aria-hidden
          className="gap-x-6 px-4 py-2.5 text-label text-muted-foreground max-md:hidden"
        >
          {COLUMNS.map((column) => {
            return <span key={column}>{column}</span>
          })}
        </div>
        <ul aria-label={label} className="worker-grid">
          {workers.map((worker) => {
            return <WorkerRow key={worker.threadId} worker={worker} />
          })}
        </ul>
      </div>
    </Card>
  )
}
