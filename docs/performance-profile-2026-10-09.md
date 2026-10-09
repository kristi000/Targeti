# Performance profile - 2026-10-09

Incremental period-selector refreshes now read affected shop documents and active imports for affected reporting months. Full scans, dirty-read fallbacks, legacy report dates and maintenance repair remain available. The signed-in browser checks below exercised the real dashboard and Attendance controls using the final local production build.

## Setup and measurement boundary

- Local working tree built with `npm run build`, then served with `npm run start -- -p 9015`.
- Next.js 15.5.25, React 18.3.1 and Node.js 24.12.0; Codex in-app browser, desktop viewport category.
- `PERFORMANCE_METRICS_ENABLED=true` throughout. Measurements include diagnostic logging/serialization overhead.
- Existing authorized localhost session; no credentials were entered or extracted. No application deployment or business-data save/import/delete was performed.
- Five full document loads per route, with at least five seconds to settle between loads. Caches were not cleared or throttled; the first local load and subsequent warm reloads are included together.
- Dashboard showed 44 shop links. Attendance showed 30 calendar days and five staff columns, giving 150 visible attendance cells. Hidden native selects were excluded from the visible-cell count.
- Native browser metrics came from the application's Web Vitals logs, deduplicated by metric ID. Browser automation wall times were excluded.
- Server durations measure instrumented operations; `serializedBytes` is an estimated JSON result size, not compressed wire size or billed Firestore reads.
- The connected browser backend cannot record a DevTools CPU trace or React Profiler session. These measurements establish a current local baseline; there is no before/after browser performance comparison or hosted-production claim.

## Document-load Web Vitals

These tables include the five baseline documents for each route. The sixth dashboard document used for interactions is excluded.

| Route | Metric | Samples | Median (ms) | Range (ms) |
| --- | --- | ---: | ---: | ---: |
| Dashboard | TTFB | 5 | 21.4 | 17.3-297.0 |
| Dashboard | FCP | 5 | 100 | 96-440 |
| Dashboard | LCP | 5 | 640 | 516-1612 |
| Attendance | TTFB | 5 | 22.4 | 19.0-39.2 |
| Attendance | FCP | 5 | 108 | 100-148 |
| Attendance | LCP | 5 | 876 | 720-932 |

The final Attendance document also received keyboard selection, Undo and Cancel interactions. Its reported INP was **96 ms**, one document sample. No CLS sample or dashboard interaction INP was emitted during the captured run, so neither is assigned a zero value. Five document loads and one interaction document are insufficient to characterize production percentiles.

## Server operations during the ten baseline document loads

All captured operations succeeded. Counts include server rendering, client queries and route canonicalization; they are operation counts rather than HTTP-request or Firestore-read counts. Interaction requests after the ten baseline loads are excluded.

| Operation | Calls | Median (ms) | Range (ms) | Estimated JSON bytes |
| --- | ---: | ---: | ---: | ---: |
| `dashboard.periods` | 15 | 111.93 | 93.77-783.81 | 139 |
| `dashboard.page` | 15 | 301.38 | 236.27-592.52 | 8,784 or 35,756 |
| `shop.directory` | 15 | 329.16 | 193.25-961.31 | 295,513 |
| `attendance.month` | 5 | 143.15 | 114.02-279.30 | 369 |

The directory was the largest measured result. Repeated dashboard bootstrap operations were also visible: five document loads produced 15 page operations and 15 period operations. Investigate initial reporting-period selection, URL canonicalization and query hydration before attributing those extra calls to one specific cause.

## Browser interaction verification

- Attendance dropdown options accepted Home, ArrowDown and Enter with option focus.
- A local cell edit enabled Undo, Cancel and Save. Undo restored the original value and disabled the draft controls.
- A second local edit followed by Cancel restored the original value and disabled the draft controls. Save was never clicked.
- A synthetic no-match dashboard search rendered the expected empty result; clearing restored the unfiltered, nonbusy grid.
- Selecting another existing reporting period and restoring the original returned the original 44 shop links and a nonbusy grid.
- Search, reporting period and drafts were restored. The temporary production browser tab and server were closed after capture; the existing development server remains available.

## Incremental period-selector verification

Typecheck, lint, production build and diff checks passed. An independent temporary harness loaded the actual TypeScript module with mocked Firestore and passed 14 scenarios. No repository test files or dependencies were added.

The scenarios covered one-shop projected reads with no import query, removal of deleted shops, cross-shop import supersede/reactivation, overlapping dirty scopes, obsolete owners, transaction version retries, legacy/unknown full refreshes, deleted legacy report-date sources, exact timestamp/document-ID ordering, invalid and oversized baselines, scope overflow, malformed moved active-import IDs, both-month inactive moves, and maintenance recovery after repeated version conflicts.

Known callers distinguish shop-only changes from import changes. Import registration, undo and removal refresh all active imports in the affected month. Shop deletion and all-data cleanup refresh all imports to preserve legacy date fallbacks. Older pending jobs without that distinction take the full scan path. Future month moves must supply both the old and new months; direct edits outside the supplied scope require full repair.

Import, undo, deletion and concurrent mutation behavior was verified with the mocked module, not by changing live business data. Before an application release, exercise those mutations and pending-job recovery in staging. No Firestore rules, composite indexes or collections were added; Firebase deployment is unnecessary for this change.

## Follow-up work supported by these observations

1. Slim the initial shop-directory payload while retaining the data required by existing routes. Measure serialized and actual transferred bytes before and after; preserve shop authorization and historical-data access.
2. Align the dashboard's initial reporting period, URL and hydrated query keys to reduce avoidable bootstrap operations. Repeat the same document-load and search measurements, then record a normal browser CPU/React trace if rendering attribution is still needed.

## Reproducing the measurement

Use the same authorized account, shop, reporting period and viewport in staging, with the same diagnostic setting. Build the reviewed source, start a production server, then perform five full dashboard loads followed by five full Attendance loads, allowing each to settle for at least five seconds. Deduplicate metric logs by ID and separate these loads from later search, period switching and reversible Attendance edits. Record cache conditions and compare like-for-like runs; use Firestore monitoring or Query Explain separately for read costs.

Baseline load start times on 2026-10-09, UTC:

| Route | Starts |
| --- | --- |
| Dashboard | 21:26:44.564, 21:27:28.618, 21:27:34.757, 21:27:40.709, 21:27:46.725 |
| Attendance | 21:28:05.775, 21:28:11.404, 21:28:17.466, 21:28:23.584, 21:28:29.815 |

Attendance edit/Undo began at 21:28:57.470, edit/Cancel at 21:29:06.757, dashboard search at 21:29:33.869, search clearing at 21:29:34.766, period switching at 21:30:04.608 and restoration at 21:30:05.531. The final interaction document closed at 21:30:26.871 UTC. No shop IDs, staff names, notes, customer data or raw result bodies are retained in this report.
