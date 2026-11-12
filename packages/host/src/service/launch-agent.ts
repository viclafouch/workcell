import { execFileSync } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

const STOP_TIMEOUT_SECONDS = 60

type LaunchAgentParams = {
  label: string
  appName: string
  workingDirectory: string
  hostArguments: readonly string[]
  environment: Readonly<Record<string, string>>
  logFileVariable: string
}

export function defineLaunchAgent({
  label,
  appName,
  workingDirectory,
  hostArguments,
  environment,
  logFileVariable
}: LaunchAgentParams) {
  const logFolder = join(homedir(), 'Library', 'Logs', appName)
  const userDomain = `gui/${userInfo().uid}`

  return {
    label,
    logFolder,
    currentLogPath: join(logFolder, 'current.log'),
    launchAgentPath: join(
      homedir(),
      'Library',
      'LaunchAgents',
      `${label}.plist`
    ),
    stopTimeoutSeconds: STOP_TIMEOUT_SECONDS,
    userDomain,
    serviceTarget: `${userDomain}/${label}`,
    plist: () => {
      const launchdLog = join(logFolder, 'launchd.log')
      const definition = {
        Label: label,
        ProgramArguments: [process.execPath, ...hostArguments],
        WorkingDirectory: workingDirectory,
        EnvironmentVariables: {
          ...environment,
          [logFileVariable]: join(logFolder, 'host.log')
        },
        KeepAlive: true,
        ExitTimeOut: STOP_TIMEOUT_SECONDS,
        StandardOutPath: launchdLog,
        StandardErrorPath: launchdLog
      }

      return execFileSync(
        '/usr/bin/plutil',
        ['-convert', 'xml1', '-o', '-', '-'],
        { input: JSON.stringify(definition), encoding: 'utf8' }
      )
    }
  }
}
