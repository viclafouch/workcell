import { GithubOctokit } from '#/api/github-octokit.ts'

export function testOctokit(auth: string) {
  return new GithubOctokit({ auth, throttle: { enabled: false } })
}
