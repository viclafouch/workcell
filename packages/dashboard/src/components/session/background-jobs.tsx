import { TerminalIcon } from 'lucide-react'
import { CodeBlock, CodeBlockContent } from '#/components/ui/code-block.tsx'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '#/components/ui/trace.tsx'
import type { BackgroundJob } from '#/hooks/use-workspace-activity.ts'

const statusOfJob = ({ exitCode }: BackgroundJob) => {
  if (exitCode === undefined) {
    return 'running'
  }

  return exitCode === 0 ? undefined : 'error'
}

type BackgroundJobsProps = {
  jobs: readonly BackgroundJob[]
}

export const BackgroundJobs = ({ jobs }: BackgroundJobsProps) => {
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No job in the background.</p>
    )
  }

  return (
    <Trace>
      {jobs.map((job) => {
        return (
          <TraceCollapsible key={job.jobId} defaultOpen>
            <TraceCollapsibleTrigger>
              <TraceLine status={statusOfJob(job)}>
                <TraceIcon>
                  <TerminalIcon />
                </TraceIcon>
                <TraceTitle className="font-mono">
                  {job.exitCode === undefined ? 'Running' : 'Ran'} {job.command}
                </TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <CodeBlock size="sm">
                <CodeBlockContent wrap className="max-h-code">
                  {job.output === '' ? 'No output yet.' : job.output}
                </CodeBlockContent>
              </CodeBlock>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        )
      })}
    </Trace>
  )
}
