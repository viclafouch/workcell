export function timersKeepingTheProcessAlive() {
  return process.getActiveResourcesInfo().filter((type) => {
    return type === 'Timeout'
  }).length
}
