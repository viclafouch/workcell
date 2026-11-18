import { posix } from 'node:path'
import type { SandboxHandle } from '@tanstack/ai-sandbox'

export const WORKSPACE_ROOT = '/workspace'

export function pathInside(root: string, path: string) {
  const full = posix.resolve(root, path)

  if (full !== root && !full.startsWith(`${root}/`)) {
    throw new Error(`The path ${path} is outside the workspace ${root}.`)
  }

  return full
}

const FACTS_SCRIPT = `branch=$(git symbolic-ref --short --quiet HEAD || true)
base=$(git merge-base HEAD "origin/$WORKCELL_BASE_REF" 2>/dev/null || git rev-parse HEAD)
echo "branch=$branch"
echo "diff=$(git diff --shortstat "$base")"
echo "untracked=$(git ls-files --others --exclude-standard | wc -l)"
echo "memory=$(cat /sys/fs/cgroup/memory.current 2>/dev/null)"
echo "memoryMax=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)"`

const FACT_LINE = /^(\w+)=(.*)$/u

export type SandboxFacts = {
  branch: string | undefined
  diff: string
  untrackedFiles: number
  memoryBytes: number | undefined
  memoryMaxBytes: number | undefined
}

function bytesOf(value: string | undefined) {
  const bytes = Number(value)

  return value === undefined || value === '' || !Number.isFinite(bytes)
    ? undefined
    : bytes
}

export async function readSandboxFacts(
  handle: SandboxHandle,
  baseRef: string
): Promise<SandboxFacts> {
  const { exitCode, stdout } = await handle.process.exec(FACTS_SCRIPT, {
    cwd: WORKSPACE_ROOT,
    env: { WORKCELL_BASE_REF: baseRef }
  })

  if (exitCode !== 0) {
    throw new Error(`The sandbox facts script ended with ${exitCode}.`)
  }

  const facts = new Map(
    stdout.split('\n').flatMap((line) => {
      const match = FACT_LINE.exec(line.trim())

      return match?.[1] === undefined ? [] : [[match[1], match[2] ?? '']]
    })
  )

  return {
    branch: facts.get('branch') || undefined,
    diff: facts.get('diff')?.trim() || 'no change',
    untrackedFiles: Number(facts.get('untracked') ?? 0),
    memoryBytes: bytesOf(facts.get('memory')),
    memoryMaxBytes: bytesOf(facts.get('memoryMax'))
  }
}
