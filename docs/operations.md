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
