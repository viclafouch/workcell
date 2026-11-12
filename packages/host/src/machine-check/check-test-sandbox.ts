import type { CheckResult } from './check-result.ts'
import { dockerOutput } from './docker-output.ts'

const LABEL = 'Test sandbox'

type TestSandboxOptions = {
  dockerLabel: string
  sandboxName: string
}

function runningTestSandboxes(dockerLabel: string) {
  return ['ps', '--quiet', '--filter', `label=${dockerLabel}`]
}

export function toTestSandboxResult(
  containerIds: string,
  { dockerLabel, sandboxName }: TestSandboxOptions
): CheckResult {
  if (containerIds.trim() === '') {
    return { label: LABEL, ok: true }
  }

  return {
    label: LABEL,
    ok: false,
    fix: `A ${sandboxName} test sandbox still runs: docker rm --force $(docker ${runningTestSandboxes(dockerLabel).join(' ')})`
  }
}

export async function checkTestSandbox(
  options: TestSandboxOptions
): Promise<CheckResult> {
  const containerIds = await dockerOutput(
    runningTestSandboxes(options.dockerLabel)
  )

  if (containerIds === null) {
    return { label: LABEL, ok: false, fix: 'Start the Docker daemon.' }
  }

  return toTestSandboxResult(containerIds, options)
}
