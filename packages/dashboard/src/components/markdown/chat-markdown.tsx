import { Markdown } from '@pierre/words/react'
import { MARKDOWN_PLUGINS } from '#/lib/code-highlighting.ts'

type ChatMarkdownProps = {
  text: string
  isStreaming?: boolean
}

export const ChatMarkdown = ({
  text,
  isStreaming = false
}: ChatMarkdownProps) => {
  return (
    <Markdown
      className="typeset typeset-chat"
      plugins={MARKDOWN_PLUGINS}
      isAnimating={isStreaming}
      animated
      caret={isStreaming ? 'block' : undefined}
    >
      {text}
    </Markdown>
  )
}
