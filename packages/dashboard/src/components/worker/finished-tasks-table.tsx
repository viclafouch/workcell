import { Link } from '@tanstack/react-router'
import {
  createColumnHelper,
  tableFeatures,
  useTable
} from '@tanstack/react-table'
import type { WorkerView } from '@workcell/core'
import { StatusPill } from '#/components/status/status-pill.tsx'
import { TimeAgo } from '#/components/time/time-ago.tsx'
import { Card } from '#/components/ui/card.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '#/components/ui/table.tsx'
import { statusOfWorker } from '#/constants/worker-status.ts'
import { formatUsd } from '#/lib/money.ts'

const features = tableFeatures({})

const helper = createColumnHelper<typeof features, WorkerView>()

const columns = helper.columns([
  helper.accessor('name', {
    header: 'Worker',
    cell: ({ row }) => {
      return (
        <span dir="auto" className="font-semibold">
          {row.original.name}
        </span>
      )
    }
  }),
  helper.accessor('topic', {
    header: 'Task',
    cell: ({ row }) => {
      return (
        <Link
          to="/workers/$threadId"
          params={{ threadId: row.original.threadId }}
          dir="auto"
          className="line-clamp-2 underline-offset-4 hover:underline"
        >
          {row.original.topic}
        </Link>
      )
    }
  }),
  helper.display({
    id: 'outcome',
    header: 'Outcome',
    cell: ({ row }) => {
      const { outcome } = row.original

      return (
        <span className="flex flex-col items-start gap-1">
          <StatusPill status={statusOfWorker(row.original)} />
          {outcome?.cause === undefined ? null : (
            <span className="line-clamp-2 text-label text-muted-foreground">
              {outcome.cause}
            </span>
          )}
        </span>
      )
    }
  }),
  helper.display({
    id: 'ended',
    header: 'Ended',
    cell: ({ row }) => {
      const changedAt = row.original.outcome?.changedAt

      return changedAt === undefined ? null : (
        <TimeAgo value={changedAt} className="whitespace-nowrap" />
      )
    }
  }),
  helper.accessor('spentUsd', {
    header: 'Spent',
    cell: ({ getValue }) => {
      return <span className="tabular">{formatUsd(getValue())}</span>
    }
  })
])

type FinishedTasksTableProps = {
  workers: WorkerView[]
}

export const FinishedTasksTable = ({ workers }: FinishedTasksTableProps) => {
  const table = useTable({ features, columns, data: workers })

  return (
    <Card className="stacked-table py-0">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => {
            return (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            )
          })}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => {
            return (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => {
                  return (
                    <TableCell
                      key={cell.id}
                      data-label={String(cell.column.columnDef.header)}
                      className="align-top whitespace-normal"
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  )
                })}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
