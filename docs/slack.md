# Slack

Mention the robot in a channel where it is a member, and it answers in the thread.

## Talk to the robot

1. Add the robot to a channel.
2. Mention it in a message.
3. Read its answer as it writes it, in the thread of your message.

A reply in that thread reaches it too, also while it works, and so does a direct message. Each file it reads and each step it takes shows as a card above its answer.

## What the robot answers

- **The code**: it reads the code your team connected, as it is on the main line, and names the files it read. It never builds the code, so it says so when the answer sits in a file that only a build makes.
- **The tickets**: when your team connected Linear, it reads the tickets, and writes nothing there.
- **The review pages**: when your team connected GitHub, it reads a review page, a file on another line of work, and who last changed a file and why. It writes nothing on GitHub.
- **The work**: it tells which robot works on what, right now.
- **New work**: it starts a robot on a task that needs one, such as a ticket to take to a pull request.

## Who the robot answers

- **The people on the allowed list** talk to it in any channel where it is a member. They start, steer and stop work.
- **Everyone else** asks questions in the channels your team opened to it. A request for work gets a short no: only the people on the allowed list start work.
- **Elsewhere**, it stays silent.

## Follow a robot at work

Each robot that works on a task opens its own thread, under its own name and picture, and writes in a few short lines, like a teammate.

1. Open the thread of the robot in the channel your team chose for the work.
2. Read its plan: one list of steps, ticked as the robot goes.
3. Reply in the thread to steer it, or to answer its question.
4. Answer its rare approvals with the buttons: Approve runs the action, Reject refuses it.

A reply wakes a robot that sleeps. The stop button stops the robot at once, also while it waits for you.

## Answer an approval

A robot does its work alone, and it never does the dangerous actions, such as an erase of history on GitHub. It asks you only for an action it cannot judge safe by itself. It then waits, at no cost, until you answer.

1. Read the action in its message, in the thread.
2. Click Approve, then confirm. Or click Reject.
3. Read the decision and its author on the message. The robot goes on.

The buttons show only for the people on the allowed list. An approval waits for its answer across a restart of the robot. A reply in the thread instead of a button refuses the action, with your words as the reason.

## What you see

- **A first message**: the robot greets you with its name, and says what it takes, with the links your team chose, such as its ticket or its review page.
- **A name and a picture** for each robot, drawn at random from the list your team set.
- **A status on the thread**: "working" while the robot thinks, "waiting" when it asks you, "ready" when it waits for you, "closed" when its work is done.
- **A stop button** on the thread, and a "stop" action in the menu of each of its messages.
- **A line at each step of its review page**: checks green, in line to merge, then the report with its link once merged.

## Today

- **Work starts from a ticket or from the lead robot.**
- **Each conversation with the lead robot has a budget** that your team sets. Past it, the robot says so and stops: start a new thread to go on.
- **A question from a robot lists its choices.** Answer with a number, a choice, or your own words.
- **A robot that uses its budget asks before it spends more.** Answer in your own words: the robot reads your answer, then goes on or stops.
- **One button answers every action of a step.** A robot that asks for several actions in one step lists them in one message.

## What the robot never does

- Take work, or a reply, an approval or a stop for a robot at work, from someone outside the allowed list.
- Read a channel it is not a member of.
- Answer a thread it did not join, unless you mention it.
- Answer in a channel shared with another company.
- Change a file in the code it reads, or write in Linear or on GitHub when it answers a question.

Next: hand a small task to the lead robot, then open the thread of its robot and read its plan.
