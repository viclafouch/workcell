---
name: create-pull-request
description: Every Workcell pull request starts here, ahead of mattpocock-skills:pr, which it runs itself. Use when opening a pull request or writing its body, including "go pr".
---

# Create a pull request

A Workcell pull request leaves the branch its issue links, and its body carries **evidence**: the change shown working, not claimed. Everything captured lands in `.artifacts/<branch>/`, which Git ignores.

## 1. Write the body

Run `mattpocock-skills:pr` and write its template to `.artifacts/<branch>/body.md`. The body carries `Closes #<n>` for each issue the branch closes, and the title carries no number: the squash merge appends the number of the pull request.

Done when every section of the template is filled or cut, and the body names no project, company, person or bot.

## 2. Choose the evidence

Evidence is proportional to the change:

- **A screen of the console**: a screenshot, before and after when the before exists on `main`.
- **A flow or a live stream of the console**: one video.
- **The host, the core or an integration**: the test that failed and now passes, as text. No media.
- **Docs**: content checked, runnable examples run. No media.

Two media at most. Every screen media shows light and dark side by side. Evidence already captured in the task is reused.

Done when each media has its one-line claim, or the body says why the evidence is text.

## 3. Capture

Playwright drives, ffmpeg assembles. The console's Playwright suite serves the app on the fixture of `packages/console/src/server/fixture-context.ts`: a real worker harness on the fake model, so every media shows test data only.

**A screen or a flow** runs as a throwaway `packages/console/e2e/evidence.spec.ts`, or `evidence.mobile.spec.ts` for the phone. Git ignores both.

```ts
for (const colorScheme of ['light', 'dark'] as const) {
  test(`evidence ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto('/')
  })
}
```

- Each expected state gets an `expect`, so a red run leaves no misleading media.
- A video needs `test.use({ video: 'on', reducedMotion: 'no-preference' })`. Playwright writes it to `e2e/.results/<test>/video.webm`.
- Run `pnpm --filter @workcell/console exec playwright test e2e/evidence.spec.ts --project=chromium`, or `--project=mobile-safari` for the phone. A change to how something looks runs on both projects, since the two engines render apart. Delete the spec after the run.
- Every run empties `e2e/.results/`: copy each media into `.artifacts/<branch>/` before the next run.

**Assemble** with ffmpeg, each clip from its first expected state so both themes play in step:

```sh
ffmpeg -i light.png -i dark.png -filter_complex hstack after.png
ffmpeg -ss <light start> -i light.webm -ss <dark start> -i dark.webm -filter_complex "hstack=shortest=1" -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart -an flow.mp4
```

Done when every media sits in `.artifacts/<branch>/` under 10 MB, and you opened each screenshot and each claim's frame: the state is visible in both themes and looks exactly as intended. A glitch, an artefact, or one theme or engine rendering apart gets fixed, or named, before step 4.

## 4. Open

The body references each media by its path relative to `body.md`, and `--attach` uploads it and rewrites the reference. An image reads `![<what it shows>](after.png)`. A video plays inline when `![](flow.mp4)` stands alone in its paragraph.

```sh
gh pr create --title "<title>" --body-file .artifacts/<branch>/body.md --attach .artifacts/<branch>/<media> --assignee @me --label <label>
```

The labels are those of the closed issues.

Done when `gh pr view --json body` shows a `user-attachments` URL for each media and no local path left.

## 5. Land

A red check runs `mattpocock-skills:diagnosing-bugs`, and its root cause gets fixed on the branch. A rerun that turns it green hides the cause. The pull request merges by squash once every check is green.

Done when every check is green on the last push.
