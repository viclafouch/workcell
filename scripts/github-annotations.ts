import { globSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { stripVTControlCharacters } from 'node:util'

const ROOT_PACKAGE = '//'

const TASK_HEADER = /^(?:::group::)?(?<name>\/\/|[^:\s]+):[\w:-]+$/u

const ANNOTATION_FILE =
  /^(?<command>::(?:error|warning|notice) [^:]*?file=)(?<file>[^,:]+)(?<rest>.*)$/u

const TYPESCRIPT_DIAGNOSTIC =
  /^(?<file>[^\s(][^(]*)\((?<line>\d+),(?<col>\d+)\): (?<severity>error|warning) (?<code>TS\d+): (?<message>.*)$/u

function packageNameOf(manifestPath: string) {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))

  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('name' in manifest) ||
    typeof manifest.name !== 'string'
  ) {
    throw new Error(`${manifestPath} names no package.`)
  }

  return manifest.name
}

const packageDirectories = new Map(
  globSync('packages/*/package.json').map((manifestPath) => {
    return [packageNameOf(manifestPath), dirname(manifestPath)]
  })
)

function escapeData(text: string) {
  return text
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
}

function escapeProperty(text: string) {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C')
}

function fromRepositoryRoot(directory: string, file: string) {
  return isAbsolute(file) || directory === '' ? file : join(directory, file)
}

function annotationsOf(line: string, directory: string) {
  const annotation = ANNOTATION_FILE.exec(line)?.groups

  if (annotation !== undefined) {
    const { command, file = '', rest } = annotation

    return [`${command}${fromRepositoryRoot(directory, file)}${rest}`]
  }

  const diagnostic = TYPESCRIPT_DIAGNOSTIC.exec(line)?.groups

  if (diagnostic === undefined) {
    return [line]
  }

  const {
    file = '',
    line: row,
    col,
    severity,
    code = '',
    message = ''
  } = diagnostic
  const path = escapeProperty(fromRepositoryRoot(directory, file))

  return [
    line,
    `::${severity} file=${path},line=${row},col=${col},title=${escapeProperty(code)}::${escapeData(message)}`
  ]
}

let directory = ''

for await (const line of createInterface({ input: process.stdin })) {
  const task = TASK_HEADER.exec(stripVTControlCharacters(line))?.groups?.name

  if (task === ROOT_PACKAGE) {
    directory = ''
  } else if (task !== undefined && packageDirectories.has(task)) {
    directory = packageDirectories.get(task) ?? ''
  }

  for (const output of annotationsOf(line, directory)) {
    process.stdout.write(`${output}\n`)
  }
}
