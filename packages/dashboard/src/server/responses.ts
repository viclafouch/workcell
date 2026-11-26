const NOT_FOUND = 404

const METHOD_NOT_ALLOWED = 405

export const READ_METHODS = ['GET', 'HEAD']

export const notFound = () => {
  return new Response(null, { status: NOT_FOUND })
}

export const methodNotAllowed = () => {
  return new Response(null, {
    status: METHOD_NOT_ALLOWED,
    headers: { allow: READ_METHODS.join(', ') }
  })
}
