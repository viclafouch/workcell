import { cn } from 'cn'
import type { DashboardBrand } from '#/server/dashboard-context.ts'

type BrandLogoProps = {
  brand: DashboardBrand
  className?: string
}

export const BrandLogo = ({ brand, className }: BrandLogoProps) => {
  if (brand.logoUrl !== undefined) {
    return (
      <img
        src={brand.logoUrl}
        alt=""
        width={24}
        height={24}
        className={cn('size-6 shrink-0', className)}
      />
    )
  }

  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={cn('size-6 shrink-0 text-primary', className)}
    >
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect x="8" y="8" width="8" height="8" rx="2" fill="currentColor" />
    </svg>
  )
}

type BrandMarkProps = {
  brand: DashboardBrand
}

export const BrandMark = ({ brand }: BrandMarkProps) => {
  return (
    <>
      <BrandLogo brand={brand} />
      <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
        {brand.name}
      </span>
    </>
  )
}
