import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Auth via roa-delivery project
const authConfig = {
  apiKey: "AIzaSyCS9t0f6kLLBDpKkRD_O7p9XTA-ExxGgf4",
  authDomain: "roa-delivery.firebaseapp.com",
  projectId: "roa-delivery",
  storageBucket: "roa-delivery.firebasestorage.app",
  messagingSenderId: "114943741473",
  appId: "1:114943741473:web:a55529b8d0555293591d60",
};

// Firestore data lives in roa-support
const dataConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCS9t0f6kLLBDpKkRD_O7p9XTA-ExxGgf4",
  authDomain: "roa-support.firebaseapp.com",
  projectId: "roa-support",
  storageBucket: "roa-support.firebasestorage.app",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:114943741473:web:a55529b8d0555293591d60",
};

const authApp = initializeApp(authConfig);
const dataApp = initializeApp(dataConfig, "data");

export const db = initializeFirestore(dataApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(authApp);
