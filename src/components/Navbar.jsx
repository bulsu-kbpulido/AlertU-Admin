import React, { useState, useEffect } from 'react';
import {
  Bell,
  MessageSquare,
  Trash2,
  Flame,
  AlertTriangle,
  Droplets,
  Clock,
  MapPin,
  ShieldAlert,
  X,
  Menu,
  Radio,
  Phone,
  User,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import { db, auth } from '../firebase'; // Adjust to your firebase configuration path
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
  arrayUnion
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { toast } from 'sonner';

// Import the SOS History Modal Component
import SOShistorymodal from '../sos_emergency/SOShistorymodal';

// MagicUI Components
import { NumberTicker } from "@/components/ui/number-ticker";

// Unified Active Reports Store (synchronizes Dashboard Live Map and Notifications)
import { useActiveReportsStore } from '../useActiveReportsStore';

// Extend dayjs with timezone plugins
dayjs.extend(utc);
dayjs.extend(timezone);

const PHILIPPINE_TIMEZONE = 'Asia/Manila';

// Helper to reliably extract timestamp milliseconds across various Firestore timestamp representations
const getEpochMillis = (raw) => {
  if (!raw) return 0;
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (typeof raw.toDate === 'function') return raw.toDate().getTime();
  if (typeof raw === 'object' && raw.seconds) return raw.seconds * 1000;
  const parsed = new Date(raw).getTime();
  return isNaN(parsed) ? 0 : parsed;
};

// Local storage caching for zero-flicker immediate state rendering
const LOCAL_PREFS_KEY = 'alertu_admin_view_preferences_v2';
const loadCachedPreferences = () => {
  try {
    // Migration: cleanup legacy cache if present
    if (localStorage.getItem('alertu_admin_view_preferences')) {
      localStorage.removeItem('alertu_admin_view_preferences');
    }
    const raw = localStorage.getItem(LOCAL_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};
const saveCachedPreferences = (prefs) => {
  try {
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn('Failed to save view preferences to localStorage:', err);
  }
};

// ==========================================
// ANIMATED DIGIT COMPONENT FOR SMOOTH TICKING
// ==========================================
const AnimatedDigit = ({ value }) => {
  return (
    <div className="relative inline-flex h-[1.25em] w-[0.65em] overflow-hidden justify-center items-center">
      <AnimatePresence mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </div>
  );
};

// Component to render complete ticking time string smoothly
const SmoothClockDisplay = ({ timeString }) => {
  return (
    <span className="inline-flex items-center font-mono font-semibold tracking-tight">
      {timeString.split('').map((char, index) => {
        if (/\d/.test(char)) {
          return <AnimatedDigit key={`digit-${index}-${char}`} value={char} />;
        }
        return (
          <span key={`char-${index}`} className="px-[1px]">
            {char}
          </span>
        );
      })}
    </span>
  );
};

// ==========================================
// SHADCN / ATOMIC COMPONENT WRAPPERS
// ==========================================
const Avatar = ({ children, className = '' }) => (
  <div className={`relative flex h-11 w-11 shrink-0 overflow-hidden rounded-full ${className}`}>
    {children}
  </div>
);

const AvatarImage = ({ src, alt = 'Avatar' }) => (
  <img src={src} alt={alt} className="aspect-square h-full w-full object-cover" />
);

const AvatarFallback = ({ children, className = '' }) => (
  <div className={`flex h-full w-full items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300 ${className}`}>
    {children}
  </div>
);

export default function Navbar({
  onOpenMessages,
  onSelectSos,
  isOpen: isMobileNavOpen = false,
  setIsOpen: setIsMobileNavOpen,
  isMobileSidebarOpen,
  setIsMobileSidebarOpen,
}) {
  const isNavOpen = isMobileSidebarOpen ?? isMobileNavOpen;
  const setNavOpen = setIsMobileSidebarOpen ?? setIsMobileNavOpen;

  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isSosOpen, setIsSosOpen] = useState(false);

  // Authenticated Admin Reference
  const [currentUser, setCurrentUser] = useState(auth.currentUser);

  // Admin dismissal and read preferences (persisted to Firestore doc 'admins/${uid}')
  const [adminPreferences, setAdminPreferences] = useState(() => {
    const cached = loadCachedPreferences();
    return {
      clearedNotificationsAt: cached.clearedNotificationsAt || 0,
      dismissedNotificationIds: Array.isArray(cached.dismissedNotificationIds) ? cached.dismissedNotificationIds : [],
      readNotificationIds: Array.isArray(cached.readNotificationIds) ? cached.readNotificationIds : [],
      clearedSosAt: cached.clearedSosAt || 0,
      dismissedSosIds: Array.isArray(cached.dismissedSosIds) ? cached.dismissedSosIds : [],
      readSosIds: Array.isArray(cached.readSosIds) ? cached.readSosIds : [],
    };
  });

  // Raw real-time stream storage initialized from cache for instant zero-delay badge rendering on refresh
  const [rawReports, setRawReports] = useState(() => {
    const cached = loadCachedPreferences();
    return Array.isArray(cached.cachedRawReports) ? cached.cachedRawReports : [];
  });
  const [rawSosAlerts, setRawSosAlerts] = useState(() => {
    const cached = loadCachedPreferences();
    return Array.isArray(cached.cachedRawSosAlerts) ? cached.cachedRawSosAlerts : [];
  });

  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  // Guard states for deleting / clearing actions
  const [isClearingSos, setIsClearingSos] = useState(false);
  const [isClearingNotifications, setIsClearingNotifications] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState(null);

  // State to store live Admin profile details for the avatar
  const [adminProfile, setAdminProfile] = useState({
    name: 'Administrator',
    department: 'System Administrator',
    avatar: '',
  });

  // State to handle viewing an SOS modal
  const [selectedSosItem, setSelectedSosItem] = useState(null);

  // State for live Philippine time string
  const [phTime, setPhTime] = useState(() => dayjs().tz(PHILIPPINE_TIMEZONE));

  // ==========================================
  // REAL-TIME ADMIN PROFILE & DISMISSAL PREFERENCES SYNC
  // ==========================================
  useEffect(() => {
    let unsubscribeFirestore = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
      }

      if (user) {
        const adminDocRef = doc(db, 'admins', user.uid);

        unsubscribeFirestore = onSnapshot(adminDocRef, (docSnap) => {
          // Ignore local pending-writes snapshot to prevent local optimistic state clobbering
          if (docSnap.metadata?.hasPendingWrites) {
            return;
          }

          const data = docSnap.exists() ? docSnap.data() : {};

          // 1. Sync live avatar and name
          const resolvedName =
            data.name || data.displayName || user.displayName || 'Administrator';

          const resolvedDepartment =
            data.department || 'System Administrator';

          const resolvedAvatar =
            data.avatar || data.photoURL || user.photoURL || '';

          setAdminProfile({
            name: resolvedName,
            department: resolvedDepartment,
            avatar: resolvedAvatar,
          });

          // 2. Sync persistent dismissal and read state safely
          setAdminPreferences((prev) => {
            const newPrefs = {
              clearedNotificationsAt: data.clearedNotificationsAt !== undefined
                ? getEpochMillis(data.clearedNotificationsAt)
                : prev.clearedNotificationsAt,
              dismissedNotificationIds: Array.isArray(data.dismissedNotificationIds)
                ? data.dismissedNotificationIds
                : prev.dismissedNotificationIds,
              readNotificationIds: Array.isArray(data.readNotificationIds)
                ? data.readNotificationIds
                : prev.readNotificationIds,
              clearedSosAt: data.clearedSosAt !== undefined
                ? getEpochMillis(data.clearedSosAt)
                : prev.clearedSosAt,
              dismissedSosIds: Array.isArray(data.dismissedSosIds)
                ? data.dismissedSosIds
                : prev.dismissedSosIds,
              readSosIds: Array.isArray(data.readSosIds)
                ? data.readSosIds
                : prev.readSosIds,
            };

            const currentCached = loadCachedPreferences();
            saveCachedPreferences({
              ...currentCached,
              ...newPrefs,
            });

            return newPrefs;
          });
        }, (error) => {
          console.error('Error syncing admin profile and preferences:', error);
          setAdminProfile({
            name: user.displayName || 'Administrator',
            department: 'System Administrator',
            avatar: user.photoURL || '',
          });
        });
      }
    });

    return () => {
      if (unsubscribeFirestore) unsubscribeFirestore();
      unsubscribeAuth();
    };
  }, []);

  // Helper for generating avatar initials
  const getInitials = (nameStr) => {
    if (!nameStr) return 'A';
    const parts = nameStr.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
    }
    return nameStr.charAt(0).toUpperCase();
  };

  // ==========================================
  // REAL-TIME PHILIPPINE CLOCK TICKER
  // ==========================================
  useEffect(() => {
    const timer = setInterval(() => {
      setPhTime(dayjs().tz(PHILIPPINE_TIMEZONE));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formattedDate = phTime.format('dddd, MMM D, YYYY');
  const formattedTimeString = phTime.format('hh:mm:ss A');

  // ==========================================
  // REALTIME UNREAD MESSAGES LISTENER
  // ==========================================
  useEffect(() => {
    const chatsQuery = query(collection(db, 'chats'));

    const unsubscribe = onSnapshot(chatsQuery, (snapshot) => {
      let count = 0;
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.unreadCountAdmin && data.unreadCountAdmin > 0) {
          count += data.unreadCountAdmin;
        }
      });
      setUnreadMessageCount(count);
    }, (error) => {
      console.error('Error fetching unread message count:', error);
    });

    return () => unsubscribe();
  }, []);

  // ==========================================
  // REALTIME ACTIVE REPORTS NOTIFICATION STREAM (SYNCHRONIZED WITH LIVE MAP)
  // ==========================================
  const activeReports = useActiveReportsStore((state) => state.activeReports);

  useEffect(() => {
    // Subscribe to unified store across active collections (reports, approved_reports, ApprovedAdminReports)
    const unsubscribe = useActiveReportsStore.getState().subscribe();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (Array.isArray(activeReports) && activeReports.length > 0) {
      setRawReports(activeReports);
      const current = loadCachedPreferences();
      saveCachedPreferences({ ...current, cachedRawReports: activeReports });
    } else if (Array.isArray(activeReports) && activeReports.length === 0) {
      setRawReports([]);
      const current = loadCachedPreferences();
      saveCachedPreferences({ ...current, cachedRawReports: [] });
    }
  }, [activeReports]);

  // ==========================================
  // REALTIME FIRESTORE SOS ALERTS LISTENER (READ ONLY)
  // ==========================================
  useEffect(() => {
    const sosQuery = query(
      collection(db, 'sos_alerts'),
      orderBy('updatedAt', 'desc'),
      limit(25)
    );

    const unsubscribe = onSnapshot(sosQuery, (snapshot) => {
      const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        let formattedTime = 'Just now';

        const rawTime = data.updatedAt || data.triggeredAt;
        const rawTimeMillis = getEpochMillis(rawTime);
        if (rawTimeMillis > 0) {
          formattedTime = dayjs(rawTimeMillis).tz(PHILIPPINE_TIMEZONE).format('MMM D, hh:mm A');
        }

        return {
          id: doc.id,
          sosId: data.sosId || doc.id,
          targetRoom: `sos_${data.sosId || doc.id}`,
          citizenName: data.citizenName || data.submitterName || 'Emergency Citizen',
          citizenEmail: data.citizenEmail || data.submitterEmail || data.email || 'N/A',
          phone: data.citizenPhone || data.submitterPhone || data.phone || 'N/A',
          status: data.status || 'ACTIVE',
          address: data.gisLocation?.address || data.address || 'GPS Coordinates Broadcasted',
          locationData: data.gisLocation || data.location || data,
          emergencyContacts: data.emergencyContacts || [],
          sosDetails: data.sosDetails || data.details || '',
          time: formattedTime,
          rawTimeMillis,
          rawData: data
        };
      });

      setRawSosAlerts(items);
      const current = loadCachedPreferences();
      saveCachedPreferences({ ...current, cachedRawSosAlerts: items });
    }, (error) => {
      console.error('Error subscribing to realtime sos_alerts:', error);
    });

    return () => unsubscribe();
  }, []);

  // ==========================================
  // DYNAMIC FILTERING & READ STATE RESOLUTION
  // (Safe: relies on admin preferences without deleting underlying collections)
  // ==========================================
  const notifications = React.useMemo(() => {
    const { clearedNotificationsAt, dismissedNotificationIds, readNotificationIds } = adminPreferences;
    const readSet = new Set(readNotificationIds || []);
    return rawReports
      .filter((item) => {
        if (dismissedNotificationIds && dismissedNotificationIds.includes(item.id)) return false;
        if (clearedNotificationsAt > 0 && item.rawTimeMillis <= clearedNotificationsAt) return false;
        return true;
      })
      .map((item) => ({
        ...item,
        isRead: readSet.has(item.id),
      }));
  }, [rawReports, adminPreferences]);

  const unreadCount = React.useMemo(() => {
    return notifications.filter((item) => !item.isRead).length;
  }, [notifications]);

  const sosAlerts = React.useMemo(() => {
    const { clearedSosAt, dismissedSosIds, readSosIds } = adminPreferences;
    const readSosSet = new Set(readSosIds || []);
    return rawSosAlerts
      .filter((item) => {
        if (dismissedSosIds && dismissedSosIds.includes(item.id)) return false;
        if (clearedSosAt > 0 && item.rawTimeMillis <= clearedSosAt) return false;
        return true;
      })
      .map((item) => ({
        ...item,
        isRead: readSosSet.has(item.id),
      }));
  }, [rawSosAlerts, adminPreferences]);

  const unreadSosCount = React.useMemo(() => {
    return sosAlerts.filter((item) => !item.isRead && item.status === 'ACTIVE').length;
  }, [sosAlerts]);

  // Helper to obtain the active admin Firestore document reference
  const getAdminDocRef = () => {
    const user = auth.currentUser || currentUser;
    if (!user) return null;
    return doc(db, 'admins', user.uid);
  };

  // Toggle handlers (ensures only one popover is active at a time)
  const togglePopover = () => {
    const nextState = !isNotificationOpen;
    setIsNotificationOpen(nextState);
    if (nextState) {
      setIsSosOpen(false);
      handleMarkAllRead();
    }
  };

  const toggleSosPopover = () => {
    const nextState = !isSosOpen;
    setIsSosOpen(nextState);
    if (nextState) {
      setIsNotificationOpen(false);
      handleMarkAllSosRead();
    }
  };

  // Notification Actions
  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.isRead).map((n) => n.id);
    if (unreadIds.length === 0) return;

    const prevRead = Array.isArray(adminPreferences.readNotificationIds)
      ? adminPreferences.readNotificationIds
      : [];
    const nextRead = [...new Set([...prevRead, ...unreadIds])];
    const nextPrefs = { ...adminPreferences, readNotificationIds: nextRead };

    setAdminPreferences(nextPrefs);
    const cached = loadCachedPreferences();
    saveCachedPreferences({ ...cached, ...nextPrefs });

    const ref = getAdminDocRef();
    if (ref) {
      try {
        await setDoc(ref, { readNotificationIds: arrayUnion(...unreadIds) }, { merge: true });
      } catch (err) {
        console.warn('Failed to persist readNotificationIds:', err.message);
      }
    }
  };

  const handleClearAll = async () => {
    if (isClearingNotifications || notifications.length === 0) return;
    setIsClearingNotifications(true);

    const ref = getAdminDocRef();
    const now = Date.now();
    const prevPrefs = { ...adminPreferences };
    const nextPrefs = {
      ...adminPreferences,
      clearedNotificationsAt: now,
      dismissedNotificationIds: [],
    };

    try {
      if (ref) {
        // Persist permanently to Firestore Admin Document
        await setDoc(ref, {
          clearedNotificationsAt: serverTimestamp(),
          dismissedNotificationIds: [],
        }, { merge: true });
      }

      setAdminPreferences(nextPrefs);
      const cached = loadCachedPreferences();
      saveCachedPreferences({ ...cached, ...nextPrefs });
      toast.success('All notifications cleared.');
    } catch (err) {
      console.error('Failed to clear notifications in database:', err);
      toast.error('Failed to clear notifications. Database write failed.');
      // Rollback to maintain accurate state with database
      setAdminPreferences(prevPrefs);
    } finally {
      setIsClearingNotifications(false);
    }
  };

  const handleRemoveSingle = async (e, id) => {
    e.stopPropagation();
    if (isDeletingId) return;
    setIsDeletingId(id);

    const ref = getAdminDocRef();
    const prevPrefs = { ...adminPreferences };
    const currentDismissed = Array.isArray(adminPreferences.dismissedNotificationIds)
      ? adminPreferences.dismissedNotificationIds
      : [];
    const nextDismissed = [...new Set([...currentDismissed, id])];
    const nextPrefs = { ...adminPreferences, dismissedNotificationIds: nextDismissed };

    try {
      if (ref) {
        await setDoc(ref, {
          dismissedNotificationIds: arrayUnion(id),
        }, { merge: true });
      }

      setAdminPreferences(nextPrefs);
      const cached = loadCachedPreferences();
      saveCachedPreferences({ ...cached, ...nextPrefs });
      toast.success('Notification dismissed.');
    } catch (err) {
      console.error('Failed to dismiss notification in database:', err);
      toast.error('Failed to dismiss notification. Database write failed.');
      // Rollback on error
      setAdminPreferences(prevPrefs);
    } finally {
      setIsDeletingId(null);
    }
  };

  // SOS History Actions
  const handleMarkAllSosRead = async () => {
    const unreadActiveIds = sosAlerts.filter((s) => !s.isRead && s.status === 'ACTIVE').map((s) => s.id);
    if (unreadActiveIds.length === 0) return;

    const prevRead = Array.isArray(adminPreferences.readSosIds)
      ? adminPreferences.readSosIds
      : [];
    const nextRead = [...new Set([...prevRead, ...unreadActiveIds])];
    const nextPrefs = { ...adminPreferences, readSosIds: nextRead };

    setAdminPreferences(nextPrefs);
    const cached = loadCachedPreferences();
    saveCachedPreferences({ ...cached, ...nextPrefs });

    const ref = getAdminDocRef();
    if (ref) {
      try {
        await setDoc(ref, { readSosIds: arrayUnion(...unreadActiveIds) }, { merge: true });
      } catch (err) {
        console.warn('Failed to persist readSosIds:', err.message);
      }
    }
  };

  const handleClearAllSos = async () => {
    if (isClearingSos || sosAlerts.length === 0) return;
    setIsClearingSos(true);

    const ref = getAdminDocRef();
    const now = Date.now();
    const prevPrefs = { ...adminPreferences };
    const nextPrefs = {
      ...adminPreferences,
      clearedSosAt: now,
      dismissedSosIds: [],
    };

    try {
      if (ref) {
        await setDoc(ref, {
          clearedSosAt: serverTimestamp(),
          dismissedSosIds: [],
        }, { merge: true });
      }

      setAdminPreferences(nextPrefs);
      const cached = loadCachedPreferences();
      saveCachedPreferences({ ...cached, ...nextPrefs });
      toast.success('SOS History cleared.');
    } catch (err) {
      console.error('Failed to clear SOS history in database:', err);
      toast.error('Failed to clear SOS history. Database write failed.');
      setAdminPreferences(prevPrefs);
    } finally {
      setIsClearingSos(false);
    }
  };

  const handleRemoveSingleSos = async (e, id) => {
    e.stopPropagation();
    if (isDeletingId) return;
    setIsDeletingId(id);

    const ref = getAdminDocRef();
    const prevPrefs = { ...adminPreferences };
    const currentDismissed = Array.isArray(adminPreferences.dismissedSosIds)
      ? adminPreferences.dismissedSosIds
      : [];
    const nextDismissed = [...new Set([...currentDismissed, id])];
    const nextPrefs = { ...adminPreferences, dismissedSosIds: nextDismissed };

    try {
      if (ref) {
        await setDoc(ref, {
          dismissedSosIds: arrayUnion(id),
        }, { merge: true });
      }

      setAdminPreferences(nextPrefs);
      const cached = loadCachedPreferences();
      saveCachedPreferences({ ...cached, ...nextPrefs });
      toast.success('SOS alert dismissed.');
    } catch (err) {
      console.error('Failed to dismiss SOS alert in database:', err);
      toast.error('Failed to dismiss SOS alert. Database write failed.');
      setAdminPreferences(prevPrefs);
    } finally {
      setIsDeletingId(null);
    }
  };

  // Handle clicking on an SOS history item
  const handleSelectSosHistory = (item) => {
    setIsSosOpen(false); // Close the dropdown menu

    // Trigger full SOS dispatch modal in App.jsx root via prop callback
    if (typeof onSelectSos === 'function') {
      onSelectSos(item.rawData || item);
    } else {
      // Fallback local modal if onSelectSos prop is missing
      setSelectedSosItem(item);
    }
  };

  // Icon Mapping Helper
  const getIncidentIcon = (type = '', severity = '') => {
    const lowerType = type.toLowerCase();
    const lowerSev = severity.toLowerCase();

    if (lowerType.includes('flood') || lowerType.includes('water')) {
      return <Droplets className="h-5 w-5 text-blue-500 dark:text-blue-400" />;
    }
    if (lowerType.includes('fire')) {
      return <Flame className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
    }
    if (lowerSev === 'high' || lowerSev === 'critical') {
      return <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-400" />;
    }
    return <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" />;
  };

  // Helper for Severity Badges
  const getSeverityBadge = (severity = '') => {
    const lower = severity.toLowerCase();
    if (lower === 'high' || lower === 'critical') {
      return (
        <span className="inline-flex items-center rounded-md bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-500/30">
          High
        </span>
      );
    }
    if (lower === 'medium') {
      return (
        <span className="inline-flex items-center rounded-md bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-500/30">
          Medium
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
        Low
      </span>
    );
  };

  // Helper for SOS Status Badges
  const getSosStatusBadge = (status = '') => {
    const upper = status.toUpperCase();
    if (upper === 'ACTIVE') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Radio className="h-3 w-3 text-emerald-600 animate-pulse" />
          ACTIVE
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:bg-slate-800 dark:text-slate-400">
        CLOSED
      </span>
    );
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-200/80 bg-white/90 px-4 sm:px-6 lg:px-8 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 transition-colors duration-200 font-sans">
      <div className="flex h-16 sm:h-20 items-center justify-between gap-3 sm:gap-4 lg:gap-6 min-w-0">

        {/* LEFT: REAL-TIME CONNECTED AVATAR, DATE & LIVE PHILIPPINE CLOCK */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0 shrink">
          {/* Mobile hamburger action */}
          <button
            type="button"
            onClick={() => setNavOpen && setNavOpen(!isNavOpen)}
            className="lg:hidden p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            aria-label="Toggle Navigation"
          >
            {isNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-3 cursor-pointer group shrink-0 min-w-0">
            <div className="relative shrink-0">
              <Avatar className="ring-2 ring-blue-500/20 transition-transform group-hover:scale-105">
                {adminProfile.avatar ? (
                  <AvatarImage src={adminProfile.avatar} alt={adminProfile.name} />
                ) : (
                  <AvatarFallback>{getInitials(adminProfile.name)}</AvatarFallback>
                )}
              </Avatar>
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
            </div>

            <div className="hidden md:flex flex-col text-left min-w-0 max-w-[120px] lg:max-w-[180px]">
              <span className="text-sm sm:text-base font-medium leading-snug text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                {adminProfile.name}
              </span>
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400 truncate">
                {adminProfile.department}
              </span>
            </div>
          </div>

          <div className="h-7 w-px bg-slate-200 dark:bg-slate-800 shrink-0 hidden xl:block" />

          {/* DATE & MOVING TICKING CLOCK */}
          <div className="hidden xl:flex items-center gap-1.5 lg:gap-2 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 truncate">
            <span className="truncate hidden 2xl:inline">{formattedDate}</span>
            <span className="hidden 2xl:inline text-slate-300 dark:text-slate-700">•</span>
            <div className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-950/50 px-2.5 py-1 rounded-md border border-blue-200/60 dark:border-blue-900/40 shrink-0">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-emerald-600 dark:text-emerald-400 shrink-0">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                LIVE
              </span>
              <SmoothClockDisplay timeString={formattedTimeString} />
              <span className="text-[10px] font-bold tracking-wider text-blue-500/80 dark:text-blue-400/80 uppercase ml-0.5">
                PST
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT: SOS HISTORY, NOTIFICATIONS & MESSAGES */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">

          {/* 🚨 SOS HISTORY DROPDOWN */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={toggleSosPopover}
              className="group relative inline-flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl bg-orange-600 hover:bg-orange-700 px-2.5 sm:px-3.5 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs transition-all active:scale-[0.98] cursor-pointer outline-none border border-orange-500/50 shrink-0"
              title="SOS Emergency Broadcast History"
            >
              <Radio className="h-4 w-4 shrink-0 animate-pulse" />
              <span className="whitespace-nowrap">SOS History</span>
              {unreadSosCount > 0 && (
                <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs font-bold text-white shrink-0">
                  {unreadSosCount}
                </span>
              )}
            </button>

            {/* FRAMER MOTION SOS POPOVER PANEL */}
            <AnimatePresence>
              {isSosOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsSosOpen(false)}
                  />

                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -8 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="absolute right-0 mt-3 z-50 w-80 sm:w-[26rem] origin-top-right rounded-2xl border border-orange-200 bg-white p-0 shadow-2xl backdrop-blur-xl dark:border-orange-950 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between border-b border-orange-100 bg-orange-50/50 px-5 py-3.5 rounded-t-2xl dark:border-orange-950/50 dark:bg-orange-950/20">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-4.5 w-4.5 text-orange-600 dark:text-orange-400" />
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                          Emergency SOS History
                        </h3>
                      </div>

                      {sosAlerts.length > 0 && (
                        <button
                          onClick={handleClearAllSos}
                          disabled={isClearingSos}
                          title="Clear all SOS history"
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>{isClearingSos ? 'Clearing...' : 'Clear'}</span>
                        </button>
                      )}
                    </div>

                    <div className="max-h-[420px] overflow-y-auto p-2.5 space-y-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                      {sosAlerts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-50 dark:bg-orange-950/40 text-orange-500 mb-3">
                            <ShieldAlert className="h-6 w-6" />
                          </div>
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            No SOS dispatch history
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            Live SOS alerts broadcasted by citizens will record here.
                          </p>
                        </div>
                      ) : (
                        sosAlerts.map((item, index) => (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.15, delay: index * 0.03 }}
                            onClick={() => handleSelectSosHistory(item)}
                            className="group relative flex items-start gap-3 rounded-xl p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:bg-orange-50/70 dark:hover:bg-slate-800/80 cursor-pointer transition-all shadow-xs hover:border-orange-200"
                          >
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100/80 text-orange-600 dark:bg-orange-950 dark:text-orange-400 group-hover:scale-105 transition-transform">
                              <Radio className="h-4.5 w-4.5" />
                            </div>

                            <div className="flex-1 min-w-0 pr-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-orange-600">
                                  {item.citizenName}
                                </p>
                                {getSosStatusBadge(item.status)}
                              </div>

                              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 truncate">
                                <Phone className="h-3 w-3 shrink-0 text-slate-400" />
                                <span className="font-mono font-medium truncate">{item.phone}</span>
                              </p>

                              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                                <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                                <span className="truncate">{item.address}</span>
                              </p>

                              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {item.time}
                                </span>
                                <span className="inline-flex items-center gap-1 font-semibold text-orange-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                  View Modal <ExternalLink className="w-3 h-3" />
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={isDeletingId === item.id}
                              onClick={(e) => handleRemoveSingleSos(e, item.id)}
                              title="Dismiss alert"
                              className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </motion.div>
                        ))
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* 🔔 SHADCN POPOVER NOTIFICATIONS DROPDOWN */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={togglePopover}
              className="group relative inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-xs transition-all hover:bg-violet-700 active:scale-[0.98] dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer outline-none shrink-0"
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="h-[18px] w-[18px] text-white shrink-0 transition-transform group-hover:scale-105" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold text-white ring-2 ring-white dark:ring-slate-900 shrink-0">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* FRAMER MOTION POPOVER PANEL */}
            <AnimatePresence>
              {isNotificationOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsNotificationOpen(false)}
                  />

                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -8 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="absolute right-0 mt-3 z-50 w-80 sm:w-[26rem] origin-top-right rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                      <h3 className="text-base font-medium text-slate-900 dark:text-slate-100">
                        Live Alerts
                      </h3>

                      {notifications.length > 0 && (
                        <button
                          onClick={handleClearAll}
                          disabled={isClearingNotifications}
                          title="Clear all notifications"
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>{isClearingNotifications ? 'Clearing...' : 'Clear All'}</span>
                        </button>
                      )}
                    </div>

                    <div className="max-h-[420px] overflow-y-auto p-2.5 space-y-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                      {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 mb-3">
                            <Bell className="h-6 w-6" />
                          </div>
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            No recent notifications
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            New incident reports will appear here in real-time.
                          </p>
                        </div>
                      ) : (
                        notifications.map((item, index) => (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.15, delay: index * 0.03 }}
                            className="group relative flex items-start gap-3.5 rounded-xl p-3.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors"
                          >
                            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 border border-slate-200/60 dark:bg-slate-800 dark:border-slate-700">
                              {getIncidentIcon(item.incidentType, item.severity)}
                            </div>

                            <div className="flex-1 min-w-0 pr-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                  {item.incidentType}
                                </p>
                                {getSeverityBadge(item.severity)}
                              </div>

                              <p className="mt-1 flex items-center gap-1.5 text-xs font-normal text-slate-600 dark:text-slate-400 truncate">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="truncate">{item.address}</span>
                              </p>

                              <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                                <span className="font-normal">
                                  Citizen: <strong className="font-medium text-slate-700 dark:text-slate-300">{item.submitterName}</strong>
                                </span>
                                <span className="flex items-center gap-1 font-normal">
                                  <Clock className="h-3 w-3" />
                                  {item.time}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={isDeletingId === item.id}
                              onClick={(e) => handleRemoveSingle(e, item.id)}
                              title="Dismiss notification"
                              className="absolute top-3.5 right-3.5 opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </motion.div>
                        ))
                      )}
                    </div>

                    {notifications.length > 0 && (
                      <div className="border-t border-slate-100 p-2.5 text-center dark:border-slate-800">
                        <button
                          onClick={handleMarkAllRead}
                          className="w-full rounded-xl py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
                        >
                          Mark all as read
                        </button>
                      </div>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Messaging Button with MagicUI NumberTicker */}
          <button
            type="button"
            onClick={onOpenMessages}
            className="group relative inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs transition-all hover:bg-blue-700 active:scale-[0.98] dark:bg-blue-600 dark:hover:bg-blue-500 cursor-pointer outline-none shrink-0"
            title="Messages"
            aria-label="Messages"
          >
            <MessageSquare className="h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-105" />
            {unreadMessageCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold text-white ring-2 ring-white dark:ring-slate-900 shrink-0">
                <NumberTicker value={unreadMessageCount} className="text-white font-semibold" />
              </span>
            )}
          </button>

        </div>

      </div>

      {/* RENDER FALLBACK LOCAL SOS HISTORY MODAL WHEN ONSELECTSOS PROP IS NOT PRESENT */}
      {selectedSosItem && !onSelectSos && (
        <SOShistorymodal
          sosId={selectedSosItem.sosId}
          targetRoom={selectedSosItem.targetRoom}
          citizenName={selectedSosItem.citizenName}
          citizenPhone={selectedSosItem.phone}
          citizenEmail={selectedSosItem.citizenEmail}
          locationData={selectedSosItem.locationData}
          emergencyContacts={selectedSosItem.emergencyContacts}
          sosDetails={selectedSosItem.sosDetails}
          status={selectedSosItem.status}
          onClose={() => setSelectedSosItem(null)}
        />
      )}
    </header>
  );
}
