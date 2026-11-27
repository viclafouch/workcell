import { CpuIcon, UserIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { BrandLogo } from '#/components/shell/brand-mark.tsx'
import type { SpeakerFallback } from '#/hooks/use-chat-speakers.ts'
import { getBrandQueryOpts } from '#/queries/brand.ts'

type FallbackIconProps = {
  fallback: SpeakerFallback
}

const FallbackIcon = ({ fallback }: FallbackIconProps) => {
  const brandQuery = useQuery(getBrandQueryOpts())

  if (fallback === 'brand' && brandQuery.data !== undefined) {
    return <BrandLogo brand={brandQuery.data} />
  }

  return fallback === 'worker' ? (
    <CpuIcon aria-hidden />
  ) : (
    <UserIcon aria-hidden />
  )
}

type SpeakerAvatarProps = {
  fallback: SpeakerFallback
  avatarUrl?: string
}

export const SpeakerAvatar = ({ fallback, avatarUrl }: SpeakerAvatarProps) => {
  if (avatarUrl === undefined) {
    return (
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&>img]:size-5 [&>svg]:size-4"
      >
        <FallbackIcon fallback={fallback} />
      </span>
    )
  }

  return (
    <img
      src={avatarUrl}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      className="size-8 shrink-0 rounded-md bg-muted object-cover"
    />
  )
}
