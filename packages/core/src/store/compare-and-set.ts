type RevisionRow = { revision: string }

export function toCompareAndSetResult([written]: RevisionRow[]) {
  return written
    ? { ok: true as const, revision: written.revision }
    : { ok: false as const, reason: 'conflict' as const }
}
