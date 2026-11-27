import { createHarnessClient } from '@tanstack/ai-harness/client'
import type { SessionViewSource } from '@tanstack/ai-harness/view'
import type { HarnessName } from '#/server/dashboard-context.ts'

const HARNESS_ROUTE = '/api/harness'

const HOST_LEVEL_THREAD = ''

const READ_ONLY_REFUSAL =
  'The dashboard reads only: steer the worker from the chat or over MCP.'

const EMPTY_DESCRIPTION = { commands: [], config: [], tools: [] }

const refuse = () => {
  return Promise.reject(new Error(READ_ONLY_REFUSAL))
}

export const harnessUrl = (harness: HarnessName) => {
  return `${HARNESS_ROUTE}/${harness}`
}

type HostClientParams = {
  onOpen?: () => void
}

export const createHostClient = (
  harness: HarnessName,
  { onOpen }: HostClientParams = {}
) => {
  return createHarnessClient({
    url: harnessUrl(harness),
    threadId: HOST_LEVEL_THREAD,
    fetch: async (input, init) => {
      const response = await fetch(input, init)

      if (response.ok) {
        onOpen?.()
      }

      return response
    }
  })
}

type ReadOnlySourceParams = {
  harness: HarnessName
  threadId: string
}

export const createReadOnlySource = ({
  harness,
  threadId
}: ReadOnlySourceParams): SessionViewSource => {
  const client = createHarnessClient({ url: harnessUrl(harness), threadId })

  return {
    events: (options) => {
      return client.events(options)
    },
    snapshot: () => {
      return client.snapshot()
    },
    transcript: () => {
      return client.transcript()
    },
    describe: () => {
      return EMPTY_DESCRIPTION
    },
    mediaUrl: (options) => {
      return client.mediaUrl(options)
    },
    agentTranscript: (options) => {
      return client.agentTranscript(options)
    },
    send: refuse,
    resolve: refuse,
    cancel: refuse,
    answer: refuse,
    runCommand: refuse,
    setPluginSetting: refuse
  }
}
