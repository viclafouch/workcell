import { FileCodeIcon } from 'lucide-react'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle
} from '#/components/ui/code-block.tsx'
import { useHighlightedCode } from '#/hooks/use-highlighted-code.ts'

type HighlightedCodeProps = {
  code: string
  language: string
  title?: string
  size?: 'default' | 'sm'
}

export const HighlightedCode = ({
  code,
  language,
  title,
  size = 'sm'
}: HighlightedCodeProps) => {
  const lines = useHighlightedCode(code, language)

  return (
    <CodeBlock size={size}>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <FileCodeIcon aria-hidden />
          {title ?? language}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-code">
        {lines.map((line, index) => {
          return (
            // oxlint-disable-next-line react/no-array-index-key -- a highlighted line has no identity but its position
            <CodeBlockLine key={index}>{line}</CodeBlockLine>
          )
        })}
      </CodeBlockContent>
    </CodeBlock>
  )
}
