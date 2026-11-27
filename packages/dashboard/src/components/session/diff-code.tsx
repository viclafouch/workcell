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
import { PathLabel } from './path-label.tsx'

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
  path: string
  className?: string
}

export const DiffCode = ({ patch, path, className }: DiffCodeProps) => {
  const allLines = patch.replace(/\n$/u, '').split('\n')
  const firstHunk = allLines.findIndex((line) => {
    return line.startsWith('@@')
  })
  const lines = allLines.slice(Math.max(firstHunk, 0)).map((text, position) => {
    const variant = variantOfLine(text)

    return { id: position, variant, content: contentOfLine(text, variant) }
  })

  return (
    <CodeBlock size="sm" className={className}>
      <CodeBlockHeader>
        <CodeBlockTitle className="min-w-0">
          <GitCompareIcon aria-hidden className="shrink-0" />
          <PathLabel path={path} className="font-mono" />
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={patch} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        className="max-h-code"
        aria-label={`Changes to ${path}`}
      >
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
