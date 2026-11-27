# End-to-end tests

- The suite runs against the dev server, whose request context is the fixture: a real worker harness of the core on TanStack's fake model, in a sandbox on the machine. No host, no database, no model key.
- The fixture starts its worker turn on the first request, paced so a page that opens at once sees each tool call arrive. A test that needs a turn as it happens opens the page first.
- Reduced motion stays on: it keeps the suite fast.
- `.mobile.spec.ts` files run in WebKit on a phone, the others in Chromium on a desktop.
