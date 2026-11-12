import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { text } from 'node:stream/consumers'
import type { SecretStore } from './secret-store.ts'

const SECURITY_BINARY = '/usr/bin/security'

const ITEM_NOT_FOUND_EXIT_CODE = 44

export type KeychainParams = {
  appName: string
}

type KeychainSecretStore<Name extends string> = SecretStore<Name> & {
  write: (name: Name, value: string) => Promise<void>
}

export function createKeychainSecretStore<Name extends string>({
  appName
}: KeychainParams): KeychainSecretStore<Name> {
  const toItemArguments = (name: Name) => {
    return ['-a', appName, '-s', `${appName}/${name}`]
  }

  const read = async (name: Name) => {
    const security = spawn(
      SECURITY_BINARY,
      ['find-generic-password', ...toItemArguments(name), '-w'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const [password, securityError] = await Promise.all([
      text(security.stdout),
      text(security.stderr),
      once(security, 'close')
    ])

    if (security.exitCode === ITEM_NOT_FOUND_EXIT_CODE) {
      return
    }

    if (security.exitCode !== 0) {
      throw new Error(
        `The Keychain refused to give the secret ${name}: ${securityError.trim()}`
      )
    }

    return password.replace(/\n$/u, '')
  }

  const write = async (name: Name, value: string) => {
    const security = spawn(SECURITY_BINARY, ['-i'], {
      stdio: ['pipe', 'ignore', 'pipe']
    })
    const hexValue = Buffer.from(value, 'utf8').toString('hex')
    security.stdin.end(
      `add-generic-password -U ${toItemArguments(name).join(' ')} -X ${hexValue}\n`
    )
    const [securityError] = await Promise.all([
      text(security.stderr),
      once(security, 'close')
    ])
    const stored = await read(name)

    if (stored !== value) {
      throw new Error(
        `The Keychain did not store the secret ${name}: ${securityError.trim() || 'the stored value differs'}.`
      )
    }
  }

  return { read, write }
}
