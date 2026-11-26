import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { staticMiddleware } from 'srvx/static'
import type { DashboardBrand } from './dashboard-context.ts'
import { notFound } from './responses.ts'

export type DashboardBrandOptions = {
  name: string
  stylesheets?: readonly URL[]
  logo?: URL
  assets?: URL
}

const BRAND_PATH = '/brand'

const THEME_PATH = `${BRAND_PATH}/theme.css`

const STYLESHEET_PATH = new RegExp(
  `^${BRAND_PATH}/stylesheets/(?<index>\\d+)\\.css$`,
  'u'
)

const ASSETS_PATH = `${BRAND_PATH}/assets/`

const LOGO_TYPES = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
])

const NO_CACHE = 'no-cache'

const stylesheetResponse = (css: string) => {
  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': NO_CACHE
    }
  })
}

const themeOf = (stylesheets: readonly URL[]) => {
  return stylesheets
    .map((_, index) => {
      return `@import url('${BRAND_PATH}/stylesheets/${index}.css') layer(brand);`
    })
    .join('\n')
}

export const brandOf = ({
  name,
  stylesheets = [],
  logo
}: DashboardBrandOptions): DashboardBrand => {
  return {
    name,
    stylesheetUrl: stylesheets.length === 0 ? undefined : THEME_PATH,
    logoUrl:
      logo === undefined
        ? undefined
        : `${BRAND_PATH}/logo${extname(logo.pathname)}`
  }
}

export const createBrandServer = ({
  stylesheets = [],
  logo,
  assets
}: DashboardBrandOptions) => {
  const serveAsset =
    assets === undefined
      ? null
      : staticMiddleware({ dir: fileURLToPath(assets) })
  const logoType =
    logo === undefined ? undefined : LOGO_TYPES.get(extname(logo.pathname))

  return async (request: Request) => {
    const { pathname } = new URL(request.url)

    if (pathname === THEME_PATH) {
      return stylesheetResponse(themeOf(stylesheets))
    }

    const stylesheet =
      stylesheets[Number(STYLESHEET_PATH.exec(pathname)?.groups?.index)]

    if (stylesheet !== undefined) {
      return stylesheetResponse(await readFile(stylesheet, 'utf8'))
    }

    if (
      logo !== undefined &&
      logoType !== undefined &&
      pathname === brandOf({ name: '', logo }).logoUrl
    ) {
      return new Response(await readFile(logo), {
        headers: { 'content-type': logoType, 'cache-control': NO_CACHE }
      })
    }

    if (serveAsset !== null && pathname.startsWith(ASSETS_PATH)) {
      const assetRequest = new Request(
        new URL(pathname.slice(ASSETS_PATH.length - 1), request.url),
        request
      )

      return serveAsset(assetRequest, notFound)
    }

    return notFound()
  }
}

export const matchIsBrandPath = (pathname: string) => {
  return pathname.startsWith(`${BRAND_PATH}/`)
}
