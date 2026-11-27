import { expect, test, type Page } from '@playwright/test'

const FIXTURE_QUEUE_LENGTH = 5

const UP_NEXT_TICKETS = 3

const queueTicketsOf = (page: Page) => {
  return page
    .getByRole('list', { name: 'Tickets waiting in Linear' })
    .getByRole('listitem')
}

const ticketOf = (page: Page, key: string) => {
  return queueTicketsOf(page).filter({ hasText: key })
}

test.describe('the queue', () => {
  test('a person reads every ticket that waits, in the order of the tracker', async ({
    page
  }) => {
    await page.goto('/queue')

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Five tickets wait in Linear.'
      })
    ).toBeVisible()
    await expect(queueTicketsOf(page)).toHaveCount(FIXTURE_QUEUE_LENGTH)
    await expect(queueTicketsOf(page)).toContainText([
      'ENG-142',
      'ENG-151',
      'ENG-139',
      'ENG-120',
      'ENG-98'
    ])
  })

  test('a ticket shows its place, its priority, its assignee and a link to the tracker', async ({
    page
  }) => {
    await page.goto('/queue')
    const ticket = ticketOf(page, 'ENG-139')

    await expect(ticket).toContainText('Place 2')
    await expect(ticket).toContainText('High')
    await expect(ticket).toContainText('Grace Hopper')
    await expect(
      ticket.getByRole('link', { name: /Show the delivery date/u })
    ).toHaveAttribute('target', '_blank')
  })

  test('a ticket that cannot start takes no place, and names its cause', async ({
    page
  }) => {
    await page.goto('/queue')
    const ticket = ticketOf(page, 'ENG-151')

    await expect(ticket).toContainText('Cannot start')
    await expect(ticket).toContainText(
      'It needs a repository label: repo:web, repo:api.'
    )
    await expect(ticket).not.toContainText('Place')
  })

  test('the Now page shows the next tickets, and leads to the whole queue', async ({
    page
  }) => {
    await page.goto('/')
    const upNext = page.getByRole('region', { name: 'Up next' })

    await expect(
      upNext
        .getByRole('list', { name: 'Next tickets in Linear' })
        .getByRole('listitem')
    ).toHaveCount(UP_NEXT_TICKETS)

    await upNext.getByRole('link', { name: 'See the whole queue (5)' }).click()

    await expect(page).toHaveURL(/\/queue$/u)
    await expect(queueTicketsOf(page)).toHaveCount(FIXTURE_QUEUE_LENGTH)
  })
})
