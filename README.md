# Target

Target is a client-rendered Next.js performance and bonus dashboard backed by Cloud Firestore.

## Local development

Install the dependencies, copy the values described in `.env.example` into
`.env.local`, and start the app with:

```powershell
npm install
npm run dev
```

## Authentication

The app keeps its local username/password login and signed `httpOnly` session cookie. After login, the server exchanges that session for a short-lived Firebase custom token. Dashboard reads and writes then run directly in the browser with the Firebase Web SDK. User profiles and salted scrypt password hashes remain in server-only Firestore collections.

The built-in administrator signs in with username `admin` and password `01`. After signing in, the administrator can create editor or viewer profiles from the Users dialog in the application header. Usernames are case-insensitive. Changing a user's role revokes that user's active sessions.

The existing Firebase Web App configuration is included as the browser default. It can be overridden with the `NEXT_PUBLIC_FIREBASE_*` variables listed in `.env.example`. The API key is a public Firebase client identifier; authorization is enforced by Firebase Authentication and `firestore.rules`.

App Hosting supplies Application Default Credentials automatically. For local development, set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account credential that can read the server-only authentication collections and sign Firebase custom tokens.

Set a long random `TARGETI_SESSION_SECRET` in production so session signatures are unique to the deployment. A development fallback lets the built-in administrator sign in locally before Firestore credentials are configured.

Only `admin` may delete shops, remove metrics, clear application data, or manage profiles. `editor` may import and edit data; `viewer` is read-only.

Deploy `firestore.indexes.json` and `firestore.rules` with the application changes. The rules read the signed-in user's server-managed `accessProfiles` document and enforce `admin`, `editor`, and `viewer` permissions. Browsers cannot read password hashes, username mappings, or modify their own role.

The dashboard reads precomputed documents from `dashboardSummaries/{month}/shops/{shopId}` and uses Firestore cursors for paging. Missing months are backfilled automatically by the authenticated server action on first access; later performance, shop, target, metric, import, and supervisor mutations refresh the affected summaries. Its normal paging and sorting paths use Firestore's automatic single-field indexes, while filtered searches sort the much smaller matching summary set on the server.
