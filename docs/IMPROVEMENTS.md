# DAB — What to improve next

Written 2026-08-16, after the perf-gate rebuild (v21.7) and the visual bug
hunt (v21.8). Ordered by when it should happen, not by how interesting it is.
Each item says why it matters, what it costs, and how to know it's done.

The one-line summary: the product's numbers are now honest (full-rows stats,
a perf gate that measures its own targets, seven visual bugs gone). The
biggest remaining dishonesty is that **the charts still draw the sample, not
the data**. Fix that before the demo. Everything else can wait its turn.

---

## Now — before Science Day (Aug 25)

### 1. Charts (and fallback forecasts) must draw the data, not the sample
**Why.** v21.4 moved stats, trends and correlations to full rows, but the
CHARTS tab still plots `sampleRows` — at most 12 rows of a random reservoir
sample. For a 10,000-row file the "chart of your data" is 5 arbitrary rows.
Same class of problem in `analysisPipeline.js:37`: when the tool loop returns
no forecast, `autoForecast(headers, sampleRows)` fabricates one from the
sample. A thesis student will put these charts in a defence slide. That is
the exact audience that gets hurt.

**What.** Backend builds aggregated series next to `autoCharts` config:
group by the label column (or month for date columns), aggregate the anchor
measures (sum/avg), cap at ~12 buckets, ship as `autoCharts[n].data`.
Frontend `AutoChart` prefers `config.data` and falls back to the current
sample shaping only when absent (old saved analyses keep rendering). Kill or
clearly label the sample-based forecast fallback — a labelled absence beats
an unlabelled guess.

**Cost / done when.** About a day. Done when a 10k-row upload charts monthly
revenue that matches a spreadsheet pivot of the same file, and the browser
suite asserts bucket count and one aggregated value.

### 2. Turn the bug hunt into a CI guardrail
**Why.** The seven visual bugs from v21.8 were all mechanically detectable:
horizontal overflow, offscreen elements, console errors. Those checks ran
once, in a sandbox. Nothing stops them regressing Thursday.

**What.** A small script in the browser suite: for the six key screens
(landing, auth, dashboard with data, each results tab group, history,
workspace) at 390px and 1024px, assert `scrollWidth <= innerWidth + 1`, zero
elements past the right edge, zero console errors, zero failed requests.
No screenshot baselines yet — pixel diffs flake in CI; geometry doesn't.

**Cost / done when.** Half a day, mostly porting hunt2.py logic to the
existing Playwright suite. Done when reverting the workspace `flex-wrap` fix
makes CI red.

### 3. Windows-safe leak check in perf-load.mjs
**Why.** The `--leak` mode reads RSS via Unix `ps`, which silently returns
null on Windows — the machine this project is developed on. A leak check
that only runs in CI is a leak check nobody watches.

**What.** Read memory from `/api/metrics` (the server already reports it)
instead of shelling out to `ps`. Same budget, same 200-analysis loop.

**Cost / done when.** An hour. Done when `node scripts/perf-load.mjs --leak`
prints a real MB number in PowerShell.

### 4. Demo dry run (not code)
- Sign in on the demo machine beforehand and keep one seeded dataset, so the
  สถิติ tab (the flagship) is one click away — it needs a saved dataset and
  will not show on the anonymous path.
- Rehearse once in light mode on the actual projector. The contrast fix from
  v21.8 makes it safe, but see it with your own eyes.
- Decide the no-wifi story: `AI_MOCK=1` keeps every deterministic feature
  alive without the API. Write the one-line switch on a sticky note.
- Charge the phone; the wrapped tab strip means the mobile walkthrough works
  now, and a phone demo is a good fallback if the projector dies.

---

## Next — after the demo

### 5. Decide what English is: finish it or remove the toggle
**Why.** Today EN translates the nav and shared labels while the body stays
Thai (found during the hunt; the default is now correctly Thai). Half a
language reads as a bug to exactly the users the toggle is for — English-
program students and international advisors are also paying customers.

**What.** Either route the dashboard, tabs, workspace and toasts through
`t()` (the i18n plumbing, key-parity test included, already exists — this is
string extraction, not architecture), or hide the EN button until it's true.
Recommendation: finish it. It roughly doubles who you can sell to.

**Cost / done when.** A focused weekend. Done when the key-parity test
covers the new keys and a full EN walkthrough shows zero Thai body strings
(the recommended-charts explanations included).

### 6. Account recovery
**Why.** There is no forgot-password path (`routes/auth.js` has register,
login, refresh — nothing else). A freelance customer who forgets a password
the night before a defence has no way back in, and no way to reach a mail
server you don't run.

**What.** Smallest honest version: an owner-run CLI
(`node scripts/reset-password.mjs <username>`) that sets a one-time
password, audit-logged, plus a line in the customer README saying recovery
goes through you. Email-based reset can wait until there's mail
infrastructure worth trusting.

**Cost / done when.** Half a day with a test that the one-time password
forces a change on first login.

### 7. Share links inherit the honest charts
Falls out of item 1: SharePage renders `AutoChart`, so once configs carry
aggregated data, shared links show the data too. Just verify it in the
browser suite; a share link is the version advisors actually open.

---

## Later — when the above is boring

### 8. Inference response cache per dataset version
`POST /api/inference/:id` re-parses every row per request by design — honest,
and now perf-gated at ~230-290ms p95 in the sandbox. Dataset versions are
immutable, so a version-keyed parse cache is safe and would cut most of that.
Do it only if real usage says so; the new gate will show the before/after.

### 9. Accessibility pass
Run a proper WCAG audit (keyboard traps in modals, focus order, tab-strip
arrow keys). Several pieces are already right (aria labels, focus rings,
reduced-motion tour). Half a day to audit, unknown to fix.

### 10. Screenshot baselines
Only if the geometry guardrail (item 2) proves too coarse. Pixel diffs are
maintenance-heavy; earn them with a regression that geometry missed.

---

## Deliberately not doing

- **No rewrite.** Express + SQLite + React + Vite is the right size for this
  product and this team of one. TypeScript, Next.js, Postgres-by-default,
  Docker orchestration: all cost weeks and buy nothing a thesis student can
  see.
- **No new AI surface before the data surface is honest.** The moat is that
  every number is deterministic and gated. Item 1 extends the moat; a new
  chat feature would dilute it.
- **No payment/billing code.** Freelance invoicing stays human for now;
  build it when there are enough customers to make it a bottleneck.
