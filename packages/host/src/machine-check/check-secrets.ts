import type { SecretProbe } from '@workcell/core'
import type { CheckResult } from './check-result.ts'
import type { MachineCommands } from './machine-commands.ts'

type SecretReader<Name extends string> = {
  read: (name: Name) => Promise<string | undefined>
}

type CheckSecretsParams<Name extends string> = {
  store: SecretReader<Name>
  names: readonly Name[]
  probes: Partial<Record<Name, SecretProbe>>
  commands: Pick<MachineCommands, 'check' | 'setSecret'>
}

export async function checkSecrets<Name extends string>({
  store,
  names,
  probes,
  commands
}: CheckSecretsParams<Name>) {
  const toFailure = (label: string, cause: string): CheckResult => {
    return { label, ok: false, fix: `${cause}: ${commands.setSecret(label)}` }
  }

  return Promise.all(
    names.map(async (name): Promise<CheckResult> => {
      const value = await store.read(name)

      if (!value) {
        return toFailure(name, 'Missing')
      }

      const secretProbe = probes[name]

      if (!secretProbe) {
        return { label: name, ok: true }
      }

      const verdict = await secretProbe.probe(value)

      if (verdict === 'refused') {
        return toFailure(name, `${secretProbe.service} refuses it`)
      }

      if (verdict === 'unreachable') {
        return {
          label: name,
          ok: false,
          fix: `${secretProbe.service} does not answer: check the network, then run ${commands.check} again`
        }
      }

      return { label: name, ok: true }
    })
  )
}
