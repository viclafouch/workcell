import { expect, test } from '@playwright/test'

test.describe('the page of what runs now', () => {
  test('the page names the workers that work and the ones that wait for a person', async ({
    page
  }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', { level: 1, name: 'Two workers are working.' })
    ).toBeVisible()
    await expect(page.getByText('Bravo and Golf wait for you.')).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Workers that need you' })
    ).toContainText('Sandbox failed')
    await expect(
      page.getByRole('list', { name: 'Working workers' })
    ).toContainText('Alpha')
    await expect(page.getByRole('cell', { name: 'Blocked' })).toBeVisible()
  })

  test('the asleep workers fold away until a person opens them', async ({
    page
  }) => {
    await page.goto('/')

    const asleep = page.getByRole('list', { name: 'Asleep workers' })

    await expect(asleep).toBeHidden()
    await page
      .getByRole('main')
      .getByRole('button', { name: /Asleep/u })
      .click()
    await expect(asleep).toContainText('Foxtrot')
  })

  test('a bot thread links to the worker it started, and the worker links back', async ({
    page
  }) => {
    await page.goto('/threads/bot-standup')

    await page.getByRole('tab', { name: 'Workers' }).click()
    await page
      .getByRole('list', { name: 'Workers this thread started' })
      .getByRole('link', { name: /Alpha/u })
      .click()
    await page.getByRole('link', { name: 'Started in a bot thread' }).click()

    await expect(page).toHaveURL(/\/threads\/bot-standup$/u)
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
