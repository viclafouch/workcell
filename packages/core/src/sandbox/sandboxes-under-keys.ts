import type { SandboxProvider } from '@tanstack/ai-sandbox'
import type { ListSandboxes } from '#core/workers/lifecycle'

type ListingProvider = Pick<SandboxProvider, 'destroy'> & {
  list: ListSandboxes
}

export async function listSandboxesUnder(
  provider: Pick<ListingProvider, 'list'>,
  keys: readonly string[]
) {
  const listed = await provider.list()

  return listed.filter(({ key }) => {
    return keys.includes(key)
  })
}

export async function destroySandboxesUnder(
  provider: ListingProvider,
  keys: readonly string[]
) {
  const listed = await listSandboxesUnder(provider, keys)

  await Promise.all(
    listed.map(({ id }) => {
      return provider.destroy({ id })
    })
  )
}
