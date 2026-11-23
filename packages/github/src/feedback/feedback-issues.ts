import type { DeliverFeedback } from '@workcell/core'
import {
  splitRepository,
  undefinedOnStatus,
  type GithubOctokit
} from '#/api/github-octokit.ts'
import {
  feedbackIssueBody,
  feedbackIssueTitle,
  feedbackLabelsOf,
  type FeedbackLabel
} from '#/prompts/feedback.ts'

const LABEL_EXISTS_STATUS = 422

type GithubFeedbackIssuesParams = {
  octokit: GithubOctokit
  repository: string
  labels?: readonly FeedbackLabel[]
}

export function githubFeedbackIssues({
  octokit,
  repository,
  labels = []
}: GithubFeedbackIssuesParams): DeliverFeedback {
  const { owner, repo } = splitRepository(repository)
  const colouredLabels = new Set<string>()

  const colour = async (
    { name, color, description }: FeedbackLabel,
    signal: AbortSignal
  ) => {
    const created = await undefinedOnStatus(
      LABEL_EXISTS_STATUS,
      octokit.request('POST /repos/{owner}/{repo}/labels', {
        owner,
        repo,
        name,
        color,
        description,
        request: { signal }
      })
    )

    if (created === undefined) {
      await octokit.request('PATCH /repos/{owner}/{repo}/labels/{name}', {
        owner,
        repo,
        name,
        color,
        description,
        request: { signal }
      })
    }

    colouredLabels.add(name)
  }

  return async (report, { signal }) => {
    const reportLabels = [...labels, ...feedbackLabelsOf(report)]
    const uncolouredLabels = reportLabels.filter(({ name }) => {
      return !colouredLabels.has(name)
    })

    for (const label of uncolouredLabels) {
      // oxlint-disable-next-line no-await-in-loop -- GitHub asks for its writes one at a time
      await colour(label, signal)
    }
    await octokit.request('POST /repos/{owner}/{repo}/issues', {
      owner,
      repo,
      title: feedbackIssueTitle(report),
      body: feedbackIssueBody(report),
      labels: reportLabels.map(({ name }) => {
        return name
      }),
      request: { signal }
    })
  }
}
