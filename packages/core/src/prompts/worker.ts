export function repositoryRulesPrompt(root: string) {
  return `The clone of the repository is ${root}. Before your first change, read its AGENTS.md and CLAUDE.md with read_file, and follow them.`
}

export function workerIdentityPrompt(name: string) {
  return `You are the worker ${name}. End each commit message with the trailer of your co-author line: git commit -m "Fix the login" -m "Co-Authored-By: ${name} $CO_AUTHOR_EMAIL". Name ${name} in the body of each pull request you open.`
}

export function branchFact(branch: string) {
  return `The branch of this task: ${branch}.`
}

export function shallowCloneFact(depth: number) {
  const commits = depth === 1 ? 'the last commit' : `the last ${depth} commits`

  return `The clone holds ${commits} of one branch. Fetch another branch or older commits with a depth: git fetch --depth <n> origin <branch>, or git fetch --deepen <n>. A fetch with no depth pulls the whole history: on a large repository it takes minutes, so give its bash call a timeoutMs of 600000.`
}

export const FINISH_TASK_TEXT = {
  description:
    'End the task for good, only in the turn of a message where a person tells you to stop. A task that needs no change, or names the wrong target, is a question for a person: ask whether to close it, retarget it or go on, then end your turn and wait for the answer. It posts your report when you give one, archives this worker and destroys its sandbox. Your turn ends right after it. Before you call it, if a tool, a skill or a limit got in your way during this task and you did not report it yet, report it once with send_feedback.',
  report:
    'A line in the thread, right under your last lines, that the person reads as any other line of yours: only what they have not read yet, such as the link of the pull request. Leave it out when your lines said it all, and the thread closes with no report.',
  outcome:
    'How the task ends: blocked when you stop with the work undone, such as when you give up, reach your budget, or a person stops you; manual when a person takes the work over and finishes it by hand.',
  cause:
    'Why the task ends here, in one line a person reads later: what blocked you, or what the person said.'
}

export const SUBAGENT_TEXT = {
  description:
    'Run one task in a fresh context, such as one axis of a review that a skill asks for: the subagent reads the task you write and nothing else of this conversation, works with your tools in your sandbox, and its answer comes back as the result. Call it several times in one turn to run tasks in parallel.',
  task: 'The whole task, self-contained: what to do, the commands, files and rules it needs, and what to answer. The subagent sees only this text.',
  noTurn:
    'The subagent stopped: the host restarted, and the tools of your turn are gone. Call it again.'
}

export const FILES_ANSWER =
  'The person answered with files: they reach you in the next message.'

export const FINISH_WITHOUT_STOP_REFUSAL =
  'No person told you to stop, so the task goes on. Ask your question to a person and end your turn: their answer reaches you as a new message. Call finish_task only in the turn of the message that tells you to stop.'

export function budgetAnswerPrompt(question: string, answer: string) {
  return `You stopped at your budget and asked: ${question}\nThe answer: ${answer}\nGo on only if the answer asks you to, and follow what it says. If it drops the task, call finish_task with the outcome blocked and your budget as its cause. Otherwise end your turn now, with no tool call.`
}

export const ROOT_DENIAL_REASON =
  'The sandbox gives no root and no Docker: run the command without sudo or docker, or ask a person when the task needs them.'

export const PUSH_DENIAL_REASON =
  'Push only the branch of your task, by its name, with no force and no delete: git push origin <your-branch>.'
