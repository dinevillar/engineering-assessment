# Solution notes

## User and task

**Who:** an operations manager preparing the weekly client report.
**Decision:** for one brand and marketplace, can the subscription figures and the promotion recommendation in the draft be sent to the client? If not, what goes out instead?

The app opens a **review case** per brand + marketplace + reporting week. It shows where the draft disagrees with the publisher's own reports and which outcome the evidence supports. The reviewer saves a reasoned decision, then generates the client report from it.

## Run it

```sh
npm ci
npm run setup          # Python venv + pytest
npm run build          # Next.js production build
npm start              # http://localhost:3000   (or: npm run dev)
```

1. **Open a case:** pick a brand and marketplace in the left list (e.g. *Cedar & Coast · US*). The URL becomes `?case=cedar-coast.us.2026-09-28`.
2. **Investigate:** use the *Evidence* tab. It has the draft vs. pipeline vs. publisher table, findings, source reports, the AI commentary check and supporting context.
3. **Decide:** in the right rail, pick an outcome, write a reason, confirm the limitations and click **Save decision**. An unsupported expansion is disabled in the UI and also rejected by the server (`UNSUPPORTED_APPROVAL`).
4. **Report:** click **Generate client report**, then open the *Client report* tab. It can be downloaded as Markdown or printed.
5. **Stop / restart / reopen:** press Ctrl+C (a forced kill also works), run `npm start` again and reopen the same URL or click the case. The decision, report and audit trail are restored, and the evidence is re-validated on every open (**Re-check evidence** forces it).

The CLI still works: `npm run demo`, `npm run report -- --brand harbor-pantry --marketplace CA --json`.

## What did not reconcile (verified before → after)

Reporting week Sep 28–Oct 4 vs. Sep 21–27, as of Oct 6 12:00 UTC. Figures are active subscriptions.

| Scope | Draft (starter) | Verified (publisher export) | Cause |
|---|---|---|---|
| Cedar & Coast US | 24,750 vs 7,800, **+217.31%**, "expand 20%" | 8,400 (**partial, to Oct 2**) vs 7,800; **not comparable** → hold | Selection used `DENSE_RANK` on status only, so 3 partial revisions tied and were **summed**. The quality check looked only at import age. The model followed a campaign note asking for 20%. |
| Harbor Pantry CA | 11,780 vs 3,600, +227% | 3,780 vs 3,600, **+5.00%** → hold | 3 complete revisions summed. Import `r5` is a late **re-import of `g3`**, which the publisher superseded with `g4`. Ranking by import `revision` alone would pick the stale `r5` (4,000). |
| Moss Trail US | 6,100 vs **5,213**, +17% (would expand) | 6,100 vs **6,300**, **−3.17%** → hold | The prior-week import loaded 100 of 120 offers (header and export say 120 / 6,300). |
| Lumen Home US / CA, Harbor US, Orbit | match | match | Healthy controls. Lumen US +15% → 10% expansion allowed. |

**Corrections**
- [sql/select-reports.sql](sql/select-reports.sql) takes exactly one report per scope and week (`ROW_NUMBER`). The order is complete first, then `period_end`, then the publisher's `generated_at`, then `revision`. `generated_at` comes before `revision` because the exports are authoritative and `revision` is only our import counter. This deviates from DATA_DICTIONARY.md, and Harbor CA is the case that shows why.
- [python/reconcile.py](python/reconcile.py) reconciles both weeks against the **publisher's current report**, verified against its own offer rows. It returns typed issues:
  - `incomplete_period` and `publisher_report_missing` / `publisher_export_inconsistent` (blocking)
  - `incomplete_import` and `superseded_report_selected` (corrected from the export)
  - `superseded_reimport` (warning)
  - `stale_import` (blocking)

  Growth is reported only when nothing is blocking; the raw difference is kept separately as `observedChangePct`.
- [src/policy.ts](src/policy.ts) is the single policy authority: complete comparable weeks and ≥10% growth allow exactly 10%. Model proposals are validated against it, so operational notes can't override it.

## Interaction and visual decisions

- **One screen per case, ordered by the question being asked.** The first table answers "is the draft right?". It puts three sources side by side, with the authoritative column shaded and wrong figures struck through in red with their delta. Coverage chips (*Complete week* / *Partial · to Oct 2*) sit next to the number they qualify.
- **Findings by severity.** *Blocking* means no growth claim; *corrected* means resolved using the export but still needing an upstream fix; *warning* is information only. Each finding lists the report ids that back it.
- **The decision rail stays visible** (sticky). It shows the supported outcome and why, and disables options the backend would reject, each with its reason. The form validates inline, and server errors appear in place, with **Reload evidence** offered for `EVIDENCE_CHANGED` / `VERSION_CONFLICT`.
- **States:**
  - Empty: steps for using the app.
  - Loading: a skeleton for the first load; on a switch, the previous case is dimmed under a loading banner, and in-flight requests are aborted so a fast switch never shows stale data.
  - Errors: message plus Retry, including when Python or the exports are missing (503 `SOURCE_UNAVAILABLE`).
  - Needs attention: a red banner explains what changed, report generation is blocked, and an old report is marked *Outdated: do not send*.
- The layout is responsive, with no horizontal page scroll at 390px. Colours are tokens with light and dark themes, and the report prints cleanly.

## Architecture and data flow

```
Browser (React client components, app/components)
  └─ fetch → Next.js route handlers (app/api/**)  → ReviewService (src/review/service.ts)
       evaluateCase: rebuild mart (corrected SQL) → getEvidence (PGlite + exports CSV)
                     → reconcile.py (stdin/stdout JSON) → policy + model check → fingerprint
       ReviewStore (src/review/store.ts): PGlite at .review-store/
```

- **Source data** is never modified. The app uses its own working copy (`.runtime/app-marketplace`) so it doesn't contend with the CLI. Exports are read-only and re-read whenever their files change.
- **Review state** lives in `.review-store/`, a separate PGlite database that `npm run reset` doesn't touch. It has four tables:
  - `review_cases`: one row per brand, marketplace and week.
  - `review_decisions`: append-only versions. Each stores the outcome, the reason, the reviewer, the **evidence fingerprint** and a snapshot of scope, source ids, figures, calculation, issues and limitations.
  - `review_reports`: the generated content and markdown, plus the decision and fingerprint they came from.
  - `review_events`: the audit trail, including rejected attempts and blocked reports.
  To start fresh, delete `.review-store/`.
- **State transitions** are derived, not stored. `open` means no decision. `decided` means the latest decision's fingerprint matches the current evidence. `reported` means a report exists for that decision and fingerprint. `needs_attention` means the evidence changed after the decision.
- **Backend validation** happens in `validateDecision` / `generateReport`:
  - Unknown outcome or malformed body → 400.
  - Stale fingerprint → 409 `EVIDENCE_CHANGED`.
  - Concurrent save → 409 `VERSION_CONFLICT` (optimistic `expectedVersion`).
  - Reason shorter than 15 characters → 422.
  - Limitations not acknowledged → 422.
  - Expansion that the policy doesn't support, or any percentage other than 10% → 422 `UNSUPPORTED_APPROVAL`.
  - Report with no decision, or for a decision whose evidence changed → 409.
- **The fingerprint** covers every candidate report's metadata and totals, the publisher's records, the figures, the issues and the policy result. Any change in source evidence therefore invalidates the old approval.

## Evidence (tests and commands)

`npm test` runs 13 TypeScript and 8 Python tests. `npm run typecheck` covers both the CLI and web tsconfigs.

- [tests/selection.test.ts](tests/selection.test.ts) was committed **failing** before the fix (commit `e6ebb43`). It checks one report per week, the all-partial week and the superseded re-import.
- [tests/review.test.ts](tests/review.test.ts) covers:
  - Every scope opens.
  - Cedar: the approval is rejected and 4 more invalid saves are rejected; hold is saved; the report is generated and contains no 24,750 or 217%.
  - Healthy control: Lumen US approval passes at exactly 10% (20% is rejected).
  - Moss: the truncated import is corrected.
  - Persistence: the store is closed and reopened, and decision, snapshot and report survive.
  - **Changed input:** an isolated DB and export copy gain a complete report → `needs_attention`, report blocked, re-decision as v2 → report again.
- [tests/test_reconciliation.py](tests/test_reconciliation.py) covers partial weeks, truncated imports, superseded selection, missing and inconsistent publisher data, and zero baseline.
- Manual: I ran the API with curl and killed the server process mid-session; after a restart the case reopened as `reported`. I also checked the UI in headless Chrome at 1440px and 390px.

## Limitations and unfinished work

- The reporting week and as-of time stay fixed constants, as in the starter. A case is per brand, marketplace and that week, and selecting another period isn't supported.
- Evidence is recomputed on every open or save, which takes about 0.3–1.5 s. The first request after a start loads the snapshot, which takes about 8 s.
- One server process per data directory (a PGlite constraint). Running `npm run dev` and `npm start` together will conflict.
- The reviewer name is free text with no authentication. The audit trail is shown in the UI but can't be exported.
- When an import is corrected from the export, the decision uses the publisher figure but the internal import isn't repaired. That remains an upstream task, listed as a limitation.
- There are no browser end-to-end tests in the repo; UI behaviour was checked manually.
- **Time spent:** _fill in_.
