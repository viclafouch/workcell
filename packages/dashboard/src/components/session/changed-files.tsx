import React from 'react'
import { FileDiffIcon, FileMinusIcon, FilePlusIcon } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import type { FileChange } from '#/lib/workspace-events.ts'
import { DiffCode } from './diff-code.tsx'
import { PathLabel } from './path-label.tsx'

const CHANGE_ICONS = {
  created: FilePlusIcon,
  updated: FileDiffIcon,
  deleted: FileMinusIcon,
  moved: FileDiffIcon
} as const satisfies Record<FileChange['change'], unknown>

type ChangedFilesProps = {
  changes: readonly FileChange[]
}

export const ChangedFiles = ({ changes }: ChangedFilesProps) => {
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const selected =
    changes.find(({ path }) => {
      return path === selectedPath
    }) ?? changes[0]

  if (selected === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        Files show here as the worker changes them.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Changed files" className="flex flex-col">
        {changes.map((change) => {
          const Icon = CHANGE_ICONS[change.change]

          return (
            <li key={change.path}>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={change.path === selected.path}
                className="w-full justify-start aria-pressed:bg-muted"
                onClick={() => {
                  setSelectedPath(change.path)
                }}
              >
                <Icon aria-hidden />
                <PathLabel path={change.path} className="font-mono" />
                <span className="ml-auto tabular text-label">
                  <span className="text-status-success">
                    +{change.additions}
                  </span>{' '}
                  <span className="text-destructive">-{change.deletions}</span>
                </span>
              </Button>
            </li>
          )
        })}
      </ul>
      {selected.patch === undefined ? (
        <p className="text-sm text-muted-foreground">
          This change has no readable diff: a binary file, a large file or a
          secret file.
        </p>
      ) : (
        <DiffCode patch={selected.patch} path={selected.path} />
      )}
    </div>
  )
}
