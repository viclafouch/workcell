import { cn } from 'cn'

const lastSlashOf = (path: string) => {
  return path.lastIndexOf('/', path.length - 2)
}

type PathLabelProps = {
  path: string
  className?: string
}

export const PathLabel = ({ path, className }: PathLabelProps) => {
  const slash = lastSlashOf(path)

  if (slash < 0) {
    return <span className={cn('truncate', className)}>{path}</span>
  }

  return (
    <span className={cn('min-w-0', className)}>
      <span className="sr-only">{path}</span>
      <span aria-hidden className="flex min-w-0 whitespace-nowrap">
        <span className="min-w-0 truncate">{path.slice(0, slash + 1)}</span>
        {path.slice(slash + 1)}
      </span>
    </span>
  )
}
