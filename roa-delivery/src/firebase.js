import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCS9t0f6kLLBDpKkRD_O7p9XTA-ExxGgf4",
  authDomain: "roa-support.firebaseapp.com",
  projectId: "roa-support",
  storageBucket: "roa-support.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "114943741473",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:114943741473:web:a55529b8d0555293591d60",
};

const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(app);
