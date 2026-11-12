export type CheckResult =
  | { label: string; ok: true }
  | { label: string; ok: false; fix: string }
