# Targeti

Targeti is a Next.js performance and bonus dashboard backed by Cloud Firestore.

## Local development

Server-side database access uses the configured Firebase project. Install the
dependencies and start the app with:

```powershell
npm install
npm run dev
```

## Authentication

The app uses local username/password credentials and signed `httpOnly` session cookies. User profiles and salted scrypt password hashes are stored in server-only Firestore collections. Browser Firestore access remains disabled.

The built-in administrator signs in with username `admin` and password `01`. After signing in, the administrator can create editor or viewer profiles from the Users dialog in the application header. Usernames are case-insensitive. Changing a user's role revokes that user's active sessions.

App Hosting supplies Application Default Credentials automatically. For local development, authenticate the Admin SDK with the Firebase CLI/emulator or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account credential that has the required Firestore IAM permissions.

Set a long random `TARGETI_SESSION_SECRET` in production so session signatures are unique to the deployment. A development fallback lets the built-in administrator sign in locally before Firestore credentials are configured.

Only `admin` may delete shops, remove metrics, clear application data, or manage profiles. `editor` may import and edit data; `viewer` is read-only.

Deploy `firestore.indexes.json` and `firestore.rules` with the application changes. Browser Firestore access is denied completely; authenticated server actions use the Admin SDK and Google IAM.
