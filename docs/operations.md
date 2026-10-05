# Operations runbook

## Environments

Use separate Firebase projects, service accounts, App Hosting backends, and environment files for staging and production. Never point a local or staging deployment at the production Firebase project. Set `APP_ENV` to `development`, `staging`, or `production`, and verify `FIREBASE_PROJECT_ID` before every deployment.

## Firestore backups

Enable scheduled Firestore exports in Google Cloud for the production project, writing to a versioned, retention-protected Cloud Storage bucket in the same location. Grant the Firestore service agent access to the bucket. Run a restore drill into staging at least quarterly and record its duration and result.

Recommended schedule and retention:

- Daily export retained for 35 days.
- Weekly export retained for 13 weeks.
- Monthly export retained for 12 months.

Before destructive administration or a large import, create an on-demand export and record its export path in the change ticket.

## Monitoring and repair

Forward server errors and failed Firebase operations to the production error-monitoring service, tagged with `APP_ENV`, release SHA, actor ID, operation type, shop ID, and reporting month. Do not attach workbook contents or personal data.

Failed dashboard projection refreshes are stored in `maintenanceJobs` with type `dashboard-summary-refresh`. An administrator can invoke `retryPendingDashboardSummaryJobs`; use `rebuildDashboardSummaryMonths` for an explicit month rebuild. Alert when a pending job is older than 15 minutes or has three failed attempts.

Shop report selectors read `shops/{shopId}/metadata/performanceIndex`. Older shops build this document on first access. Performance mutations mark it dirty and refresh it alongside dashboard summaries; while dirty, reads fall back to a projected performance query. Retry pending dashboard projection jobs to repair an index left dirty after a failed refresh.

Dashboard month selectors read `dashboardPeriodIndexes/current`. The first request after deployment builds this compact index from shop month keys and active imports. Shop and import mutations refresh it alongside dashboard summaries. While dirty, reads fall back to projected source queries; retry pending dashboard projection jobs if it stays dirty. The index is server-only and has a size cap, so very large datasets continue to use projected reads.

Supervisor-filtered dashboard pages use the composite indexes in `firestore.indexes.json` and cached supervisor summaries in each `dashboardSummaries/{month}` document. Deploy the indexes before the application change with `firebase deploy --only firestore:indexes --project YOUR_PROJECT_ID` from the repository root, replacing `YOUR_PROJECT_ID` with the intended Firebase project ID. This repository has no `.firebaserc`, so select the project explicitly. Until an index is ready, the page falls back to reading the matching shop summaries. Older month summaries populate the supervisor aggregates on first filtered access.

Admin text search reads `dashboardSummaries/{month}/metadata/searchIndex`, a compact copy of shop totals. It is written atomically with the month summary and built on first search for older months. If the index exceeds 750 KB or is unavailable, search falls back to reading matching shop summaries. The `metadata.entries` field is exempted from automatic indexing in `firestore.indexes.json` because no query uses that array.

Imports are recorded before completion in the `imports` collection and their data, history, status, and activity event are committed atomically. Only the latest import for each month is `active`; earlier retained versions are `superseded`. Monitor imports that remain outside `active`, `superseded`, `undone`, or `removed` states.

## Attendance and original-format Excel export

Daily Closing places attendance below the other inputs, with the monthly roster's manager name emphasized in the header even when minimized. Its Minimize/Expand control keeps the editor mounted so drafts survive minimizing; the unsaved reminder remains visible. Attendance has no separate planned/confirmed status. Older stored status fields are discarded when read and omitted from new writes.

Each shop has a Presence & Shifts page at `/shop/{shopId}/attendance`. The selected month's roster includes SM (manager), SR, and IE staff. SM names receive a manager label and visual emphasis. Staff IDs, names and roles are saved per month, preserving historical rosters independently of performance imports. Attendance does not alter performance, bonus eligibility, payroll or cash calculations.

`shops/{shopId}/attendanceMonths/{month}` stores the roster, revision, and private template mapping. `attendanceDays/{date}` stores entries and audit timestamps. Month reads are limited to 31 attendance and 31 closing documents. Saves validate Zod schemas and actor/shop access, check both the month revision and individual day versions, and commit records with an activity event. The existing catch-all Firestore rule denies direct client reads/writes to these new collections; access is through authorized server actions/routes. No new rules or composite indexes are required.

Daily Closing shares the same attendance records. Attendance has explicit Save/Cancel controls, separate from financial autosave. Save or cancel attendance edits before finalizing. Finalization copies attendance entries into the closing atomically; a finalized closing locks attendance editing in both views. An administrator can use the existing Reopen flow to unlock it. Missing attendance produces a reminder without blocking older closing workflows. Roster names/roles cannot change while the month contains finalized closings.

An editor uploads an XLSX workbook of up to 2 MB, reviews staff mapping and the selected sheet, and approves the import. The workbook must belong to the selected shop and use monthly Albanian worksheet names including a year, DATA in B5, SM/SR/IE roles on row 5, staff names on row 6, and calendar dates in column B from row 7. Imports replace the selected month's attendance only after revision checks and reject locked dates. Nonstandard attendance text is retained verbatim until edited. An existing sheet can also be attached as a blank template for a different empty month; exporting then adds that new month while preserving all original sheets.

Original files are stored privately in `attendanceTemplates/{version}/chunks` beneath the shop, with chunks smaller than Firestore's document limit. Historical template versions are retained until shop/all-data deletion, which also recursively removes all attendance collections. Never commit template workbooks, log staff/medical notes, or include workbook contents in error monitoring. Export uses the original XLSX package and selectively changes mapped cells, preserving styles, conditional formatting, merges, dimensions and print settings. A larger roster requires a matching template; columns are never silently inserted. Verify exported files in Excel and compare print preview before production rollout. Structural package comparisons alone do not establish native Excel rendering.

Before application deployment, run typecheck, lint and build, then smoke-test import/mapping, month/week edits, Daily Closing Save/Cancel/finalize/reopen, concurrent saves, viewer restrictions, mobile horizontal scrolling, and original-format export in staging. This feature introduces no Firebase rules/index deployment. Application deployment and production template import remain separate operations.

## Deployment checklist

1. Confirm the target environment and Firebase project ID.
2. Confirm the latest Firestore backup completed and staging restore is healthy.
3. Run `npm ci`, `npm test`, `npm run build`, and `npm run audit`.
4. Deploy Firestore rules and indexes to staging, then deploy the application.
5. Smoke-test sign-in, shop switching, import review, daily autosave/finalize, deletion, and dashboard totals.
6. Promote the same commit and configuration shape to production.
7. Watch errors, pending maintenance jobs, latency, and import failures for 30 minutes.

## Rollback checklist

1. Stop new imports and destructive administration.
2. Roll the application back to the last known-good release.
3. Roll back rules only when they remain compatible with data written by the failed release.
4. Run dashboard-summary rebuilds for affected months.
5. Restore Firestore only after impact analysis; prefer targeted repair because a full restore can overwrite valid concurrent changes.
6. Document the affected release, time window, shops/months, repair actions, and verification.
