import { setTimeout } from 'node:timers/promises'
import type { WorkspaceBinder } from '@tanstack/ai-harness/plugins/coding'
import type {
  SandboxDefinition,
  SandboxHandle,
  SandboxInstanceStore
} from '@tanstack/ai-sandbox'
import { sandboxWorkspaceBackend } from '@tanstack/ai-sandbox/harness'
import { startLoop } from '#/host/loop.ts'
import type { LogLine } from '#/host/mcp-server-log.ts'
import { followCurrent } from './follow-current.ts'
import { pathInside, WORKSPACE_ROOT } from './sandbox-facts.ts'
import type { ListSandboxes } from './sandboxes-under-keys.ts'

const LIBRARY_THREAD = 'workcell/library'

const LIBRARY_FOLDER = 'library'

const LIBRARY_ROOT = `${WORKSPACE_ROOT}/${LIBRARY_FOLDER}`

const MAP_COMMAND = `set -eu
cd "$PWD/${LIBRARY_FOLDER}"
for folder in * $MAP_FOLDERS; do
  if [ -d "$folder" ]; then
    printf '%s/: %s\\n' "$folder" "$(ls -1 "$folder" | paste -sd ' ' -)"
  fi
done`

const PULL_COMMAND = `set -eu
library="$PWD/${LIBRARY_FOLDER}"
pulls="$PWD/.library-pulls"
git_dir="$pulls/$REPOSITORY_FOLDER.git"
live="$library/$REPOSITORY_FOLDER"
next="$pulls/$REPOSITORY_FOLDER.next"
old="$pulls/$REPOSITORY_FOLDER.old"
archive="$pulls/$REPOSITORY_FOLDER.tar"
pulled="$pulls/$REPOSITORY_FOLDER.commit"
mkdir -p "$library" "$pulls"
[ -d "$git_dir" ] || git init --quiet --bare "$git_dir"
git -C "$git_dir" fetch --quiet --depth 1 --no-tags "$REPOSITORY_URL" "+refs/heads/$REPOSITORY_REF:refs/heads/library"
commit=$(git -C "$git_dir" rev-parse refs/heads/library)
if [ -d "$live" ] && [ "$(cat "$pulled" 2>/dev/null)" = "$commit" ]; then
  exit 0
fi
for tree in "$next" "$old"; do
  if [ -e "$tree" ]; then
    chmod -R u+w "$tree"
    rm -rf "$tree"
  fi
done
git -C "$git_dir" archive --output="$archive" "$commit"
mkdir "$next"
tar -x -f "$archive" -C "$next"
rm "$archive"
chmod -R a-w "$next"
trap 'chmod a-w "$library"' EXIT
chmod u+w "$library"
if [ -e "$live" ]; then
  chmod u+w "$live"
  mv "$live" "$old"
fi
chmod u+w "$next"
mv "$next" "$live"
chmod a-w "$live"
echo "$commit" > "$pulled"
echo "$commit"`

type LibraryRepository = { url: string; ref: string }

export type LibraryRepositories = Readonly<Record<string, LibraryRepository>>

type LibraryLog = Record<'info' | 'warn' | 'error', LogLine>

type LibraryLogger = {
  child: (bindings: Record<string, unknown>) => LibraryLog
}

type CreateLibrarySandboxParams = {
  sandbox: SandboxDefinition
  repositories: LibraryRepositories
  pullIntervalMs: number
  listSandboxes: ListSandboxes
  instances: SandboxInstanceStore
  logger: LibraryLogger
  mapFolders?: readonly string[]
}

export function createLibrarySandbox({
  sandbox,
  repositories,
  mapFolders = [],
  pullIntervalMs,
  listSandboxes,
  instances,
  logger
}: CreateLibrarySandboxParams) {
  const log = logger.child({ module: 'library' })
  const context = {
    threadId: LIBRARY_THREAD,
    runId: LIBRARY_THREAD,
    store: instances
  }
  const key = sandbox.key(context)
  let current: SandboxHandle | null = null
  let pulling: Promise<SandboxHandle> | null = null
  let runSignal: AbortSignal | null = null
  let map = ''

  const logBound = (handle: SandboxHandle, path: string) => {
    log.info({ sandboxId: handle.id, path }, 'library sandbox bound')
  }

  const openLive = async () => {
    const resumed = await sandbox.ensureExisting(context)
    const handle = resumed ?? (await sandbox.ensure(context))
    logBound(handle, resumed === null ? 'fresh sandbox' : 'reattach')

    return handle
  }

  const liveLibrary = async () => {
    if (current === null) {
      return openLive()
    }

    const { id } = current
    const listed = await listSandboxes()

    if (
      listed.some((candidate) => {
        return candidate.id === id
      })
    ) {
      return current
    }

    log.warn({ sandboxId: id }, 'library sandbox gone')

    return openLive()
  }

  const pullRepository = async (
    handle: SandboxHandle,
    [folder, { url, ref }]: [string, LibraryRepository],
    signal?: AbortSignal
  ) => {
    const { exitCode, stdout, stderr } = await handle.process.exec(
      PULL_COMMAND,
      {
        env: {
          REPOSITORY_FOLDER: folder,
          REPOSITORY_URL: url,
          REPOSITORY_REF: ref
        },
        signal
      }
    )

    if (exitCode !== 0) {
      log.error({ folder, ref, stderr: stderr.trim() }, 'library not pulled')

      return
    }

    const commit = stdout.trim()

    if (commit !== '') {
      log.info({ folder, ref, commit }, 'library pulled')
    }
  }

  const readMap = async (handle: SandboxHandle, signal?: AbortSignal) => {
    const { exitCode, stdout, stderr } = await handle.process.exec(
      MAP_COMMAND,
      { env: { MAP_FOLDERS: mapFolders.join(' ') }, signal }
    )

    if (exitCode !== 0) {
      log.error({ stderr: stderr.trim() }, 'library map not read')

      return
    }

    map = stdout.trim()
  }

  const pullAll = async (signal?: AbortSignal) => {
    const handle = await liveLibrary()

    for (const repository of Object.entries(repositories)) {
      signal?.throwIfAborted()
      // oxlint-disable-next-line no-await-in-loop -- the pulls share one sandbox and stop on abort
      await pullRepository(handle, repository, signal)
    }

    signal?.throwIfAborted()
    await readMap(handle, signal)
    current = handle

    return handle
  }

  const pullOnce = (signal?: AbortSignal) => {
    pulling ??= (async () => {
      try {
        return await pullAll(signal)
      } finally {
        pulling = null
      }
    })()

    return pulling
  }

  const run = async (signal: AbortSignal) => {
    runSignal = signal

    while (!signal.aborted) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- the poll pulls once per interval
        await pullOnce(signal)
      } catch (error) {
        if (!signal.aborted) {
          log.error({ error }, 'library pull failed')
        }
      }

      // oxlint-disable-next-line no-await-in-loop -- the poll waits between two pulls
      await setTimeout(pullIntervalMs, null, { signal }).catch(() => {
        return null
      })
    }
  }

  const libraryForQuestions = async () => {
    if (current !== null) {
      return current
    }

    const resumed = await sandbox.ensureExisting(context)

    if (resumed === null) {
      return pullOnce(runSignal ?? undefined)
    }

    logBound(resumed, 'reattach')
    current ??= resumed

    return current
  }

  const bind = async () => {
    const library = await libraryForQuestions()
    let bound = { handle: library, backend: sandboxWorkspaceBackend(library) }

    return followCurrent(LIBRARY_ROOT, () => {
      const handle = current ?? library

      if (handle !== bound.handle) {
        bound = { handle, backend: sandboxWorkspaceBackend(handle) }
      }

      return bound.backend
    })
  }

  const workspace: WorkspaceBinder = { bind, reattach: bind }

  return {
    key,
    root: LIBRARY_ROOT,
    workspace,
    map: () => {
      return map
    },
    pullOnce,
    readFile: async (path: string) => {
      const library = await libraryForQuestions()

      return sandboxWorkspaceBackend(library).readFile(
        pathInside(LIBRARY_ROOT, path)
      )
    },
    start: () => {
      return startLoop(run)
    }
  }
}
