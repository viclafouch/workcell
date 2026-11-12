import { spawn } from 'node:child_process'
import { once } from 'node:events'
import type { CheckResult } from './check-result.ts'

type CheckCommandParams = {
  label: string
  command: string
  args: string[]
  fix: string
}

async function succeeds(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: 'ignore' })

  try {
    await once(child, 'close')
  } catch {
    return false
  }

  return child.exitCode === 0
}

export async function checkCommand({
  label,
  command,
  args,
  fix
}: CheckCommandParams): Promise<CheckResult> {
  if (await succeeds(command, args)) {
    return { label, ok: true }
  }

  return { label, ok: false, fix }
}
