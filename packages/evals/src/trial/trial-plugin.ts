import { definePlugin } from '@tanstack/ai-harness'
import { commandDenialItems, denyCommands } from '@workcell/core'

const TRIAL_DENIAL_REASON =
  'This task is a trial of the eval set: it never reaches the remote nor the tracker. Work on the files and the commits of this copy, and end your turn once the change is ready.'

const REMOTE_COMMANDS = [
  'git push',
  'git push *',
  'git fetch',
  'git fetch *',
  'git pull',
  'git pull *',
  'git remote *',
  'git clone *',
  'git -* push*',
  'git -* fetch*',
  'git -* pull*',
  'git ls-remote*',
  'git fsck*',
  'git cat-file *--batch-all-objects*',
  'gh',
  'gh *'
]

const TRIAL_PROMPT =
  'This task is a trial of the eval set. Nobody watches it and nobody answers a question: decide on your own, and end your turn with a short report once the change is ready in this copy of the repository. The remote is out of reach, so open no pull request.'

export const trialPlugin = definePlugin({
  name: 'workcell/trial',
  setup: () => {
    return {
      prompts: [{ id: 'workcell/trial', text: TRIAL_PROMPT }],
      contribute: commandDenialItems(
        denyCommands(TRIAL_DENIAL_REASON, REMOTE_COMMANDS)
      )
    }
  }
})
