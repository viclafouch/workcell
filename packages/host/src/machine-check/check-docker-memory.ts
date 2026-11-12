import type { CheckResult } from './check-result.ts'
import { dockerOutput } from './docker-output.ts'
import type { MachineCommands } from './machine-commands.ts'

const BYTES_PER_GB = 1_073_741_824

const DOCKER_MEMORY_TOLERANCE_GB = 1

const LABEL = 'Memory'

type DockerMemoryOptions = {
  requiredGb: number
  commands: Pick<MachineCommands, 'setup'>
}

function formatGb(bytes: number) {
  return (bytes / BYTES_PER_GB).toFixed(1)
}

export function toDockerMemoryResult(
  memoryBytes: number,
  { requiredGb, commands }: DockerMemoryOptions
): CheckResult {
  if (memoryBytes >= (requiredGb - DOCKER_MEMORY_TOLERANCE_GB) * BYTES_PER_GB) {
    return { label: LABEL, ok: true }
  }

  return {
    label: LABEL,
    ok: false,
    fix: `Docker has ${formatGb(memoryBytes)} GB: ${commands.setup}`
  }
}

export async function checkDockerMemory(
  options: DockerMemoryOptions
): Promise<CheckResult> {
  const memoryBytes = await dockerOutput(['info', '--format', '{{.MemTotal}}'])

  if (memoryBytes === null) {
    return { label: LABEL, ok: false, fix: 'Start the Docker daemon.' }
  }

  return toDockerMemoryResult(Number(memoryBytes.trim()), options)
}
