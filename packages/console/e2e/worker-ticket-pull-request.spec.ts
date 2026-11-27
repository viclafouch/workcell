import { expect, test } from '@playwright/test'

test.describe('the ticket and the pull request beside a worker', () => {
  test('the header of a worker names its ticket and its pull request at a glance, with their states', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Send a signed-out visitor back to the page they asked for'
      })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: /ENG-128\s*In Progress/u })
    ).toHaveAttribute('href', 'https://tracker.example.com/acme/issue/ENG-128')
    await expect(
      page.getByRole('link', { name: /#418\s*Open/u })
    ).toHaveAttribute('href', 'https://github.com/acme/web/pull/418')
  })

  test('a worker shows the ticket it carries, as its tracker shows it', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')

    await page.getByRole('tab', { name: 'Ticket' }).click()

    const ticket = page.getByRole('article', { name: 'Ticket ENG-128' })
    await expect(
      ticket.getByRole('heading', {
        name: 'Send a signed-out visitor back to the page they asked for'
      })
    ).toBeVisible()
    await expect(ticket).toContainText('In Progress')
    await expect(ticket).toContainText(/Priority\s*High/u)
    await expect(ticket).toContainText(/Assignees\s*Ada Lovelace/u)
    await expect(
      ticket.getByRole('heading', { name: 'Done when' })
    ).toBeVisible()
  })

  test('a worker shows its pull request as its code host does: its state, its commits and its branches', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')

    await page.getByRole('tab', { name: 'Pull request' }).click()

    const pullRequest = page.getByRole('article', { name: 'Pull request #418' })
    await expect(
      pullRequest.getByRole('link', { name: /acme\/web\s*#418/u })
    ).toHaveAttribute('href', 'https://github.com/acme/web/pull/418')
    await expect(pullRequest).toContainText('Open')
    await expect(pullRequest).toContainText('3 commits')
    await expect(pullRequest).toContainText(/main\s*←\s*alpha\/login-redirect/u)
  })

  test('a pull request says what blocks its merge, how its checks run and what its reviewers said', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')
    await page.getByRole('tab', { name: 'Pull request' }).click()
    const pullRequest = page.getByRole('article', { name: 'Pull request #418' })

    await expect(pullRequest).toContainText(
      'Merge blocked: a required check or review is missing'
    )
    await expect(pullRequest).toContainText('1 of 4 failing')
    await expect(pullRequest).toContainText(/Ada Lovelace\s*Changes requested/u)

    const pageOverflow = await page.evaluate(() => {
      return document.documentElement.scrollHeight - window.innerHeight
    })
    expect(pageOverflow).toBeLessThanOrEqual(0)
  })

  test('the checks of a pull request say which fail, and how many its token cannot read', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')
    await page.getByRole('tab', { name: 'Pull request' }).click()
    const pullRequest = page.getByRole('article', { name: 'Pull request #418' })

    await pullRequest.getByRole('tab', { name: /Checks/u }).click()

    await expect(pullRequest).toContainText('1 failed, 1 running, 2 passed')
    await expect(
      pullRequest.getByRole('list', { name: 'Checks' }).getByRole('listitem')
    ).toHaveText([/deploy\/preview/u, /Unit tests/u, /Lint/u, /Typecheck/u])
    await expect(pullRequest).toContainText(
      '2 more checks run on this pull request, but the token of this host cannot read them.'
    )
  })

  test('the files of a pull request list their changes, and its diff loads on demand', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')
    await page.getByRole('tab', { name: 'Pull request' }).click()
    const pullRequest = page.getByRole('article', { name: 'Pull request #418' })

    await pullRequest.getByRole('tab', { name: /^Files/u }).click()
    await expect(
      pullRequest.getByRole('list', { name: 'Changed files' })
    ).toContainText('src/auth/redirect.ts')
    await pullRequest.getByRole('button', { name: 'Read the diff' }).click()

    await expect(
      pullRequest.getByRole('list', { name: 'Diff of the pull request' })
    ).toContainText('export const afterSignIn')
  })

  test('a finished worker shows the merge of its pull request', async ({
    page
  }) => {
    await page.goto('/workers/worker-delta-dark-mode')

    await page.getByRole('tab', { name: 'Pull request' }).click()

    const pullRequest = page.getByRole('article', { name: 'Pull request #412' })
    await expect(pullRequest).toContainText('5 commits')
    await expect(pullRequest).toContainText(/Merged into main .* by delta-bot/u)
    await expect(pullRequest).toContainText('c0ffee1')
    await expect(pullRequest).toContainText('All checks passed')
    await expect(pullRequest).toContainText(/Grace Hopper\s*Approved/u)
  })

  test('a worker with no ticket and no pull request yet shows what it has', async ({
    page
  }) => {
    await page.goto('/workers/worker-bravo-flaky-upload')

    await page.getByRole('tab', { name: 'Ticket' }).click()
    await expect(
      page.getByText(
        'This worker carries no ticket: it started from a message.'
      )
    ).toBeVisible()

    await page.getByRole('tab', { name: 'Pull request' }).click()
    await expect(
      page.getByText(
        'No pull request yet: the worker opens one from bravo/flaky-upload once its change is ready.'
      )
    ).toBeVisible()
  })
})
