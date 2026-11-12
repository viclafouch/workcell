# Writing the docs

Every page in `docs/` explains what the agent can do with one tool: GitHub, Linear, Slack, the trace viewer. One tool, one page.

The docs are open source. They describe what the agent can do for any team that runs Workcell.

## The reader

The reader is a vibe coder. They build things by talking to an AI. They have never worked as a developer. They have ADHD.

- They know the tools by their screens: a Linear ticket, a GitHub pull request, a Slack message.
- They do not know the words behind the screens: no API, no token, no branch protection, no webhook.
- They read the first line, maybe the last line, and skim the rest.
- They forget what is not on the screen.

## How a page reads

1. **The first line is what the reader can do now.** An action, not an introduction.
2. **Plain words only.** Name each thing by what the reader sees on their screen. "The robot" for a worker, "a closed box" for a sandbox, "the review page" for a pull request, the first time at least.
3. **Zero code.** No command, no file path, no setting name, no code block.
4. **Steps are numbered.** One action per step, the fewest steps that work.
5. **Lists hold five items at most.** A longer list splits into "Today" and "Coming".
6. **Times are moments the reader sees**, such as "at the next check" or "once a person merges".
7. **Each page names what the robot never does**, in its own short section, so the reader knows the safe limits.
8. **The last line is one next thing to try**, small enough to do in two minutes.

## Keep it true

A page holds only what stays true when the settings change. Each value that a team sets stays out of the page: a label name, a project or repository name, a channel, a person, a bot, a check name, a delay, a budget. Write the role instead: "the label your team chose for ready work", "the projects your team connected".

A page describes what runs today. A planned feature goes under "Coming", with no date. When the behaviour changes, the page changes in the same commit.
