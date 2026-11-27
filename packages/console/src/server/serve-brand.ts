import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { staticMiddleware } from 'srvx/static'
import { pageTitleOf } from '#/constants/brand.ts'
import type { ConsoleBrand } from './console-context.ts'
import { notFound } from './responses.ts'

export type ConsoleBrandOptions = {
  name: string
  stylesheets?: readonly URL[]
  logo?: URL
  assets?: URL
}

const BRAND_PATH = '/brand'

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

const SHELL_TITLE = /<title>[^<]*<\/title>/u

const HTML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;']
])

const escapeHtml = (text: string) => {
  return text.replaceAll(/[&<>"']/gu, (character) => {
    return HTML_ESCAPES.get(character) ?? character
  })
}

const stylesheetResponse = (css: string) => {
  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': NO_CACHE
    }
  })
}

const brandStyleOf = (stylesheets: readonly URL[]) => {
  if (stylesheets.length === 0) {
    return ''
  }

  const imports = stylesheets
    .map((_, index) => {
      return `@import url('${BRAND_PATH}/stylesheets/${index}.css') layer(brand);`
    })
    .join('')

  return `<style>${imports}</style>`
}

export const brandShellOf = (
  shell: string,
  { name, stylesheets = [] }: ConsoleBrandOptions
) => {
  return shell
    .replace(SHELL_TITLE, `<title>${escapeHtml(pageTitleOf(name))}</title>`)
    .replace('</head>', `${brandStyleOf(stylesheets)}</head>`)
}

export const brandOf = ({ name, logo }: ConsoleBrandOptions): ConsoleBrand => {
  return {
    name,
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
}: ConsoleBrandOptions) => {
  const serveAsset =
    assets === undefined
      ? null
      : staticMiddleware({ dir: fileURLToPath(assets) })
  const logoType =
    logo === undefined ? undefined : LOGO_TYPES.get(extname(logo.pathname))

  return async (request: Request) => {
    const { pathname } = new URL(request.url)

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
