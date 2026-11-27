import { expect, test } from '@playwright/test'

test.describe('the panel of one worker on a phone', () => {
  test('the chat is one tab, and every tab stays in reach without a page scroll', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')

    await expect(
      page.getByRole('button', { name: /Updated the plan/u })
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: /Files/u })).toBeInViewport()

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollHeight - window.innerHeight
    })

    expect(overflow).toBeLessThanOrEqual(0)
  })
})
