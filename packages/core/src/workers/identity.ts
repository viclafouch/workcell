import { execFileSync } from 'node:child_process'

export type GitIdentity = { name: string; email: string }

export type WorkerIdentityEnvParams = GitIdentity & { coAuthorEmail: string }

type ReadHostGitIdentityParams = { directory: string }

function readGitConfig(directory: string, key: string) {
  try {
    return execFileSync('git', ['config', 'get', key], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch (error) {
    throw new Error(
      `The git config of ${directory} has no ${key}: run git config set ${key} <value> in its repository, or with --global.`,
      { cause: error }
    )
  }
}

export function readHostGitIdentity({
  directory
}: ReadHostGitIdentityParams): GitIdentity {
  return {
    name: readGitConfig(directory, 'user.name'),
    email: readGitConfig(directory, 'user.email')
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
