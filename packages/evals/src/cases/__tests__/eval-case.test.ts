import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readEvalCases,
  verifierScript,
  writeEvalCase,
  type EvalCase
} from '#/cases/eval-case.ts'

const RENAME_CASE: EvalCase = {
  name: 'rename-the-config-key',
  instruction: 'Rename the config key `timeout` to `timeoutMs` everywhere.\n',
  repository: 'acme/app',
  baseCommit: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  pullRequest: 'https://github.com/acme/app/pull/12',
  threadId: 'thread-1',
  outcome: { value: 'flawed', costUsd: 1.25 },
  solution: 'diff --git a/config.ts b/config.ts\n',
  verifier: verifierScript('npm test')
}

const EXECUTABLE_BITS = 0o111

let root: string

describe('an eval case', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-cases-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads back as the case that was written', async () => {
    await writeEvalCase(root, RENAME_CASE)

    expect(await readEvalCases(root)).toStrictEqual([RENAME_CASE])
  })

  it('lands as a Harbor task folder', async () => {
    await writeEvalCase(root, RENAME_CASE)
    const folder = join(root, RENAME_CASE.name)

    expect(await readFile(join(folder, 'instruction.md'), 'utf8')).toBe(
      RENAME_CASE.instruction
    )
    expect(await readFile(join(folder, 'task.toml'), 'utf8')).toContain(
      'schema_version = "1.4"'
    )
    expect(
      await readFile(join(folder, 'solution', 'solve.sh'), 'utf8')
    ).toContain('git apply')
    const verifier = await stat(join(folder, 'tests', 'test.sh'))

    expect(verifier.mode & EXECUTABLE_BITS).toBe(EXECUTABLE_BITS)
  })

  it('writes a verifier that runs the check command and writes the reward Harbor reads', async () => {
    await writeEvalCase(root, RENAME_CASE)
    const verifier = await readFile(
      join(root, RENAME_CASE.name, 'tests', 'test.sh'),
      'utf8'
    )

    expect(verifier).toContain('npm test')
    expect(verifier).toContain('/logs/verifier')
    expect(verifier).toContain('reward.txt')
  })

  it('keeps a cause, and a verifier a person sharpened by hand', async () => {
    const blocked: EvalCase = {
      ...RENAME_CASE,
      name: 'blocked-on-a-flaky-test',
      outcome: { value: 'blocked', cause: 'a flaky test', costUsd: 0.5 },
      verifier:
        '#!/bin/bash\nnpm test -- config.test.ts && echo 1 > /logs/verifier/reward.txt\n'
    }
    await writeEvalCase(root, blocked)

    expect(await readEvalCases(root)).toStrictEqual([blocked])
  })

  it('reads every case of a folder, in name order', async () => {
    const second = { ...RENAME_CASE, name: 'add-a-retry' }
    await writeEvalCase(root, RENAME_CASE)
    await writeEvalCase(root, second)

    const cases = await readEvalCases(root)

    expect(
      cases.map(({ name }) => {
        return name
      })
    ).toStrictEqual(['add-a-retry', 'rename-the-config-key'])
  })
})
