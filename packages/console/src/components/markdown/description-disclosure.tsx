import { ChevronDownIcon } from 'lucide-react'
import { ChatMarkdown } from './chat-markdown.tsx'

type DescriptionDisclosureProps = {
  text: string
  empty: string
}

export const DescriptionDisclosure = ({
  text,
  empty
}: DescriptionDisclosureProps) => {
  return (
    <details open className="disclosure">
      <summary>
        <ChevronDownIcon aria-hidden />
        Description
      </summary>
      {text === '' ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="max-w-measure">
          <ChatMarkdown text={text} />
        </div>
      )}
    </details>
  )
}
