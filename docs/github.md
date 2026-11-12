# GitHub

Leave a comment on the review page that a robot opened: the robot reads it at the next check and acts on it.

## What the robot does on GitHub

1. **Copies the project** into its own closed box, away from your computer.
2. **Writes the change** on its own line of work.
3. **Saves the change** under the name of the person who runs the agent, with a line that says a robot helped.
4. **Opens a review page** (a pull request), and names itself in the summary of the page.
5. **Stays on that page** until a person merges it.

## Ask the lead robot about GitHub

Mention the lead robot in Slack, and ask about a review page or a file.

- **"What does review page 42 change?"**: it lists the changed files, then reads the change of each file you ask about.
- **"Who last changed this file, and why?"**: it lists the latest changes of the file, each with its author and its review page.
- **A file on another line of work**: it reads the file as it is on that line. It reads a long file one part at a time, so it sees every line.

It only reads, and only the projects your team connected. It says no to any other project.

## The robot wakes up on its own

The agent looks at the review page of each robot at every check. Each event wakes the robot once, even after a restart:

| What happens on the page | What the robot does |
| --- | --- |
| A check goes red | Fixes it, or asks you a question when it cannot |
| Someone leaves a comment or a review | Fixes the code, or answers |
| The page conflicts with the latest version of the project | Brings in the latest version and solves the conflict |
| The review rule your team named waits for an owner | Tells you which owner it waits for |
| The page leaves the merge queue | Fixes what made it leave |

A comment on a spot of the change, from a person or a review bot, wakes the robot too. The robot reads the conversation of that spot: the file, the place in the file, who wrote it, and the answers below it. It answers in that conversation, under the name of the person who runs the agent, then marks the conversation resolved once its fix is on the page.

Three events need no robot: the agent handles them itself, so they cost nothing.

- **All the checks of the page turn green**: the agent says so in the thread of the robot, with the link, once for each new version of the page. The page then waits for a person.
- **The page enters the merge queue**: the agent says so in the thread of the robot, with the link.
- **A person merges the page**: the agent posts a short report with the link of the page, and closes the box of the robot for good.

## What the robot skips

- The comments of the GitHub account the robot itself uses.
- The comments and reviews of bots. A bot comment on a spot of the change still wakes the robot.
- A review with no text that asks for no change.

## What the robot never does

- Send its change to the main lines of the project. It works on its own line only.
- Erase history on GitHub.
- Delete a line of work on GitHub.
- Answer a conversation of another review page.
- Write on GitHub for a question you ask the lead robot.

Your team can refuse more actions, such as a merge. A person then always merges.

Next: open the review page of a running robot and read its summary.
