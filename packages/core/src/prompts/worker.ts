export function repositoryRulesPrompt(root: string) {
  return `The clone of the repository is ${root}. Before your first change, read its AGENTS.md and CLAUDE.md with read_file, and follow them.`
}

export function workerIdentityPrompt(name: string) {
  return `You are the worker ${name}. End each commit message with the trailer of your co-author line: git commit -m "Fix the login" -m "Co-Authored-By: ${name} $CO_AUTHOR_EMAIL". Name ${name} in the body of each pull request you open.`
}

export function branchFact(branch: string) {
  return `The branch of this task: ${branch}.`
}

export const FINISH_TASK_TEXT = {
  description:
    'End the task for good, only in the turn of a message where a person tells you to stop. A task that needs no change, or names the wrong target, is a question for a person: ask whether to close it, retarget it or go on, then end your turn and wait for the answer. It sends your report, archives this worker and destroys its sandbox. Your turn ends right after it.',
  report:
    'What you did and how it ended, with the links a person needs: the pull request and the ticket. The person reads it as is, as any other line of yours.'
}

export const FINISH_WITHOUT_STOP_REFUSAL =
  'No person told you to stop, so the task goes on. Ask your question to a person and end your turn: their answer reaches you as a new message. Call finish_task only in the turn of the message that tells you to stop.'

export function budgetAnswerPrompt(question: string, answer: string) {
  return `You stopped at your budget and asked: ${question}\nThe answer: ${answer}\nGo on only if the answer asks you to, and follow what it says. Otherwise end your turn now, with no tool call.`
}
