import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'smol-toml'
import { z } from 'zod'
import { workerMetadataSchema, type TaskOutcome } from '@workcell/core'

const HARBOR_SCHEMA_VERSION = '1.4'

const EXECUTABLE_MODE = 0o755

const INSTRUCTION_FILE = 'instruction.md'

const TASK_FILE = 'task.toml'

const SOLUTION_FOLDER = 'solution'

const SOLUTION_PATCH = 'solution.patch'

const SOLVE_SCRIPT = 'solve.sh'

const TESTS_FOLDER = 'tests'

const TEST_SCRIPT = 'test.sh'

export const REWARD_FILE = 'reward.txt'

const HARBOR_REWARD_DIR = '/logs/verifier'

const SOLVE_SCRIPT_TEXT = `#!/bin/bash
set -euo pipefail
git apply /solution/${SOLUTION_PATCH}
`

const taskFileSchema = z.object({
  schema_version: z.literal(HARBOR_SCHEMA_VERSION),
  metadata: z.object({
    repository: z.string(),
    base_commit: z.string(),
    pull_request: z.string(),
    thread_id: z.string(),
    outcome: workerMetadataSchema.shape.outcome.unwrap().shape.value,
    cause: z.string().optional(),
    cost_usd: z.number()
  })
})

export type EvalCase = {
  name: string
  instruction: string
  repository: string
  baseCommit: string
  pullRequest: string
  threadId: string
  outcome: Pick<TaskOutcome, 'value' | 'cause' | 'costUsd'>
  solution: string
  verifier: string
}

export function verifierScript(checkCommand: string) {
  return `#!/bin/bash
set -uo pipefail
reward_dir="\${REWARD_DIR:-${HARBOR_REWARD_DIR}}"
mkdir -p "$reward_dir"
if ${checkCommand}; then
  echo 1 > "$reward_dir/${REWARD_FILE}"
else
  echo 0 > "$reward_dir/${REWARD_FILE}"
fi
`
}

function taskFileOf({
  repository,
  baseCommit,
  pullRequest,
  threadId,
  outcome
}: EvalCase) {
  return stringify({
    schema_version: HARBOR_SCHEMA_VERSION,
    metadata: {
      repository,
      base_commit: baseCommit,
      pull_request: pullRequest,
      thread_id: threadId,
      outcome: outcome.value,
      ...(outcome.cause === undefined ? {} : { cause: outcome.cause }),
      cost_usd: outcome.costUsd
    }
  })
}

export async function writeEvalCase(root: string, evalCase: EvalCase) {
  const folder = join(root, evalCase.name)
  const testScript = join(folder, TESTS_FOLDER, TEST_SCRIPT)
  const solveScript = join(folder, SOLUTION_FOLDER, SOLVE_SCRIPT)
  await mkdir(join(folder, SOLUTION_FOLDER), { recursive: true })
  await mkdir(join(folder, TESTS_FOLDER), { recursive: true })
  await writeFile(join(folder, INSTRUCTION_FILE), evalCase.instruction)
  await writeFile(join(folder, TASK_FILE), taskFileOf(evalCase))
  await writeFile(
    join(folder, SOLUTION_FOLDER, SOLUTION_PATCH),
    evalCase.solution
  )
  await writeFile(solveScript, SOLVE_SCRIPT_TEXT)
  await writeFile(testScript, evalCase.verifier)
  await chmod(solveScript, EXECUTABLE_MODE)
  await chmod(testScript, EXECUTABLE_MODE)

  return folder
}

async function readEvalCase(root: string, name: string): Promise<EvalCase> {
  const folder = join(root, name)
  const { metadata } = taskFileSchema.parse(
    parse(await readFile(join(folder, TASK_FILE), 'utf8'))
  )

  return {
    name,
    instruction: await readFile(join(folder, INSTRUCTION_FILE), 'utf8'),
    repository: metadata.repository,
    baseCommit: metadata.base_commit,
    pullRequest: metadata.pull_request,
    threadId: metadata.thread_id,
    outcome: {
      value: metadata.outcome,
      ...(metadata.cause === undefined ? {} : { cause: metadata.cause }),
      costUsd: metadata.cost_usd
    },
    solution: await readFile(
      join(folder, SOLUTION_FOLDER, SOLUTION_PATCH),
      'utf8'
    ),
    verifier: await readFile(join(folder, TESTS_FOLDER, TEST_SCRIPT), 'utf8')
  }
}

export async function readEvalCases(root: string) {
  const entries = await readdir(root, { withFileTypes: true })
  const names = entries
    .filter((entry) => {
      return entry.isDirectory()
    })
    .map(({ name }) => {
      return name
    })
    .toSorted()

  return Promise.all(
    names.map((name) => {
      return readEvalCase(root, name)
    })
  )
}
