import pierreDark from '@pierre/highlights/themes/pierre-dark'
import pierreLight from '@pierre/highlights/themes/pierre-light'
import { createHighlightsPlugin } from '@pierre/words/highlights'

export const CODE_THEMES = { light: pierreLight, dark: pierreDark }

export const MARKDOWN_PLUGINS = {
  code: createHighlightsPlugin({
    themes: CODE_THEMES,
    defaultColor: 'light-dark()'
  })
}
