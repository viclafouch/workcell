import type React from 'react'

type PanelSectionProps = {
  title: string
  children: React.ReactNode
}

export const PanelSection = ({ title, children }: PanelSectionProps) => {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}
