const FILE_HEADER = 'diff --git '

const NEW_PATH = /^\+\+\+ (?:b\/)?(?<path>.+)$/mu

const HEADER_PATHS = /^diff --git a\/(?<from>.+) b\/(?<to>.+)$/mu

export type FilePatch = {
  path: string
  patch: string
}

const pathOfPatch = (patch: string) => {
  const newPath = NEW_PATH.exec(patch)?.groups?.path

  if (newPath !== undefined && newPath !== '/dev/null') {
    return newPath
  }

  return HEADER_PATHS.exec(patch)?.groups?.from ?? 'Unnamed file'
}

export const splitPatchByFile = (patch: string): FilePatch[] => {
  return patch
    .split(new RegExp(`^(?=${FILE_HEADER})`, 'mu'))
    .filter((part) => {
      return part.startsWith(FILE_HEADER)
    })
    .map((part) => {
      return { path: pathOfPatch(part), patch: part }
    })
}
