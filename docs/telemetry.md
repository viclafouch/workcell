# Traces

Open the trace viewer of your team to see what each robot did and what it cost.

## See what a robot did

1. Open the trace viewer your team connected.
2. Search for the name of the robot, or for the ticket.
3. Open one of its turns: each step shows as one line, a call to the AI model or an action.

Each turn shows its tokens and its cost in dollars. Add up the turns of a ticket to see what the ticket cost.

A robot can hand one part of its work, such as one side of a review, to a helper that starts from a blank page. Each helper shows as its own steps, marked as a helper, with its own tokens and cost. Today a helper sits beside the turn that started it, not inside it.

## What a trace holds

- **The robot**: its name, its ticket, its code project.
- **The steps**: each call to the AI model, and each action it took.
- **The bill**: the tokens and the cost of each step and of the whole turn.

## What the robot never puts in a trace

- What you asked the robot, or what it answered.
- The content of a file, or the output of a command.
- A password or a key.

## When the viewer is down

The robot keeps working. The agent notes the problem once a minute, and the steps of that time are lost.

Next: open the trace viewer after the robot's next turn, and find its cost.
