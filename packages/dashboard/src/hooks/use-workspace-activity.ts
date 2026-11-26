import React from 'react'
import type { SessionView } from '@tanstack/ai-harness/view'
import type { WorkerSandboxSetupEvent } from '@workcell/core'
import {
  FileChanged,
  JobEnded,
  JobOutput,
  JobStarted,
  WorkerSandboxSetup,
  type FileChange
} from '#/lib/workspace-events.ts'

export type BackgroundJob = {
  jobId: string
  command: string
  output: string
  exitCode?: number
}

const KEPT_JOB_OUTPUT_CHARACTERS = 20_000

const updateJob = (
  jobs: readonly BackgroundJob[],
  jobId: string,
  update: (job: BackgroundJob) => BackgroundJob
) => {
  return jobs.map((job) => {
    return job.jobId === jobId ? update(job) : job
  })
}

export const useWorkspaceActivity = (view: SessionView) => {
  const [fileChanges, setFileChanges] = React.useState<FileChange[]>([])
  const [jobs, setJobs] = React.useState<BackgroundJob[]>([])
  const [setupEvents, setSetupEvents] = React.useState<
    WorkerSandboxSetupEvent[]
  >([])

  React.useEffect(() => {
    const stops = [
      view.on(FileChanged, (change) => {
        setFileChanges((current) => {
          return [
            change,
            ...current.filter(({ path }) => {
              return path !== change.path
            })
          ]
        })
      }),
      view.on(JobStarted, ({ jobId, command }) => {
        setJobs((current) => {
          return [...current, { jobId, command, output: '' }]
        })
      }),
      view.on(JobOutput, ({ jobId, output }) => {
        setJobs((current) => {
          return updateJob(current, jobId, (job) => {
            return {
              ...job,
              output: `${job.output}${output}`.slice(
                -KEPT_JOB_OUTPUT_CHARACTERS
              )
            }
          })
        })
      }),
      view.on(JobEnded, ({ jobId, exitCode }) => {
        setJobs((current) => {
          return updateJob(current, jobId, (job) => {
            return { ...job, exitCode }
          })
        })
      }),
      view.on(WorkerSandboxSetup, (event) => {
        setSetupEvents((current) => {
          return [...current, event]
        })
      })
    ]

    return () => {
      for (const stop of stops) {
        stop()
      }
    }
  }, [view])

  return { fileChanges, jobs, setupEvents }
}
