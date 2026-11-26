import { expect, test } from '@playwright/test'

test.describe('the page of what runs now', () => {
  test('the page names the workers on a task and who waits for a person', async ({
    page
  }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Three workers are on a task.'
      })
    ).toBeVisible()
    await expect(page.getByText('Bravo waits for you.')).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Running workers' })
    ).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Blocked' })).toBeVisible()
  })

  test('the theme switch pins the other colour scheme and keeps it on reload', async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')

    await page.getByRole('button', { name: 'Switch to the dark theme' }).click()
    await page.reload()

    await expect
      .poll(() => {
        return page.evaluate(() => {
          return document.documentElement.dataset.colorScheme
        })
      })
      .toBe('dark')
    await expect(
      page.getByRole('button', { name: 'Switch to the light theme' })
    ).toBeVisible()
  })
})
