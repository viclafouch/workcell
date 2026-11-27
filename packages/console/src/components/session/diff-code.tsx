import type { FileDiffOptions } from '@pierre/diffs'
import { PatchDiff } from '@pierre/diffs/react'
import { useColorScheme } from '#/hooks/use-color-scheme.ts'
import type { ColorScheme } from '#/lib/color-scheme.ts'

const THEME_SURFACES = `:host {
  --diffs-light-bg: var(--card);
  --diffs-dark-bg: var(--card);
}`

const optionsFor = (themeType: ColorScheme) => {
  return {
    theme: { light: 'pierre-light', dark: 'pierre-dark' },
    themeType,
    preferredHighlighter: 'highlights',
    diffStyle: 'unified',
    hunkSeparators: 'line-info-basic',
    overflow: 'wrap',
    unsafeCSS: THEME_SURFACES
  } as const satisfies FileDiffOptions<undefined, undefined>
}

const DIFF_OPTIONS = {
  light: optionsFor('light'),
  dark: optionsFor('dark')
} as const satisfies Record<ColorScheme, FileDiffOptions<undefined, undefined>>

type DiffCodeProps = {
  patch: string
  path: string
  className?: string
}

export const DiffCode = ({ patch, path, className }: DiffCodeProps) => {
  const { scheme } = useColorScheme()

  return (
    <section aria-label={`Changes to ${path}`} className={className}>
      <PatchDiff patch={patch} options={DIFF_OPTIONS[scheme]} />
    </section>
  )
}
