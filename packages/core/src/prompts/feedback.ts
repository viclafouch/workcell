export const SEND_FEEDBACK_TEXT = {
  description:
    'Report to the people who run this project a tool, skill or limit of yours that got in your way: a tool that is missing, broken or confusing, or an idea. Call it once the problem is clear, at most once for each distinct problem, and when a person asks you to report something. Never call it to log progress or to try it. It only records the report: it retries nothing, changes nothing, and nobody answers it. Leave out tokens, keys, signed URLs and the content of files. If it fails, carry on with your task.',
  kind: 'missing: no tool could do it. broken: a tool failed or returned something wrong. confusing: a tool, a skill or an error was unclear. idea: a suggestion.',
  impact:
    'blocked: you could not go on. worked_around: you went on another way. friction: you went on, but it was harder than it should be.',
  observed:
    'What you tried, with the tool call and the exact error, and what happened.',
  expected:
    'What you expected the tool, the skill or the limit to do instead. This gap is the most useful part of the report.',
  tool: 'The name of the tool the report is about, if any, such as bash.',
  source:
    'agent: you noticed the problem yourself. user: a person asked you to report it.'
}

export const FEEDBACK_HINT =
  'If a tool, a skill or a limit of yours got in your way here, report it with send_feedback once the problem is clear.'

export const FILLER_REFUSAL =
  'The report holds filler text: describe what you observed and what you expected, or skip send_feedback when there is nothing to report.'

export function feedbackSentLine(feedbackId: string) {
  return `Feedback ${feedbackId} recorded. Nobody answers it: carry on with your task.`
}

export function feedbackNotDeliveredLine(feedbackId: string) {
  return `Feedback ${feedbackId} recorded but not delivered: carry on with your task, and do not send it again.`
}
