import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { useColorScheme } from '#/hooks/use-color-scheme.ts'

export const ColorSchemeToggle = () => {
  const { scheme, toggle } = useColorScheme()
  const target = scheme === 'dark' ? 'light' : 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to the ${target} theme`}
    >
      {scheme === 'dark' ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
    </Button>
  )
}
