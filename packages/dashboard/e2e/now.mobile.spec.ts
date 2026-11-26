import { expect, test } from '@playwright/test'

test.describe('the page of what runs now on a phone', () => {
  test('the page fits a phone without a horizontal scroll', async ({
    page
  }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Three workers are on a task.'
      })
    ).toBeVisible()

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - window.innerWidth
    })

    expect(overflow).toBe(0)
  })
})
