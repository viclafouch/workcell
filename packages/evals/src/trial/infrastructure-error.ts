export class InfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'InfrastructureError'
  }
}

export function matchIsInfrastructureError(
  error: unknown
): error is InfrastructureError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'InfrastructureError'
  )
}
