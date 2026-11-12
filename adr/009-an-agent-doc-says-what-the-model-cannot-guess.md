# ADR 009 – An Agent Doc Says What the Model Cannot Guess

## Status

Accepted

## Context

An **agent doc** is a file that only a model reads: a `SKILL.md` and its sibling files, an `AGENTS.md`, a file of `.claude/`.

The model reads each line of an agent doc in each session that loads the doc. A line that the model does not need still fills the context, and the model then follows the other lines less.

The measures agree:

- Chroma measured that the performance of the tested models drops as the input grows.
- IFScale measured that the best frontier models follow 68% of 500 instructions given at once.
- Gloaguen et al. measured that a context file adds over 20% of inference cost and does not raise the success rate in general.
- Claude Code targets fewer than 200 lines for each `CLAUDE.md`, because a longer file lowers the adherence.

[ADR 003](./003-coding-standards-as-a-review-baseline.md) keeps the coding standards out of the context of the implementer. [ADR 007](./007-oxlint-before-the-coding-standards.md) moves each mechanical convention to oxlint. Neither ADR says which lines an agent doc keeps.

## Decision

### 1. A line stays when the model gets the task wrong without it

Ask for each line the question of the Claude Code docs: "Would removing this cause Claude to make mistakes?" When the answer is no, delete the line. When the answer is unsure, the line stays.

A line keeps its place when it says one of these:

1. A choice of the team: a pick, a constraint, a trade-off.
2. A fact of the repository: a path, a script, a workflow.
3. A gotcha that the code does not show.
4. A correction of a default of the model: an idiom newer than its training data, or a mistake that the model makes.

A practice that the model applies by default goes, such as "write clean code" or "prefer composition". A copy of a library doc becomes a link to the doc.

**Rationale**: the model has read the docs of the libraries and the common practice. The agent doc gives what the model cannot read: the project. Gloaguen et al. find a context file useful for a coding practice that is not standard. Vercel measured the case of item 4: a docs index for the APIs of Next.js 16, absent from the training data, took the pass rate from 53% to 100%.

### 2. A correction starts from a mistake that someone saw

A correction of a default names a mistake that a review, a pull request comment or a session showed. A mistake that nobody saw gets no line.

The correction follows ADR 007 first: an oxlint rule when a rule can express it, a line when no rule can. The pull request that adds the line names the mistake.

**Rationale**: each line costs context in each session. A guess at a mistake costs that context and maybe prevents nothing. Anthropic gives the same order for a skill: solve the problems that an eval shows, not the problems that someone imagines. A check also beats a line, because a line is advisory and a check runs each time.

### 3. A skill holds a workflow that the model does not follow by default

A skill gives the steps, the tools, the paths and the picks of the team for one task. A skill that teaches a practice that the model already applies gets no place. A rule that each task needs stays in an `AGENTS.md`.

**Rationale**: a skill loads its whole text when it triggers. A skill of common practice fills the context as a long `AGENTS.md` does. A skill can also miss its trigger: in the evals of Vercel, the agent never invoked the skill in 56% of the cases.

## Considered options

- **Write each good practice down, as a safety net**: the context fills, and the model follows each line less.
- **Let the memory of each tool log the corrections**: the auto memory of Claude Code stays on one machine, and other tools do not read it. The repository is the memory that each developer and each tool reads.
- **Prove each line with an eval**: an eval runs the task with and without the line. It costs one run for each line and each model, so the review of the pull request decides instead.

## Consequences

**The agent docs get shorter.** Each agent doc passes the test. A doubtful line stays until the next edit of its file, and that edit decides.

**A new model changes the answer.** A correction of an old default goes when the new model gets the task right without it. A new mistake of the new model gets its line.

**The review applies the test.** For each line that a diff adds to an agent doc, the review asks the question of decision 1.

## Sources

The context costs adherence:

- Hong, Troynikov and Huber (Chroma), [Context Rot](https://research.trychroma.com/context-rot): "model performance degrades as input length increases, often in surprising and non-uniform ways."
- Jaroslawicz et al., [How Many Instructions Can LLMs Follow at Once?](https://arxiv.org/abs/2507.11538): "even the best frontier models only achieve 68% accuracy at the max density of 500 instructions."
- Gloaguen et al., [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988): "providing context files does not generally improve task success rates, while increasing inference cost by over 20% on average." The same paper: "context files are useful for specifying non-standard coding practices".
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): "finding the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome."
- Claude Code, [memory](https://code.claude.com/docs/en/memory.md): "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence."

A line says what the model cannot guess:

- Claude Code, [best practices](https://code.claude.com/docs/en/best-practices.md): "For each line, ask: 'Would removing this cause Claude to make mistakes?' If not, cut it." Its exclude list holds "Self-evident practices like 'write clean code'".
- Anthropic, [skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md): "Claude is already very smart. Only add context Claude doesn't already have." The same page: "This ensures your Skill solves real problems rather than documenting imagined ones."
- Vercel, [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals): "Next.js 16 introduces APIs like 'use cache', connection(), and forbidden() that aren't in current model training data." The same post: "In 56% of eval cases, the skill was never invoked."

A skill holds the knowledge of the team:

- Anthropic, [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills): "real work requires procedural knowledge and organizational context."

A check beats a line:

- Claude Code, [best practices](https://code.claude.com/docs/en/best-practices.md): "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens."
- HumanLayer, [Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md): "Never send an LLM to do a linter's job."
- Armen Vardanyan, [the thread on coding agent setups](https://x.com/Armandotrue/status/2112152240324812831): an agent doc gives the context of the project, and a lint rule checks the output.

## Other pages

- [ADR 003 – Coding Standards Are a Review Baseline](./003-coding-standards-as-a-review-baseline.md)
- [ADR 007 – oxlint Before the Coding Standards](./007-oxlint-before-the-coding-standards.md)
