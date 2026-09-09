import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "perf-tracker-lmp2b";

const app = getApps().length
  ? getApp()
  : initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDto6PIYFcOpZwo8IxrISmHXO-W3Crm2Zw",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:214539099988:web:4e34338deee638b93cb2c1",
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "perf-tracker-lmp2b.firebasestorage.app",
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "214539099988",
    });

export const firebaseAuth = getAuth(app);
export const db = getFirestore(app);
