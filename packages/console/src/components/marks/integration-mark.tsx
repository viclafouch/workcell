import type { IntegrationMark as Mark } from '@workcell/core'

type IntegrationMarkProps = {
  mark: Mark
}

export const IntegrationMark = ({ mark }: IntegrationMarkProps) => {
  return (
    <>
      <span
        aria-hidden
        className="integration-mark"
        style={{
          maskImage: `url("${mark.iconUrl}")`,
          backgroundColor: mark.color
        }}
      />
      <span className="sr-only">{mark.name}</span>
    </>
  )
}
