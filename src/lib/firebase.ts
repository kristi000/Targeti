// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  "projectId": "perf-tracker-lmp2b",
  "appId": "1:214539099988:web:4e34338deee638b93cb2c1",
  "storageBucket": "perf-tracker-lmp2b.firebasestorage.app",
  "apiKey": "AIzaSyDto6PIYFcOpZwo8IxrISmHXO-W3Crm2Zw",
  "authDomain": "perf-tracker-lmp2b.firebaseapp.com",
  "measurementId": "",
  "messagingSenderId": "214539099988"
};

// Initialize Firebase
let app: FirebaseApp;
try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  console.log("Firebase app initialized successfully");
} catch (error) {
  console.error("Error initializing Firebase app:", error);
  throw error;
}

let db: Firestore;
try {
  db = getFirestore(app);
  console.log("Firestore initialized successfully");
} catch (error) {
  console.error("Error initializing Firestore:", error);
  throw error;
}

export { app, db };
