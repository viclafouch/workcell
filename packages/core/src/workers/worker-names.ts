export function pickFreeName(
  workerNames: readonly string[],
  takenNames: ReadonlySet<string>
) {
  const free = workerNames.filter((name) => {
    return !takenNames.has(name)
  })
  const picked = free[Math.floor(Math.random() * free.length)]

  if (picked === undefined) {
    throw new Error(
      `Every worker name is taken by a live worker: ${[...takenNames].join(', ')}.`
    )
  }

  return picked
}
