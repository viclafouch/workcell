import { ChatMarkdown } from '#/components/markdown/chat-markdown.tsx'

const BACKTICK_RUN = /`+/gu

const SHORTEST_FENCE = 3

const fenceAround = (code: string) => {
  const longestRun = Math.max(
    0,
    ...Array.from(code.matchAll(BACKTICK_RUN), ([run]) => {
      return run.length
    })
  )

  return '`'.repeat(Math.max(SHORTEST_FENCE, longestRun + 1))
}

type HighlightedCodeProps = {
  code: string
  language: string
}

export const HighlightedCode = ({ code, language }: HighlightedCodeProps) => {
  const fence = fenceAround(code)

  return <ChatMarkdown text={`${fence}${language}\n${code}\n${fence}`} />
}
