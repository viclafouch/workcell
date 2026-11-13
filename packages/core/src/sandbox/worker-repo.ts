import { githubRepo } from '@tanstack/ai-sandbox'

type WorkerRepoParams = Parameters<typeof githubRepo>[0]

export function workerRepo({ depth = 'full', ...source }: WorkerRepoParams) {
  return githubRepo({ ...source, depth })
}
