# Printing Press Production Cost Calculator

Calculates what a print job actually costs to produce (materials, printing, finishing,
labor, machine time, setup, waste). No quotations, VAT, profit or invoicing.

## Deploying this

**`index.html` is the only file GitHub needs to serve the app.** Everything else in
this zip is source/reference material — `index.html` already has it all bundled inside.

1. Push this whole folder to a GitHub repository (or upload the files through the
   GitHub web UI), keeping `index.html` at the repo root.
2. In the repo: **Settings → Pages** → Source: "Deploy from a branch" → Branch: your
   default branch, folder `/ (root)` → **Save**.
3. Wait a minute, then open the link GitHub shows you there
   (`https://<your-username>.github.io/<repo-name>/`).
4. Sign up on that page. The **first person to sign up becomes admin** (can edit
   rates); everyone after that is staff (can calculate and save, not edit rates).
   New Supabase projects usually require confirming your email before you can sign
   in — check your inbox. You can turn that requirement off yourself in your Supabase
   project under Authentication → Providers → Email, if you'd rather skip it.

The app talks to a Supabase project that already has the database set up, seeded with
demo rates and your real purchase data. Nothing here needs npm, a build step, or a
server of your own — it's one static HTML file.

## What's in this zip

```
index.html          <- the deployable app (put this on GitHub Pages)
schema.sql           <- the database schema, for reference or rebuilding elsewhere
src/                 <- the same code as index.html, but as separate readable files
  engine.js           - the calculation engine (pure functions, no UI)
  seed.js             - demo rates + the 5 reference test jobs
  cloud.js            - the app: screens, Supabase auth and data layer
  app.css             - styling
tests/               <- the test suite used to build and verify this
  engine-tests.js     - 155 checks on the calculation engine (run: node engine-tests.js)
  stress-test.js      - 60,000 randomised jobs checking for crashes/bad numbers
  cloud-app-test.js   - 45 checks on the app against a mock Supabase backend
  supabase-mock.js    - the mock backend used by cloud-app-test.js
  seed-for-mock.js    - turns seed.js's demo data into the mock's table shape
```

If you ever want to change the app's behaviour, edit the files under `src/`, then
rebuild `index.html` by inlining them into the HTML template (a script for this can
be recreated easily, or just ask Claude to do it again from these source files).

## Known open items

- Four materials from your purchase data are still unpriced because the source
  document didn't state enough to compute a cost (see their notes in Materials):
  SINAR Woodfree Blue, Euro Premium Eggshell, AA A4 Paper, Mounting Tape.
- "FB 350" was loaded as its own material rather than merged into the existing
  "Food Board 350GSM" — confirm whether they're the same stock.
- There's no in-app screen yet for entering a *new* purchase invoice yourself;
  purchase history so far was loaded directly into the database.
