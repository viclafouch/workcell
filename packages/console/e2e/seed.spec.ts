import { expect, test } from '@playwright/test'

test.describe('the seed of the Playwright agents', () => {
  test('seed', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
