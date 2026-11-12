import { spawn } from 'node:child_process'

type LogLine = (details: Record<string, unknown>, message: string) => void

export function keepMachineAwake(log: { warn: LogLine }) {
  const caffeinate = spawn(
    '/usr/bin/caffeinate',
    ['-i', '-s', '-w', String(process.pid)],
    { stdio: 'ignore' }
  )
  caffeinate.on('error', (error) => {
    log.warn({ error }, 'machine sleep not held')
  })
  caffeinate.unref()
}
