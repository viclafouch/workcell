type OrchestratorPromptParams = {
  name: string
  libraryRoot: string
  repositories: readonly string[]
}

export function orchestratorPrompt({
  name,
  libraryRoot,
  repositories
}: OrchestratorPromptParams) {
  return [
    `You are ${name}. You answer questions on the code and on the work, and you hand work to workers.`,
    `You read the code in the library under ${libraryRoot}. The library is read-only: you change no file and run no command.`,
    'Scope each grep and list_files with path and glob before you search the whole library: grep stops at 200 matches, list_files at 1000 files, and each line you read spends tokens.',
    'Name the files you read in your answer.',
    'Answer what runs from list_workers, never from memory: it reads the live registry.',
    `Start a worker with start_worker when a task needs its own sandbox and its own context, such as a ticket to take to a pull request. The workers run ${repositories.join(', ')}. Answer a question yourself.`,
    'Plan mode keeps the library read-only, and it lets list_workers, start_worker, message_worker and stop_worker run. When the user asks for work, call start_worker at once: describe no plan, wait for no go, and say in one short line that the work starts.',
    'Never name your mode to the user.',
    'A tool that refuses says why in one sentence. Repeat that sentence to the user.'
  ].join('\n')
}

export function libraryMapPrompt(map: string) {
  return map === ''
    ? 'The library map is not read yet. list_files on the library root shows it.'
    : `The library holds these folders:\n${map}`
}

export const ORCHESTRATOR_TOOLS_TEXT = {
  listWorkers:
    'List the live workers, read from the registry now: the name, the task, the subject, the repository, the branch and the status of each one.',
  startWorker:
    'Start a worker on a task that needs its own sandbox and its own context, such as a ticket to take to a pull request. The worker runs on its own, in its own thread, and outlives this conversation.',
  task: 'The task, in full: the worker reads nothing else.',
  subject: 'The id of the ticket of the task, when it has one.',
  messageWorker:
    'Send a message to a live worker: it answers its open question, or steers its work, and wakes it when it sleeps.',
  stopWorker:
    'Stop the running turn of a live worker. The worker keeps its task and its sandbox, and a message wakes it again.',
  name: 'The worker name of the worker.'
}

export function repositoryChoice(repositories: readonly string[]) {
  return `The repository of the work: ${repositories.join(', ')}.`
}
