const BYTES_PER_MEGABYTE = 1_048_576

export function megabytesOf(bytes: number) {
  return Math.round(bytes / BYTES_PER_MEGABYTE)
}
