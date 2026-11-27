<!-- intent-skills:start -->
## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `pnpm exec intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm exec intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# @workcell/dashboard

The read-only page of the host, a TanStack Start app in SPA mode. `../../AGENTS.md` holds the rules of Workcell, `README.md` how a distribution mounts and brands the page. This file holds what a change of the page follows.

## The page reads only

- Steering stays in the chat and over MCP, where the code checks the starter. A route answers `GET` alone, and the harness route refuses `describe`, the read that opens a session and mounts its plugins.
- The page reads what the host hands it through the request context of the server entry, never the database. A server function opens on its verb and reads the context, a query option is its function name plus `QueryOpts`.
- A list refreshes on a status change of the host events, never on a timer. A live panel keeps its stream while its tab is hidden, closes it once its thread sleeps, and opens it again when the thread wakes. A new stream replaces the shown one only once it is ready, so the panel never empties.
- A read that needs a sandbox reads one sandbox, on demand. A list never reads a sandbox per worker.

## The theme decides

`src/theme.css` is the contract a distribution brands, `src/styles.css` the design system built on it. Every colour, size, radius, duration, easing and z-index is a named token there, and a component composes tokens, utilities and the primitives of the components layer. A value a component misses joins the theme first. A status shows through `data-status` and the status tokens, never through a colour picked in a component.

A new token that a distribution could want to change goes in `src/theme.css`, under the semantic name shadcn uses when one exists. The cascade layers are declared once, `brand` last, so a brand stylesheet never fights specificity.

## The shell

The app is a shell that grows: a sidebar, a header and one page per route. A new section is a route under `_app` plus one entry of the navigation config in `src/constants/navigation.ts`, and an idea not built yet sits in its coming list. A route names its place in the header with `staticData`: its section, and its crumb, or a `crumb` its loader returns when the name comes from data. A page renders a `div`, since the shell holds the one `main` of the page.

## Components

The shadcn components on Base UI live in `src/components/ui/`, added with the shadcn CLI and the style of `components.json`, and stay as the CLI writes them. Their `cn` import resolves to the class merge that the cn Vite plugin builds from the `@theme` of the stylesheet, so a size or a radius of the theme merges like a Tailwind one. A raw form control, button or table is a lint error: reach for its shadcn component. TanStack libraries come first: Table for a table, Store for live state, Query for every read, Pacer for pacing. Markdown, code and diffs are the one exception: Words, Highlights and Diffs from Pierre colour a code block while it streams and share one engine and one theme across the chat and the diffs, which no TanStack library does.

## Files

A domain names the same slice in each layer: `src/components/<domain>`, `src/queries/<domain>.ts`, `src/server/<domain>.functions.ts`. Code one route uses sits beside it in a `-components` folder. The lint config says where each kind of file lives.

## Motion and browsers

CSS carries every motion it can, and motion answers a change the person can see. The browser floor is the build target in `vite.config.ts`, the Baseline of 2024: a feature newer than the floor ships with a fallback that renders the same. Reduced motion, forced colours and more contrast each get their rendering. Read the guide of Modern Web Guidance for each platform feature before you write it.

## Done means seen

- A UI change is done once it renders on the dev server and passes a chrome-devtools MCP audit at phone and desktop widths, in both colour schemes: console clean, accessibility clean, Core Web Vitals good. You own what the audit finds, in the same task.
- The Playwright suite runs on the fixture of the dev server: a real worker harness on the fake model. A flow a person sees gets a spec, and the Playwright agents plan, generate and heal them from `e2e/seed.spec.ts`.
- The host loads the build, so a change of the server side runs `pnpm --filter @workcell/dashboard build` before the host tests.
