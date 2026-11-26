import React from 'react'
import { streamingMarkdownExtension } from '@tanstack/markdown/extensions/streaming'
import {
  Markdown,
  type MarkdownComponentProps,
  type MarkdownComponents
} from '@tanstack/markdown/react'
import { HighlightedCode } from '#/components/session/highlighted-code.tsx'

const STREAMING_EXTENSIONS = [streamingMarkdownExtension()]

const LANGUAGE_CLASS = /language-(?<language>[\w-]+)/u

const matchIsCodeElement = (
  node: React.ReactNode
): node is React.ReactElement<{
  className?: string
  children?: React.ReactNode
}> => {
  return React.isValidElement(node)
}

type FencedCodeProps = MarkdownComponentProps<'pre'>

const FencedCode = ({ children }: FencedCodeProps) => {
  if (!matchIsCodeElement(children)) {
    return <pre>{children}</pre>
  }

  const language =
    LANGUAGE_CLASS.exec(children.props.className ?? '')?.groups?.language ??
    'text'
  const code =
    typeof children.props.children === 'string' ? children.props.children : ''

  return <HighlightedCode code={code} language={language} />
}

const COMPONENTS = { pre: FencedCode } satisfies MarkdownComponents

type AgentMarkdownProps = {
  text: string
}

export const AgentMarkdown = ({ text }: AgentMarkdownProps) => {
  return (
    <div className="typeset typeset-chat">
      <Markdown
        extensions={STREAMING_EXTENSIONS}
        frontmatter={false}
        headingIds={false}
        components={COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  )
}
