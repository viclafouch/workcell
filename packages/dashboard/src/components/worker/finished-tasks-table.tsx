import { Link } from '@tanstack/react-router'
import {
  createColumnHelper,
  tableFeatures,
  useTable
} from '@tanstack/react-table'
import type { WorkerView } from '@workcell/core'
import { StatusPill } from '#/components/status/status-pill.tsx'
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
        <Link
          to="/workers/$threadId"
          params={{ threadId: row.original.threadId }}
          className="font-semibold underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      )
    }
  }),
  helper.accessor('topic', { header: 'Task' }),
  helper.display({
    id: 'outcome',
    header: 'Outcome',
    cell: ({ row }) => {
      return <StatusPill status={statusOfWorker(row.original)} />
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
    <Card className="py-0">
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
                    <TableCell key={cell.id}>
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
