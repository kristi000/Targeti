import "server-only";

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GOOGLE_CLOUD_PROJECT
  ?? process.env.GCLOUD_PROJECT
  ?? "perf-tracker-lmp2b";
const adminApp = getApps()[0] ?? initializeApp({ projectId });

export const adminDb = getFirestore(adminApp);
