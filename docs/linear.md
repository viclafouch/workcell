# Linear

Put the "ready" label of your team on a ticket, and a robot takes it as soon as one is free.

## Hand a ticket to the robot

1. Open a ticket that has not started yet.
2. Add the label your team chose for ready work.
3. Add the label your team set for the code project of the change.
4. Wait for a free robot. The ticket moves to "in progress" on its own: the robot has it.

Your team sets how many robots work at once. When they are all busy, the ticket waits in line, in the order Linear shows by priority, and the next one starts as soon as a robot finishes its task.

The robot then reads the ticket, writes the change, and opens a review page on GitHub. The GitHub page tells what happens next.

## What the robot does in Linear

- **Reads** the ticket, its comments, its project, its milestone and its linked documents.
- **Comments on its own ticket** whenever it needs to, with no question asked.
- **Leaves the rest alone.** It never writes on another ticket, a status or a label.
- **Takes one ticket once.** A ticket never gets two robots, even after a restart.

## When the robot cannot start

The ticket goes back to the state it had. The robot tries it again the next time the agent starts.

## What the robot never does

- Take a ticket without the ready label and a code project label.
- Run more robots at once than your team allows, even when the chat asks for one.
- Edit another ticket, or comment on it.
- Edit a comment, even on its own ticket.
- Guess what a ticket says when Linear is down. It says so instead.

## Watch out

Anyone in your Linear workspace can add the ready label. Each robot spends real money on the AI model. Add the label only to tickets you mean to hand over.

Next: pick a small ticket, add the two labels, and look at it again after the next check: it should say "in progress".
