import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { text } from 'node:stream/consumers'

export async function dockerOutput(args: string[]) {
  const docker = spawn('docker', args, {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const [output] = await Promise.all([
    text(docker.stdout),
    once(docker, 'close').catch(() => {})
  ])

  return docker.exitCode === 0 ? output : null
}
