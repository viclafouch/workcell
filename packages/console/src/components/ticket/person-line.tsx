import { UserIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar.tsx'

type PersonLineProps = {
  name: string
  avatarUrl?: string
}

export const PersonLine = ({ name, avatarUrl }: PersonLineProps) => {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-label text-muted-foreground">
      <Avatar size="sm" className="size-5 shrink-0">
        {avatarUrl === undefined ? null : (
          <AvatarImage src={avatarUrl} alt="" loading="lazy" />
        )}
        <AvatarFallback>
          <UserIcon aria-hidden className="size-3" />
        </AvatarFallback>
      </Avatar>
      <span dir="auto" className="truncate">
        {name}
      </span>
    </span>
  )
}
