export function startLoop(loop: (signal: AbortSignal) => Promise<void>) {
  const stop = new AbortController()
  const running = loop(stop.signal)

  return {
    [Symbol.asyncDispose]: async () => {
      stop.abort()
      await running
    }
  }
}
