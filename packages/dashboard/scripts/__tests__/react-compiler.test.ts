import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transform } from 'oxc-transform-react'
import { describe, expect, it } from 'vitest'

const SOURCE_DIRECTORY = new URL('../../src/', import.meta.url)

const GENERATED_FILES = new Set(['routeTree.gen.ts', 'lib/cn-tables.ts'])

const COMPONENT_FILES = readdirSync(SOURCE_DIRECTORY, { recursive: true })
  .map(String)
  .filter((file) => {
    return (
      /\.tsx?$/u.test(file) &&
      !file.includes('__tests__') &&
      !GENERATED_FILES.has(file)
    )
  })

const compile = async (file: string) => {
  const path = fileURLToPath(new URL(file, SOURCE_DIRECTORY))
  const result = await transform(path, readFileSync(path, 'utf8'), {
    jsx: { runtime: 'automatic', development: false, refresh: false },
    reactCompiler: { reportDiagnostics: true }
  })

  return result.errors.map((error) => {
    return error.codeframe ?? error.message
  })
}

describe('the React Compiler', () => {
  it.each(COMPONENT_FILES)('compiles %s with no bail-out', async (file) => {
    expect(await compile(file)).toStrictEqual([])
  })
})
