import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCS9t0f6kLLBDpKkRD_O7p9XTA-ExxGgf4",
  authDomain: "roa-delivery.firebaseapp.com",
  projectId: "roa-delivery",
  storageBucket: "roa-delivery.firebasestorage.app",
  messagingSenderId: "114943741473",
  appId: "1:114943741473:web:a55529b8d0555293591d60",
};

const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(app);
