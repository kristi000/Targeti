# Targeti

Targeti is a Next.js performance and bonus dashboard backed by Cloud Firestore.

## Local development

Server-side database access uses the configured Firebase project. Install the
dependencies and start the app with:

```powershell
npm install
npm run dev
```

## Firebase Authentication

The app uses Google sign-in, Firebase `httpOnly` session cookies, and the Admin SDK. Enable the Google provider in Firebase Authentication before deploying.

App Hosting supplies Application Default Credentials automatically. For local development, authenticate the Admin SDK with the Firebase CLI/emulator or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account credential that has the required Firebase Auth and Firestore IAM permissions.

Configure the initial administrator and optional email-domain allowlist:

```text
TARGETI_BOOTSTRAP_ADMIN_EMAILS=owner@example.com,backup@example.com
TARGETI_ALLOWED_EMAIL_DOMAINS=example.com
```

`TARGETI_ALLOWED_EMAIL_DOMAINS` is optional. Without it, any Google account may sign in but receives the read-only `viewer` role by default. Bootstrap administrators are promoted on their first sign-in. Administrators can then assign `admin`, `editor`, or `viewer` from the Users dialog in the application header.

Only `admin` may delete shops, remove metrics, clear application data, or manage roles. `editor` may import and edit data; `viewer` is read-only. Role changes are stored as Firebase custom claims and take effect after the affected user signs in again.

Deploy `firestore.indexes.json` and `firestore.rules` with the application changes. Browser Firestore access is denied completely; authenticated server actions use the Admin SDK and Google IAM.
