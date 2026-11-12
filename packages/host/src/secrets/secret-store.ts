import { z } from 'zod'
import {
  createEnvironmentSecretStore,
  type Environment
} from './environment-secret-store.ts'
import { createKeychainSecretStore } from './keychain-secret-store.ts'

export type SecretStore<Name extends string = string> = {
  read: (name: Name) => Promise<string | undefined>
}

export const SECRET_STORE_KINDS = ['keychain', 'environment'] as const

export type SecretStoreKind = (typeof SECRET_STORE_KINDS)[number]

type SecretStoreParams = {
  kind: SecretStoreKind
  appName: string
  environment: Environment
}

export function createSecretStore<Name extends string>({
  kind,
  appName,
  environment
}: SecretStoreParams): SecretStore<Name> {
  if (kind === 'keychain') {
    return createKeychainSecretStore({ appName })
  }

  return createEnvironmentSecretStore(environment)
}

export async function loadSecrets<
  StoreName extends string,
  const Name extends StoreName
>(store: SecretStore<StoreName>, names: readonly [Name, ...Name[]]) {
  const entries = await Promise.all(
    names.map(async (name) => {
      return [name, await store.read(name)] as const
    })
  )
  const result = z
    .record(z.enum(names), z.string().min(1))
    .safeParse(Object.fromEntries(entries))

  if (!result.success) {
    const missingNames = result.error.issues.map(({ path }) => {
      return path.join('.')
    })

    throw new Error(`Missing secrets: ${missingNames.join(', ')}.`)
  }

  return Object.freeze(result.data)
}
