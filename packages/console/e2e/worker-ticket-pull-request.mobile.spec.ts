import { expect, test } from '@playwright/test'

test.describe('the ticket and the pull request of a worker on a phone', () => {
  test('the tab bar scrolls to the ticket and the pull request, and the page never scrolls sideways', async ({
    page
  }) => {
    await page.goto('/workers/worker-alpha-login-redirect')

    await page.getByRole('tab', { name: 'Ticket' }).click()
    await expect(
      page.getByRole('article', { name: 'Ticket ENG-128' })
    ).toBeVisible()

    await page.getByRole('tab', { name: 'Pull request' }).click()
    await expect(
      page.getByRole('article', { name: 'Pull request #418' })
    ).toBeVisible()

    const sidewaysOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - window.innerWidth
    })

    expect(sidewaysOverflow).toBeLessThanOrEqual(0)
  })
})
