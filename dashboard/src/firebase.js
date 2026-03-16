import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  // Replace with your Firebase project config from Firebase Console → Project Settings
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "roa-support.firebaseapp.com",
  projectId: "roa-support",
  storageBucket: "roa-support.firebasestorage.app",
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
