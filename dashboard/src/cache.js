/**
 * Simple in-memory + sessionStorage cache for Firestore query results.
 * Reduces redundant reads when switching between tabs.
 *
 * Usage:
 *   const data = getCached("overview-stats");
 *   if (data) return data;
 *   // ... fetch from Firestore ...
 *   setCached("overview-stats", result, 5); // cache for 5 minutes
 */

const memoryCache = {};

export function getCached(key) {
  // Check memory first (fastest)
  if (memoryCache[key] && Date.now() < memoryCache[key].expiry) {
    return memoryCache[key].data;
  }

  // Check sessionStorage (survives tab re-renders but not browser close)
  try {
    const raw = sessionStorage.getItem(`roa_cache_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() < parsed.expiry) {
        memoryCache[key] = parsed;
        return parsed.data;
      }
      sessionStorage.removeItem(`roa_cache_${key}`);
    }
  } catch (e) { /* ignore parse errors */ }

  return null;
}

/**
 * @param {string} key
 * @param {*} data
 * @param {number} ttlMinutes - how long to cache (default 5 minutes)
 */
export function setCached(key, data, ttlMinutes = 5) {
  const entry = { data, expiry: Date.now() + ttlMinutes * 60000 };
  memoryCache[key] = entry;

  try {
    sessionStorage.setItem(`roa_cache_${key}`, JSON.stringify(entry));
  } catch (e) { /* sessionStorage full or unavailable */ }
}

/** Clear all cached data (e.g. on sign out) */
export function clearCache() {
  Object.keys(memoryCache).forEach((k) => delete memoryCache[k]);
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("roa_cache_"))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}
