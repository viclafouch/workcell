import { cn } from 'cn'
import type { ChatMark } from '#/server/console-context.ts'

type ChatMarkIconProps = {
  chatMark: Pick<ChatMark, 'name' | 'iconUrl'>
  className?: string
}

export const ChatMarkIcon = ({ chatMark, className }: ChatMarkIconProps) => {
  return (
    <img
      src={chatMark.iconUrl}
      alt=""
      title={chatMark.name}
      width={16}
      height={16}
      className={cn('size-4 shrink-0', className)}
    />
  )
}
