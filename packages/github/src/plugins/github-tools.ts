import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import { definePlugin, PermissionRules } from '@tanstack/ai-harness'
import type { GithubReader } from '#/api/github-reader.ts'
import {
  GITHUB_TOOLS_TEXT,
  githubPrompt,
  outsideRepositoriesRefusal
} from '#/prompts/github.ts'

const MAX_HISTORY_LIMIT = 30

export const GITHUB_TOOL_NAMES = [
  'github_read_pull_request',
  'github_read_pull_request_patch',
  'github_read_file',
  'github_read_file_history'
] as const

type GithubToolsParams = {
  reader: GithubReader
  repositories: readonly string[]
}

export function githubTools({ reader, repositories }: GithubToolsParams) {
  const repository = z
    .string()
    .describe(GITHUB_TOOLS_TEXT.repository(repositories))
  const pullRequestNumber = z
    .number()
    .int()
    .positive()
    .describe(GITHUB_TOOLS_TEXT.number)
  const path = z.string().describe(GITHUB_TOOLS_TEXT.path)

  const inRepositories = <Input extends { repository: string }, Output>(
    read: (input: Input) => Promise<Output>
  ) => {
    return async (input: Input) => {
      return repositories.includes(input.repository)
        ? read(input)
        : outsideRepositoriesRefusal(input.repository, repositories)
    }
  }

  const [readPullRequest, readPullRequestPatch, readFile, readFileHistory] =
    GITHUB_TOOL_NAMES

  return definePlugin({
    name: 'workcell/github-tools',
    setup: () => {
      return {
        tools: [
          toolDefinition({
            name: readPullRequest,
            description: GITHUB_TOOLS_TEXT.readPullRequest,
            replay: 'safe',
            inputSchema: z.object({ repository, number: pullRequestNumber })
          }).server(inRepositories(reader.readPullRequest)),
          toolDefinition({
            name: readPullRequestPatch,
            description: GITHUB_TOOLS_TEXT.readPullRequestPatch,
            replay: 'safe',
            inputSchema: z.object({
              repository,
              number: pullRequestNumber,
              path
            })
          }).server(inRepositories(reader.readPullRequestPatch)),
          toolDefinition({
            name: readFile,
            description: GITHUB_TOOLS_TEXT.readFile,
            replay: 'safe',
            inputSchema: z.object({
              repository,
              path,
              ref: z.string().describe(GITHUB_TOOLS_TEXT.ref),
              offset: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe(GITHUB_TOOLS_TEXT.offset),
              limit: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe(GITHUB_TOOLS_TEXT.lineLimit)
            })
          }).server(inRepositories(reader.readFile)),
          toolDefinition({
            name: readFileHistory,
            description: GITHUB_TOOLS_TEXT.readFileHistory,
            replay: 'safe',
            inputSchema: z.object({
              repository,
              path,
              ref: z.string().optional().describe(GITHUB_TOOLS_TEXT.historyRef),
              limit: z
                .number()
                .int()
                .min(1)
                .max(MAX_HISTORY_LIMIT)
                .optional()
                .describe(GITHUB_TOOLS_TEXT.limit)
            })
          }).server(inRepositories(reader.readFileHistory))
        ],
        prompts: [
          { id: 'workcell/github-tools', text: githubPrompt(repositories) }
        ],
        contribute: GITHUB_TOOL_NAMES.map((tool) => {
          return PermissionRules.item({ tool, decision: 'allow', kind: 'read' })
        })
      }
    }
  })
}
