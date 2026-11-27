import { cn } from 'cn'

const DEFAULT_TAIL = 24

type MiddleTruncateProps = {
  text: string
  tail?: number
  className?: string
}

export const MiddleTruncate = ({
  text,
  tail = DEFAULT_TAIL,
  className
}: MiddleTruncateProps) => {
  const cut = Math.max(text.length - tail, 0)

  return (
    <span title={text} className={cn('flex min-w-0', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="truncate">
        {text.slice(0, cut)}
      </span>
      <span aria-hidden className="shrink-0 whitespace-pre">
        {text.slice(cut)}
      </span>
    </span>
  )
}
