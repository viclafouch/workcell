import { GitCompareIcon } from 'lucide-react'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle
} from '#/components/ui/code-block.tsx'

type DiffLineVariant = 'added' | 'removed' | 'highlighted' | 'default'

const variantOfLine = (line: string): DiffLineVariant => {
  if (line.startsWith('@@')) {
    return 'highlighted'
  }

  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'added'
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'removed'
  }

  return 'default'
}

const contentOfLine = (line: string, variant: DiffLineVariant) => {
  return variant === 'added' || variant === 'removed' ? line.slice(1) : line
}

type DiffCodeProps = {
  patch: string
  title: string
}

export const DiffCode = ({ patch, title }: DiffCodeProps) => {
  const allLines = patch.replace(/\n$/u, '').split('\n')
  const firstHunk = allLines.findIndex((line) => {
    return line.startsWith('@@')
  })
  const lines = allLines.slice(Math.max(firstHunk, 0)).map((text, position) => {
    const variant = variantOfLine(text)

    return { id: position, variant, content: contentOfLine(text, variant) }
  })

  return (
    <CodeBlock size="sm">
      <CodeBlockHeader>
        <CodeBlockTitle>
          <GitCompareIcon aria-hidden />
          {title}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={patch} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-code" aria-label={title}>
        {lines.map((line) => {
          return (
            <CodeBlockLine key={line.id} variant={line.variant}>
              {line.content}
            </CodeBlockLine>
          )
        })}
      </CodeBlockContent>
    </CodeBlock>
  )
}
