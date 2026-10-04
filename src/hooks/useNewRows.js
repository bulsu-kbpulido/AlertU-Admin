import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../firebase';
import { toMillis } from './useNewItemBadges';

/**
 * Row-level "NEW" tags for lists and tables.
 *
 * An item is NEW when it is newer than the newest item the user had already
 * seen the last time they left this list. So:
 *  - things added while you were away are tagged NEW when you come back,
 *  - things that arrive live while you are looking at the list are tagged NEW,
 *  - clicking a row (or leaving the list) marks it as seen.
 *
 * The first time a list is ever opened nothing is tagged, so you don't start
 * with every existing row flagged.
 *
 * Usage:
 *   const { isNew, markSeen } = useNewRows('reports-active', reports, { getTime });
 *   {isNew(report) && <NewBadge />}
 *   <tr onClickCapture={() => markSeen(report)}>
 */

const defaultGetId = (item) =>
  item?.id ?? item?.reportId ?? item?.reportID ?? item?.verifiedReportId ?? item?.citizenId ?? item?.adminId ?? item?.uid;

const keyFor = (uid, listKey) => `alertu:rowSeen:${uid}:${listKey}`;

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
    /* storage unavailable: tags just reset on reload */
  }
};

export default function useNewRows(listKey, items, { getTime, getId = defaultGetId } = {}) {
  const uid = auth.currentUser?.uid || 'anon';
  const storageKey = keyFor(uid, listKey);

  const [baseline, setBaseline] = useState(() => readSeen(storageKey));
  const [dismissed, setDismissed] = useState(() => new Set());
  const newestRef = useRef(0);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  // Switching to another list (e.g. another tab) loads that list's own marker
  useEffect(() => {
    setBaseline(readSeen(storageKey));
    setDismissed(new Set());
    newestRef.current = 0;

    const persist = () => {
      const keep = Math.max(newestRef.current, baselineRef.current || 0);
      if (keep > 0) writeSeen(storageKey, keep);
    };
    window.addEventListener('pagehide', persist);
    return () => {
      persist();
      window.removeEventListener('pagehide', persist);
    };
  }, [storageKey]);

  // Track the newest item; on first ever use, treat everything that exists as already seen
  useEffect(() => {
    if (!Array.isArray(items) || items.length === 0) return;
    const newest = items.reduce((max, item) => Math.max(max, toMillis(getTime(item))), 0);
    if (newest > newestRef.current) newestRef.current = newest;
    if (baselineRef.current === null && newest > 0) {
      writeSeen(storageKey, newest);
      setBaseline(newest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, storageKey]);

  const isNew = useCallback(
    (item) => {
      if (!item || baseline === null) return false;
      const id = getId(item);
      if (id !== undefined && dismissed.has(id)) return false;
      return toMillis(getTime(item)) > baseline;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseline, dismissed]
  );

  const markSeen = useCallback((item) => {
    const id = getId(item);
    if (id === undefined) return;
    setDismissed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isNew, markSeen };
}
