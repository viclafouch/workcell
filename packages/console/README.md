# @workcell/console

The read-only page of the host: the queue of the tracker, the running workers, the finished tasks, the bot threads, one live panel per thread, and the feedback of the agents. A TanStack Start app in SPA mode that the host mounts on its operator listener, so it shares the origin of the harness handlers and needs no CORS and no cookie.

## Mount it

A distribution builds the package once, then passes `consoleRoute` of `@workcell/host` to the operator listener of `openHttpLayer`. The host hands the app what it reads through the request context of the server entry: the harness handlers, the worker views, the diff of one worker, the recent feedback, the logger and an optional link to the trace of a thread. The app never reaches the database.

## Bring your design system

The page reads every colour, font, radius and status colour from CSS custom properties, the semantic names of shadcn plus the status and diff tokens of Workcell. `src/theme.css` holds the default theme and is the contract: every token it sets is one a distribution can set.

A distribution passes a brand:

- Its stylesheets, in order. The page loads each one inside `@layer brand`, the last cascade layer of the page, so a token they set always wins and a token they skip keeps its default. A design system that ships its own tokens comes first, then a short stylesheet that maps them onto the names of `src/theme.css`. Colours take `light-dark()` to cover both schemes in one declaration.
- Its logo, which replaces the mark of the sidebar.
- A folder of assets, such as fonts, that the stylesheets reach under `/brand/assets/`.

The name of the brand titles the page. Nothing else changes: the layout, the components and the words stay those of Workcell, so every distribution gets each fix of the page.

## Show where the work happens

A distribution passes the console chat of each chat integration it runs, and the names and pictures of its workers. A conversation of that chat then shows its channel and a link back to it, the author, picture and time of each message, and the face of the bot or the worker that answers. A thread whose chat the distribution does not pass shows the same conversation with plain icons.

The thoughts of a model show once the distribution asks its models for a summary of their reasoning, at the level it already pays for.

## Show the queue and the tickets

A distribution that runs a tracker passes the tracker its integration builds. The page then shows every ticket that waits for a worker, in the order of the tracker, with the cause of each one that cannot start, and the panel of each worker shows the ticket it carries: its title, state, labels, assignee and description. A distribution with no tracker passes none, and the page shows no queue and no ticket.

## Show the pull requests

A distribution passes the pull requests its code host integration reads. The panel of each worker then shows its pull request: its state, its checks, its description, its files, its diff on demand and its merge. The page reads it again each time the watcher of the host records a change of the pull request, never on a timer. A check the token of the host cannot read counts as hidden, and the panel says how many.

## Work on it

`pnpm --filter @workcell/console dev` serves the page on a fixture context: a real worker harness of the core on TanStack's fake model, with no host, no database and no model key. `AGENTS.md` holds the rules of the package.
