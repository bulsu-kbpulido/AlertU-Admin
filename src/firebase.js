// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";            // Added for Login
import { getFirestore } from "firebase/firestore";  // Added for Database
import { getStorage } from "firebase/storage";      // Added for alert photo uploads

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Export instances to pull into your React Admin Management panel
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// Fail fast (30s) instead of silently retrying for 10 minutes if Storage rejects/blocks an upload
storage.maxUploadRetryTime = 30000;
storage.maxOperationRetryTime = 30000;