import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AsyncQueuer } from '@tanstack/pacer'

const LIBRARIES = ['ai', 'pacer']

const TANSTACK_INDEX = 'https://tanstack.com/llms.txt'

const DOCS_DIR = '.tanstack-docs'

const CONCURRENT_DOWNLOADS = 8

const PAGE_TIMEOUT_MS = 30_000

const SERVER_FRAMEWORK = '/framework/vanilla/'

const DOC_PAGE_LINK = /\((https:\/\/tanstack\.com\/[^)\s]+\.md)\)/gu

const LIBRARY_INDEX_LINK =
  /\((?<url>https:\/\/tanstack\.com\/(?<library>[a-z-]+)\/latest\/llms\.txt)\)/gu

async function fetchText(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}.`)
  }

  return response.text()
}

async function save(url: string, text: string) {
  const file = join(DOCS_DIR, new URL(url).pathname.replace('/latest', ''))
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text)
}

async function listPages(library: string) {
  const indexUrl = `https://tanstack.com/${library}/latest/llms.txt`
  const index = await fetchText(indexUrl)
  await save(indexUrl, index)
  const pages = [...index.matchAll(DOC_PAGE_LINK)]
    .map(([, url]) => {
      return url ?? ''
    })
    .filter((url) => {
      return (
        !url.includes('/examples/') &&
        (!url.includes('/framework/') || url.includes(SERVER_FRAMEWORK))
      )
    })

  if (pages.length === 0) {
    throw new Error(`${indexUrl} lists no .md page: its link format changed.`)
  }

  return pages
}

async function listOtherLibraryIndexes() {
  const index = await fetchText(TANSTACK_INDEX)
  await save(TANSTACK_INDEX, index)
  const libraryIndexes = [...index.matchAll(LIBRARY_INDEX_LINK)]

  if (libraryIndexes.length === 0) {
    throw new Error(
      `${TANSTACK_INDEX} lists no library index: its link format changed.`
    )
  }

  return libraryIndexes
    .filter(({ groups }) => {
      return !LIBRARIES.includes(groups?.library ?? '')
    })
    .map(({ groups }) => {
      return groups?.url ?? ''
    })
}

await rm(DOCS_DIR, { recursive: true, force: true })
const pageLists = await Promise.all([
  ...LIBRARIES.map(listPages),
  listOtherLibraryIndexes()
])
const pages = [...new Set(pageLists.flat())]
const failures: string[] = []
const allSettled = Promise.withResolvers<null>()
let settled = 0

const downloads = new AsyncQueuer<string>(
  async (url) => {
    await save(url, await fetchText(url))
  },
  {
    concurrency: CONCURRENT_DOWNLOADS,
    initialItems: pages,
    onError: (error) => {
      failures.push(error.message)
    },
    onSettled: () => {
      settled += 1

      if (settled === pages.length) {
        allSettled.resolve(null)
      }
    }
  }
)
await allSettled.promise
downloads.stop()

if (failures.length > 0) {
  throw new Error(`${failures.length} pages failed:\n${failures.join('\n')}`)
}

process.stdout.write(`${pages.length} pages in ${DOCS_DIR}/\n`)
