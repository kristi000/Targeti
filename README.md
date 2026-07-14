# Targeti

Targeti is a Next.js performance and bonus dashboard backed by Cloud Firestore.

## Local development

Server-side database access uses the Firebase Admin SDK. Firebase App Hosting
provides credentials automatically. For local development, either start the
Firestore emulator or configure Application Default Credentials before running:

In one terminal, start the emulator:

```powershell
firebase emulators:start --only firestore
```

Then start the app in another terminal:

```powershell
npm install
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
npm run dev
```

To use a remote development project instead, set `GOOGLE_APPLICATION_CREDENTIALS`
to a local service-account JSON file. Never commit that file.
