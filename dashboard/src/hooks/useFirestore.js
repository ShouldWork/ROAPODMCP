import { useState, useEffect } from "react";
import {
  collection, query, orderBy, limit, where, getDocs, onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * Real-time Firestore collection listener.
 */
export function useCollection(collectionName, constraints = [], limitCount = 50) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, collectionName), ...constraints, limit(limitCount));
    const unsub = onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error(`Firestore error on ${collectionName}:`, err);
      setLoading(false);
    });
    return unsub;
  }, [collectionName, JSON.stringify(constraints), limitCount]);

  return { docs, loading };
}

/**
 * One-time Firestore query.
 */
export async function queryDocs(collectionName, constraints = [], limitCount = 100) {
  const q = query(collection(db, collectionName), ...constraints, limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
