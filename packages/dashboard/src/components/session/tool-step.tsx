import {
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  ListTodoIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon
} from 'lucide-react'
import type { ToolCallPart } from '@tanstack/ai-harness/view'
import { CodeBlock, CodeBlockContent } from '#/components/ui/code-block.tsx'
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '#/components/ui/trace.tsx'
import { HighlightedCode } from './highlighted-code.tsx'

type ToolKind = {
  icon: LucideIcon
  verbs: { done: string; running: string }
  subjectKey?: string
}

const TOOL_KINDS = {
  bash: {
    icon: TerminalIcon,
    verbs: { done: 'Ran', running: 'Running' },
    subjectKey: 'command'
  },
  read_file: {
    icon: FileTextIcon,
    verbs: { done: 'Read', running: 'Reading' },
    subjectKey: 'path'
  },
  write_file: {
    icon: FilePenIcon,
    verbs: { done: 'Wrote', running: 'Writing' },
    subjectKey: 'path'
  },
  edit_file: {
    icon: FilePenIcon,
    verbs: { done: 'Edited', running: 'Editing' },
    subjectKey: 'path'
  },
  grep: {
    icon: SearchIcon,
    verbs: { done: 'Searched for', running: 'Searching for' },
    subjectKey: 'pattern'
  },
  webfetch: {
    icon: GlobeIcon,
    verbs: { done: 'Read', running: 'Reading' },
    subjectKey: 'url'
  },
  todo_write: {
    icon: ListTodoIcon,
    verbs: { done: 'Updated the plan', running: 'Updating the plan' }
  }
} as const satisfies Record<string, ToolKind>

const GENERIC_TOOL: ToolKind = {
  icon: WrenchIcon,
  verbs: { done: 'Called', running: 'Calling' }
}

const matchIsKnownTool = (name: string): name is keyof typeof TOOL_KINDS => {
  return Object.hasOwn(TOOL_KINDS, name)
}

const kindOfTool = (name: string): ToolKind => {
  return matchIsKnownTool(name) ? TOOL_KINDS[name] : GENERIC_TOOL
}

const subjectOf = (part: ToolCallPart, kind: ToolKind) => {
  if (kind.subjectKey === undefined) {
    return kind === GENERIC_TOOL ? part.name : ''
  }

  const value: unknown =
    typeof part.args === 'object' && part.args !== null
      ? Reflect.get(part.args, kind.subjectKey)
      : null

  return typeof value === 'string' ? value : part.name
}

const verbOf = (part: ToolCallPart, kind: ToolKind) => {
  return {
    running: kind.verbs.running,
    done: kind.verbs.done,
    failed: `Failed: ${kind.verbs.done.toLowerCase()}`,
    'needs-approval': `Waits for approval: ${kind.verbs.running.toLowerCase()}`
  }[part.status]
}

const TRACE_STATUS = {
  running: 'running',
  done: undefined,
  failed: 'error',
  'needs-approval': 'pending'
} as const satisfies Record<ToolCallPart['status'], string | undefined>

const textOfResult = (result: unknown) => {
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
}

type ToolStepProps = {
  part: ToolCallPart
}

export const ToolStep = ({ part }: ToolStepProps) => {
  const kind = kindOfTool(part.name)
  const { icon: Icon } = kind
  const subject = subjectOf(part, kind)
  const line = (
    <TraceLine status={TRACE_STATUS[part.status]}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle>
        {verbOf(part, kind)}
        {subject === '' ? null : (
          <>
            {' '}
            <code className="font-mono">{subject}</code>
          </>
        )}
      </TraceTitle>
      {kind === GENERIC_TOOL ? null : (
        <TraceDescription className="font-mono">{part.name}</TraceDescription>
      )}
    </TraceLine>
  )

  if (part.status === 'running' || part.status === 'needs-approval') {
    return line
  }

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        {kind.subjectKey === 'command' ? null : (
          <HighlightedCode
            code={
              part.args === undefined
                ? part.argsText
                : JSON.stringify(part.args, null, 2)
            }
            language="json"
            title="Input"
          />
        )}
        {part.result === undefined ? null : (
          <CodeBlock
            size="sm"
            variant={part.status === 'failed' ? 'destructive' : 'default'}
          >
            <CodeBlockContent wrap className="max-h-code">
              {textOfResult(part.result)}
            </CodeBlockContent>
          </CodeBlock>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
