import type { SandboxHandle } from '@tanstack/ai-sandbox'
import { WORKSPACE_ROOT } from '#/workers/harness.ts'

const BUNDLE = '.git/workcell-changes.bundle'

const CHANGES_REF = 'refs/workcell/changes'

const BRANCH_LINE = /^branch=(.*)$/mu

const BYTES_LINE = /^bytes=\s*(\d+)$/mu

const PREREQUISITE_LINE = /^-([0-9a-f]{40,64})\b/u

const BUNDLE_HEADER_END = '\n\n'

const BYTES_PER_MEBIBYTE = 1_048_576

const MAX_BUNDLE_MEBIBYTES = 8

const MAX_BUNDLE_BYTES = MAX_BUNDLE_MEBIBYTES * BYTES_PER_MEBIBYTE

const CAPTURE_ENV = {
  GIT_AUTHOR_NAME: 'workcell',
  GIT_AUTHOR_EMAIL: 'workcell@localhost',
  GIT_COMMITTER_NAME: 'workcell',
  GIT_COMMITTER_EMAIL: 'workcell@localhost',
  GIT_TERMINAL_PROMPT: '0'
}

const CAPTURE_SCRIPT = `set -eu
git rev-parse --verify --quiet HEAD >/dev/null || exit 0
branch=$(git symbolic-ref --short --quiet HEAD || true)
if [ -n "$branch" ] && remote=$(git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 ls-remote origin "refs/heads/$branch" 2>/dev/null); then
  pushed=$(printf '%s' "$remote" | cut -f1)
  if [ -z "$pushed" ]; then
    git update-ref -d "refs/remotes/origin/$branch"
  elif git cat-file -e "$pushed^{commit}" 2>/dev/null; then
    git update-ref "refs/remotes/origin/$branch" "$pushed"
  fi
fi
head=$(git rev-parse HEAD)
index=$(git rev-parse --git-path workcell-changes.index)
rm -f "$index"
GIT_INDEX_FILE="$index" git read-tree "$head"
GIT_INDEX_FILE="$index" git add --all
tree=$(GIT_INDEX_FILE="$index" git write-tree)
rm -f "$index"
changes=$(git commit-tree "$tree" -p "$head" -m "workcell: the uncommitted changes")
git update-ref ${CHANGES_REF} "$changes"
git bundle create --quiet ${BUNDLE} ${CHANGES_REF} --not --remotes
bytes=$(wc -c < ${BUNDLE})
echo "branch=$branch"
echo "bytes=$bytes"`

const UNPUSHED_PATCH_COMMAND = `git log --patch --cc --text --format=%B ${CHANGES_REF} --not --remotes`

const DISCARD_COMMAND = `git update-ref -d ${CHANGES_REF} && rm -f ${BUNDLE}`

const RESTORE_SCRIPT = `set -eu
for commit in $WORKCELL_PREREQUISITES; do
  git cat-file -e "$commit^{commit}" 2>/dev/null || git fetch --quiet --no-tags --depth=1 origin "$commit"
done
git fetch --quiet --no-tags ${BUNDLE} ${CHANGES_REF}:${CHANGES_REF}
if [ -n "$WORKCELL_BRANCH" ]; then
  git checkout --quiet -B "$WORKCELL_BRANCH" ${CHANGES_REF}
else
  git checkout --quiet --detach ${CHANGES_REF}
fi
git reset --quiet HEAD~1
git update-ref -d ${CHANGES_REF}
rm -f ${BUNDLE}`

export type SavedChanges = {
  branch: string | undefined
  bundle: Uint8Array
}

export type WorkerChanges = {
  save: (threadId: string, changes: SavedChanges) => Promise<void>
  load: (threadId: string) => Promise<SavedChanges | undefined>
  remove: (threadId: string) => Promise<void>
}

type CapturedChanges = SavedChanges & { patch: string }

async function run(
  handle: SandboxHandle,
  command: string,
  env: Record<string, string> = {}
) {
  const { exitCode, stdout, stderr } = await handle.process.exec(command, {
    cwd: WORKSPACE_ROOT,
    env
  })

  if (exitCode !== 0) {
    throw new Error(`The git command failed with the exit code ${exitCode}.`, {
      cause: stderr.trim()
    })
  }

  return stdout
}

function prerequisitesOf(bundle: Uint8Array) {
  const text = new TextDecoder().decode(bundle)
  const header = text.slice(0, text.indexOf(BUNDLE_HEADER_END))

  return header.split('\n').flatMap((line) => {
    const commit = PREREQUISITE_LINE.exec(line)?.[1]

    return commit === undefined ? [] : [commit]
  })
}

export async function captureChanges(
  handle: SandboxHandle
): Promise<CapturedChanges | null> {
  const output = await run(handle, CAPTURE_SCRIPT, CAPTURE_ENV)
  const branchLine = BRANCH_LINE.exec(output)

  if (branchLine === null) {
    return null
  }

  try {
    const bytes = Number(BYTES_LINE.exec(output)?.[1])

    if (bytes > MAX_BUNDLE_BYTES) {
      throw new Error(
        `The changes weigh ${bytes} bytes, above the limit of ${MAX_BUNDLE_BYTES} bytes.`
      )
    }

    const [bundle, patch] = await Promise.all([
      handle.fs.readBytes(`${WORKSPACE_ROOT}/${BUNDLE}`),
      run(handle, UNPUSHED_PATCH_COMMAND)
    ])

    return { branch: branchLine[1] || undefined, bundle, patch }
  } finally {
    await run(handle, DISCARD_COMMAND)
  }
}

export async function restoreChanges(
  handle: SandboxHandle,
  { branch, bundle }: SavedChanges
) {
  await handle.fs.write(`${WORKSPACE_ROOT}/${BUNDLE}`, bundle)
  await run(handle, RESTORE_SCRIPT, {
    WORKCELL_PREREQUISITES: prerequisitesOf(bundle).join(' '),
    WORKCELL_BRANCH: branch ?? '',
    GIT_TERMINAL_PROMPT: '0'
  })
}
