import { expect, test, type Page } from '@playwright/test'

const DRAG_ROW_Y = 300

const WIDE_SIDEBAR_PX = 400

const FOLDING_X = 40

const resizerOf = (page: Page) => {
  return page.getByRole('separator', { name: /Sidebar width/u })
}

const PIXEL_ROUNDING = 1

const distanceToWideWidthOf = async (page: Page) => {
  return Math.abs((await sidebarWidthOf(page)) - WIDE_SIDEBAR_PX)
}

const sidebarWidthOf = async (page: Page) => {
  const box = await resizerOf(page).boundingBox()

  return box === null ? 0 : Math.round(box.x + box.width / 2)
}

const dragResizerTo = async (page: Page, x: number) => {
  const box = await resizerOf(page).boundingBox()

  if (box === null) {
    throw new Error('The sidebar resizer is not on the page.')
  }

  await page.mouse.move(box.x + box.width / 2, DRAG_ROW_Y)
  await page.mouse.down()
  await page.mouse.move(x, DRAG_ROW_Y, { steps: 8 })
  await page.mouse.up()
}

test.describe('the sidebar', () => {
  test('a person drags it to a new width, and the width stays after a reload', async ({
    page
  }) => {
    await page.goto('/')
    await dragResizerTo(page, WIDE_SIDEBAR_PX)

    await expect
      .poll(() => {
        return distanceToWideWidthOf(page)
      })
      .toBeLessThanOrEqual(PIXEL_ROUNDING)

    await page.reload({ waitUntil: 'domcontentloaded' })
    const widthBeforeTheApp = await page.evaluate(() => {
      return document.documentElement.style.getPropertyValue(
        '--sidebar-width-chosen'
      )
    })

    expect(Number.parseFloat(widthBeforeTheApp)).toBeGreaterThan(0)
    await expect
      .poll(() => {
        return distanceToWideWidthOf(page)
      })
      .toBeLessThanOrEqual(PIXEL_ROUNDING)
  })

  test('a click on its edge folds nothing', async ({ page }) => {
    await page.goto('/')
    await resizerOf(page).click()

    await expect(resizerOf(page)).toHaveAttribute('aria-valuetext', 'Open')
  })

  test('a drag to the left edge folds it, and it stays folded after a reload', async ({
    page
  }) => {
    await page.goto('/')
    await dragResizerTo(page, FOLDING_X)

    await expect(resizerOf(page)).toHaveAttribute('aria-valuetext', 'Folded')

    await page.reload()

    await expect(resizerOf(page)).toHaveAttribute('aria-valuetext', 'Folded')
  })

  test('the arrow keys resize it, one step at a time', async ({ page }) => {
    await page.goto('/')
    const before = await sidebarWidthOf(page)

    await resizerOf(page).focus()
    await page.keyboard.press('ArrowRight')

    await expect
      .poll(() => {
        return sidebarWidthOf(page)
      })
      .toBeGreaterThan(before)
  })
})
