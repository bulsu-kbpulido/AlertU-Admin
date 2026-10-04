import { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Sidebar "new item" badges.
 *
 * Each source watches one Firestore collection and counts documents that are
 * newer than the last time the user opened that page. Opening the page (or
 * leaving it) marks everything as seen. The "last seen" marker is stored per
 * user in localStorage, and the first time it is used it starts from the
 * newest existing document, so nothing is flagged as new on first load.
 *
 * source = {
 *   pageId,         // sidebar item id this badge belongs to
 *   collectionName, // Firestore collection to watch
 *   orderByField,   // optional: newest-first server ordering (needs a single-field index, which is automatic)
 *   max,            // how many docs to look at (default 100)
 *   getTime(doc),   // timestamp field(s) of a doc, in any Firestore/ISO/number format
 *   include(doc),   // optional: only count docs that match (e.g. still pending)
 * }
 */

export const toMillis = (raw) => {
  if (!raw) return 0;
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (typeof raw.toDate === 'function') return raw.toDate().getTime();
  if (typeof raw === 'object' && raw.seconds) return raw.seconds * 1000;
  if (typeof raw === 'object' && raw._seconds) return raw._seconds * 1000;
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const keyFor = (uid, pageId) => `alertu:lastSeen:${uid}:${pageId}`;

const readSeen = (key) => {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

const writeSeen = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable: badge just resets on reload */
  }
};

export default function useNewItemBadges(sources, currentPage, uid = 'anon') {
  const [counts, setCounts] = useState({});
  const currentPageRef = useRef(currentPage);
  const newestRef = useRef({}); // pageId -> newest doc time seen so far

  const markSeen = (pageId) => {
    const newest = newestRef.current[pageId];
    if (!newest) return;
    const key = keyFor(uid, pageId);
    writeSeen(key, Math.max(readSeen(key) || 0, newest));
    setCounts((prev) => (prev[pageId] ? { ...prev, [pageId]: 0 } : prev));
  };

  // Subscribe to every source once per user
  useEffect(() => {
    const unsubscribers = sources.map((src) => {
      const base = collection(db, src.collectionName);
      const q = src.orderByField
        ? query(base, orderBy(src.orderByField, 'desc'), limit(src.max || 100))
        : query(base, limit(src.max || 100));

      return onSnapshot(
        q,
        (snapshot) => {
          const times = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((doc) => (src.include ? src.include(doc) : true))
            .map((doc) => toMillis(src.getTime(doc)))
            .filter((t) => t > 0);

          const newest = times.length ? Math.max(...times) : 0;
          newestRef.current[src.pageId] = newest;

          const key = keyFor(uid, src.pageId);
          let seen = readSeen(key);
          if (seen === null) {
            // First use on this browser: treat everything that exists now as seen
            seen = newest || Date.now();
            writeSeen(key, seen);
          }

          // Viewing the page right now: new items are seen as they arrive
          if (currentPageRef.current === src.pageId) {
            if (newest > seen) writeSeen(key, newest);
            setCounts((prev) => ({ ...prev, [src.pageId]: 0 }));
            return;
          }

          setCounts((prev) => ({
            ...prev,
            [src.pageId]: times.filter((t) => t > seen).length,
          }));
        },
        (error) => console.error(`New-item badge listener failed (${src.collectionName}):`, error)
      );
    });

    return () => unsubscribers.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Entering a page clears its badge; leaving it clears again so items that arrived meanwhile are not flagged
  useEffect(() => {
    currentPageRef.current = currentPage;
    const entered = sources.find((s) => s.pageId === currentPage);
    if (!entered) return undefined;
    markSeen(entered.pageId);
    return () => markSeen(entered.pageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  return counts;
}
