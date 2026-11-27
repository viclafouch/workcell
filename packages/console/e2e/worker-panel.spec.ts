import { expect, test } from '@playwright/test'

test.describe('the panel of one worker', () => {
  test('a worker panel shows its plan, its tool calls and its file diffs as they happen', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')

    await expect(
      page.getByText('Keep the requested path through sign-in')
    ).toBeVisible()
    await page.getByRole('button', { name: /^Work(?:ing|ed)/u }).click()
    await expect(
      page.getByRole('button', {
        name: 'Wrote src/auth/redirect.ts write_file'
      })
    ).toBeVisible()
    await expect(
      page.getByText('The sign-in page now sends the visitor back')
    ).toBeVisible()

    await page.getByRole('tab', { name: /Files/u }).click()

    await expect(
      page.getByLabel('Changes to /workspace/src/auth/redirect.ts')
    ).toContainText('requested.startsWith')
  })

  test('the whole diff loads on demand, one read at a time', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')

    await page.getByRole('tab', { name: /Files/u }).click()
    await page.getByRole('button', { name: 'Read the whole diff' }).click()

    await expect(
      page.getByRole('list', { name: 'Changed files of the branch' })
    ).toContainText('export const afterSignIn')
  })

  test('the panel fits the window: the page never scrolls, each pane scrolls on its own', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')
    await expect(
      page.getByText('The sign-in page now sends the visitor back')
    ).toBeVisible()

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollHeight - window.innerHeight
    })

    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('a worker the host does not know shows the way back', async ({
    page
  }) => {
    await page.goto('/workers/no-such-thread')

    await expect(page.getByText('Nothing lives at this address')).toBeVisible()
  })
})
