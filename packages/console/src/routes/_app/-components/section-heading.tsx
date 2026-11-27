import type React from 'react'

type SectionHeadingProps = {
  id: string
  children: React.ReactNode
}

export const SectionHeading = ({ id, children }: SectionHeadingProps) => {
  return (
    <h2 id={id} className="text-lg font-semibold">
      {children}
    </h2>
  )
}
