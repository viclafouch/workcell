import type { SandboxHandle } from '@tanstack/ai-sandbox'
import { REWARD_FILE } from '#/cases/eval-case.ts'
import { InfrastructureError } from './infrastructure-error.ts'

const VERIFIER_DIR = '.workcell-verifier'

const VERIFIER_SCRIPT = `${VERIFIER_DIR}/test.sh`

const OUTSIDE_THE_VERIFIER = `-- . ':!${VERIFIER_DIR}'`

export type Grade = {
  diff: string
  reward: number
}

async function run(sandbox: SandboxHandle, command: string) {
  const { stdout, stderr, exitCode } = await sandbox.process.exec(command)

  if (exitCode !== 0) {
    throw new InfrastructureError(
      `The trial sandbox failed on \`${command}\` with the exit code ${exitCode}: ${stderr.trim()}`
    )
  }

  return stdout
}

async function readReward(sandbox: SandboxHandle) {
  const rewardPath = `${VERIFIER_DIR}/${REWARD_FILE}`

  if (!(await sandbox.fs.exists(rewardPath))) {
    throw new InfrastructureError(
      `The verifier wrote no ${REWARD_FILE}: it must write a number to $REWARD_DIR/${REWARD_FILE}.`
    )
  }

  const written = await sandbox.fs.read(rewardPath)
  const reward = Number(written.trim())

  if (Number.isNaN(reward)) {
    throw new InfrastructureError(
      `The verifier wrote a ${REWARD_FILE} that holds no number.`
    )
  }

  return reward
}

export async function gradeTrial(
  sandbox: SandboxHandle,
  { baseCommit, verifier }: { baseCommit: string; verifier: string }
): Promise<Grade> {
  const diff = await run(
    sandbox,
    `git add --all --intent-to-add ${OUTSIDE_THE_VERIFIER} && git diff ${baseCommit} ${OUTSIDE_THE_VERIFIER}`
  )
  await sandbox.fs.mkdir(VERIFIER_DIR)
  await sandbox.fs.write(VERIFIER_SCRIPT, verifier)
  await sandbox.process.exec(
    `REWARD_DIR="$PWD/${VERIFIER_DIR}" bash ${VERIFIER_SCRIPT}`
  )

  return { diff, reward: await readReward(sandbox) }
}
