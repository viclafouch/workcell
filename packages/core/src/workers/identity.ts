import { execFileSync } from 'node:child_process'

export type GitIdentity = { name: string; email: string }

export type WorkerIdentityEnvParams = GitIdentity & { coAuthorEmail: string }

function readGlobalGitConfig(key: string) {
  try {
    return execFileSync('git', ['config', 'get', '--global', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch (error) {
    throw new Error(
      `The host git config has no ${key}: run git config set --global ${key} <value>.`,
      { cause: error }
    )
  }
}

export function readHostGitIdentity(): GitIdentity {
  return {
    name: readGlobalGitConfig('user.name'),
    email: readGlobalGitConfig('user.email')
  }
}

function withAngleBracketsOutsideTheCommand(email: string) {
  return `<${email}>`
}

export function workerIdentityEnv({
  name,
  email,
  coAuthorEmail
}: WorkerIdentityEnvParams) {
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    CO_AUTHOR_EMAIL: withAngleBracketsOutsideTheCommand(coAuthorEmail)
  }
}
