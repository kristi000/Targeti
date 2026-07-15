"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  projectId: "perf-tracker-lmp2b",
  appId: "1:214539099988:web:4e34338deee638b93cb2c1",
  storageBucket: "perf-tracker-lmp2b.firebasestorage.app",
  apiKey: "AIzaSyDto6PIYFcOpZwo8IxrISmHXO-W3Crm2Zw",
  authDomain: "perf-tracker-lmp2b.firebaseapp.com",
  messagingSenderId: "214539099988",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const clientAuth = getAuth(app);
