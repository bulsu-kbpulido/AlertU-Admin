import React, { useState, useEffect, useMemo } from 'react';
import {
  Bell,
  Clock,
  Send,
  Edit3,
  Archive,
  Plus,
  Search,
  Flame,
  Wind,
  Droplets,
  AlertTriangle,
  RotateCw,
  Eye,
  Trash2,
  Ban,
  ArrowLeft,
  RotateCcw,
  Users,
  MapPin,
  X,
  Siren,
  ChevronDown
} from 'lucide-react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { toast } from 'sonner';
import { db, auth } from '../firebase';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { useAuditLog } from '../useAuditLog';
import { fetchFromBackend } from '../api';

dayjs.extend(utc);
dayjs.extend(timezone);
const PHILIPPINE_TIMEZONE = 'Asia/Manila';

// Paombong Barangays for target audience selection
const PAOMBONG_BARANGAYS = [
  'Poblacion',
  'San Isidro',
  'San Jose',
  'Santo Rosario',
  'Santo Niño',
  'San Roque',
  'Binakod',
  'Kapitangan',
  'Malumot',
  'Masukol',
  'Pinalagdan',
  'San Vicente',
  'Santa Cruz',
  'Santo Cristo',
];

// Helper to compute expiration milliseconds from string
const calculateExpirationMs = (expiresIn) => {
  switch (expiresIn) {
    case '30 Minutes':
      return 30 * 60 * 1000;
    case '1 Hour':
      return 60 * 60 * 1000;
    case '2 Hours':
      return 2 * 60 * 60 * 1000;
    case '6 Hours':
      return 6 * 60 * 60 * 1000;
    case '12 Hours':
      return 12 * 60 * 60 * 1000;
    case '24 Hours':
      return 24 * 60 * 60 * 1000;
    case '48 Hours':
      return 48 * 60 * 60 * 1000;
    case 'Never':
    default:
      return null;
  }
};

const LOCAL_STORAGE_KEY = 'alertu_admin_alerts_cache_v3';

export default function Alert_Management() {
  // Navigation sub-views: 'list' | 'archive' | 'create' | 'edit'
  const [currentView, setCurrentView] = useState('list');
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Alerts database state (starts empty, synchronized with Firestore)
  const [alerts, setAlerts] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Fallback
    }
    return [];
  });

  // Modal / Form state
  const [selectedAlertForEdit, setSelectedAlertForEdit] = useState(null);
  const [selectedAlertForView, setSelectedAlertForView] = useState(null);

  // Form Fields State
  const [formData, setFormData] = useState({
    type: 'General',
    title: '',
    message: '',
    recipientScope: 'All Residents',
    barangays: [],
    isScheduled: false,
    scheduledDateTime: '',
    expiresIn: '1 Hour',
  });

  const currentUser = auth.currentUser;
  const { logMovement } = useAuditLog({
    adminId: currentUser?.uid || 'ADMIN-SYSTEM',
    adminName: currentUser?.displayName || currentUser?.email || 'System Admin',
  });

  // Local caching
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(alerts));
    } catch (err) {
      console.warn('Failed to cache alerts in localStorage:', err);
    }
  }, [alerts]);

  // ===========================================================================
  // REAL-TIME FIRESTORE LISTENER (NO SAMPLES / SEEDS)
  // ===========================================================================
  useEffect(() => {
    let isSubscribed = true;
    const alertsColRef = collection(db, 'alerts');

    const unsubscribe = onSnapshot(
      alertsColRef,
      (snapshot) => {
        if (!isSubscribed) return;

        if (!snapshot.empty) {
          const fetchedAlerts = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              ...data,
            };
          });

          // Check for expired active alerts in real-time
          const nowMs = Date.now();
          const verifiedAlerts = fetchedAlerts.map((item) => {
            if (
              item.status === 'active' &&
              item.expiresAt &&
              new Date(item.expiresAt).getTime() < nowMs
            ) {
              return { ...item, status: 'sent' };
            }
            return item;
          });

          setAlerts(verifiedAlerts);
        } else {
          setAlerts([]);
        }
        setIsLoading(false);
      },
      (error) => {
        console.warn('Firestore alerts listener error:', error.message);
        setIsLoading(false);
      }
    );

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, []);

  // Filtered lists
  const nonArchivedAlerts = useMemo(() => {
    return alerts.filter((a) => !a.isArchived);
  }, [alerts]);

  const archivedAlerts = useMemo(() => {
    return alerts.filter((a) => a.isArchived);
  }, [alerts]);

  // Metric counts accurate with the system
  const metrics = useMemo(() => {
    let active = 0;
    let scheduled = 0;
    let sent = 0;
    let drafts = 0;

    const nowMs = Date.now();

    nonArchivedAlerts.forEach((a) => {
      const st = (a.status || '').toLowerCase();
      const isExpired = a.expiresAt && new Date(a.expiresAt).getTime() < nowMs;

      if (st === 'active' && !isExpired) {
        active++;
      } else if (st === 'scheduled') {
        scheduled++;
      } else if (st === 'sent' || (st === 'active' && isExpired)) {
        sent++;
      } else if (st === 'draft') {
        drafts++;
      }
    });

    return { active, scheduled, sent, drafts };
  }, [nonArchivedAlerts]);

  // Filtered list by tab and search
  const displayedAlerts = useMemo(() => {
    const nowMs = Date.now();
    return nonArchivedAlerts.filter((item) => {
      const isExpired = item.expiresAt && new Date(item.expiresAt).getTime() < nowMs;
      const effectiveStatus = (item.status === 'active' && isExpired) ? 'sent' : item.status?.toLowerCase();

      // Tab filter
      if (activeFilter !== 'All') {
        if (effectiveStatus !== activeFilter.toLowerCase()) {
          return false;
        }
      }

      // Search filter
      if (searchQuery.trim()) {
        const queryLower = searchQuery.toLowerCase();
        const titleMatch = item.title?.toLowerCase().includes(queryLower);
        const msgMatch = item.message?.toLowerCase().includes(queryLower);
        const locMatch = item.targetLocation?.toLowerCase().includes(queryLower);
        const typeMatch = item.type?.toLowerCase().includes(queryLower);
        if (!titleMatch && !msgMatch && !locMatch && !typeMatch) {
          return false;
        }
      }
      return true;
    });
  }, [nonArchivedAlerts, activeFilter, searchQuery]);

  // Helper to get Category styling and icon
  const getAlertVisuals = (type = '') => {
    const t = type.toLowerCase();
    if (t.includes('fire')) {
      return {
        icon: Flame,
        color: 'text-rose-600 dark:text-rose-400',
        bg: 'bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/50',
      };
    }
    if (t.includes('flood') || t.includes('water')) {
      return {
        icon: Droplets,
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/50',
      };
    }
    if (t.includes('typhoon') || t.includes('wind') || t.includes('storm')) {
      return {
        icon: Wind,
        color: 'text-purple-600 dark:text-purple-400',
        bg: 'bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-900/50',
      };
    }
    if (t.includes('earthquake')) {
      return {
        icon: AlertTriangle,
        color: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/50',
      };
    }
    return {
      icon: Siren,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/50',
    };
  };

  // Helper for Status Badge
  const renderStatusBadge = (status, expiresAt) => {
    let s = (status || '').toLowerCase();
    if (s === 'active' && expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      s = 'sent';
    }

    switch (s) {
      case 'active':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
            active
          </span>
        );
      case 'scheduled':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400">
            scheduled
          </span>
        );
      case 'sent':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400">
            sent
          </span>
        );
      case 'draft':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            draft
          </span>
        );
      case 'canceled':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
            canceled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {status}
          </span>
        );
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers Connected to Firestore
  // ---------------------------------------------------------------------------

  const handleOpenCreateForm = () => {
    setSelectedAlertForEdit(null);
    setFormData({
      type: 'General',
      title: '',
      message: '',
      recipientScope: 'All Residents',
      barangays: [],
      isScheduled: false,
      scheduledDateTime: '',
      expiresIn: '1 Hour',
    });
    setCurrentView('create');
  };

  const handleOpenEditForm = (alertItem) => {
    setSelectedAlertForEdit(alertItem);
    setFormData({
      type: alertItem.type || 'General',
      title: alertItem.title || '',
      message: alertItem.message || '',
      recipientScope: alertItem.recipientScope || 'All Residents',
      barangays: alertItem.barangays || [],
      isScheduled: alertItem.status === 'scheduled',
      scheduledDateTime: alertItem.scheduledFor || '',
      expiresIn: alertItem.expiresIn || '1 Hour',
    });
    setCurrentView('edit');
  };

  // Cancel Alert -> writes to Firestore
  const handleCancelAlert = async (alertItem) => {
    const updated = alerts.map((a) =>
      a.id === alertItem.id ? { ...a, status: 'canceled' } : a
    );
    setAlerts(updated);

    try {
      const alertDocRef = doc(db, 'alerts', alertItem.id);
      await setDoc(
        alertDocRef,
        {
          status: 'canceled',
          canceledAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Firestore update warning:', err.message);
    }

    logMovement('ALERT_CANCELLED', alertItem.id, { title: alertItem.title });
    toast.warning('Alert Cancelled', {
      description: `"${alertItem.title}" has been marked as canceled.`,
    });
  };

  // Send Now -> writes to Firestore
  const handleSendNow = async (alertItem) => {
    const now = dayjs().tz(PHILIPPINE_TIMEZONE);
    const nowFormatted = now.format('MMM D, YYYY, hh:mm A');
    const expMs = calculateExpirationMs(alertItem.expiresIn || '1 Hour');
    const newExpiresAt = expMs ? new Date(Date.now() + expMs).toISOString() : null;

    const updated = alerts.map((a) =>
      a.id === alertItem.id
        ? {
            ...a,
            status: 'active',
            timestampText: `Sent: ${nowFormatted}`,
            expiresAt: newExpiresAt,
          }
        : a
    );
    setAlerts(updated);

    try {
      const alertDocRef = doc(db, 'alerts', alertItem.id);
      await setDoc(
        alertDocRef,
        {
          status: 'active',
          timestampText: `Sent: ${nowFormatted}`,
          sentAt: serverTimestamp(),
          expiresAt: newExpiresAt,
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Firestore update warning:', err.message);
    }

    // Direct FCM broadcast trigger via Backend
    fetchFromBackend('/alerts/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        alertId: alertItem.id,
        alertData: { ...alertItem, status: 'active' },
      }),
    }).catch(() => {});

    logMovement('ALERT_BROADCAST_NOW', alertItem.id, { title: alertItem.title });
    toast.success('Alert Broadcasted', {
      description: `"${alertItem.title}" is now active in the system.`,
    });
  };

  // Resend -> writes to Firestore
  const handleResend = async (alertItem) => {
    const now = dayjs().tz(PHILIPPINE_TIMEZONE);
    const nowFormatted = now.format('MMM D, YYYY, hh:mm A');
    const expMs = calculateExpirationMs(alertItem.expiresIn || '1 Hour');
    const newExpiresAt = expMs ? new Date(Date.now() + expMs).toISOString() : null;

    const updated = alerts.map((a) =>
      a.id === alertItem.id
        ? {
            ...a,
            status: 'active',
            timestampText: `Sent: ${nowFormatted}`,
            expiresAt: newExpiresAt,
          }
        : a
    );
    setAlerts(updated);

    try {
      const alertDocRef = doc(db, 'alerts', alertItem.id);
      await setDoc(
        alertDocRef,
        {
          status: 'active',
          timestampText: `Sent: ${nowFormatted}`,
          resentAt: serverTimestamp(),
          expiresAt: newExpiresAt,
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Firestore update warning:', err.message);
    }

    // Direct FCM broadcast trigger via Backend
    fetchFromBackend('/alerts/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        alertId: alertItem.id,
        alertData: { ...alertItem, status: 'active' },
      }),
    }).catch(() => {});

    logMovement('ALERT_RESENT', alertItem.id, { title: alertItem.title });
    toast.success('Alert Resent', {
      description: `"${alertItem.title}" re-broadcasted successfully.`,
    });
  };

  // Archive Alert -> writes to Firestore
  const handleArchiveAlert = async (alertItem) => {
    const nowFormatted = dayjs().tz(PHILIPPINE_TIMEZONE).format('MMM D, YYYY, hh:mm A');
    const updated = alerts.map((a) =>
      a.id === alertItem.id
        ? {
            ...a,
            isArchived: true,
            archivedAtText: `Archived: ${nowFormatted}`,
          }
        : a
    );
    setAlerts(updated);

    try {
      const alertDocRef = doc(db, 'alerts', alertItem.id);
      await setDoc(
        alertDocRef,
        {
          isArchived: true,
          archivedAtText: `Archived: ${nowFormatted}`,
          archivedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Firestore archive warning:', err.message);
    }

    logMovement('ALERT_ARCHIVED', alertItem.id, { title: alertItem.title });
    toast.info('Alert Archived', {
      description: `"${alertItem.title}" was moved to archive.`,
    });
  };

  // Restore Alert -> writes to Firestore
  const handleRestoreAlert = async (alertItem) => {
    const updated = alerts.map((a) =>
      a.id === alertItem.id
        ? {
            ...a,
            isArchived: false,
          }
        : a
    );
    setAlerts(updated);

    try {
      const alertDocRef = doc(db, 'alerts', alertItem.id);
      await setDoc(
        alertDocRef,
        {
          isArchived: false,
          restoredAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Firestore restore warning:', err.message);
    }

    logMovement('ALERT_RESTORED', alertItem.id, { title: alertItem.title });
    toast.success('Alert Restored', {
      description: `"${alertItem.title}" has been restored to active list.`,
    });
  };

  // Delete Permanently -> deletes from Firestore
  const handleDeletePermanent = async (alertItem) => {
    const updated = alerts.filter((a) => a.id !== alertItem.id);
    setAlerts(updated);

    try {
      const alertDocRef = doc(db, 'alerts', alertItem.id);
      await deleteDoc(alertDocRef);
    } catch (err) {
      console.warn('Firestore delete error:', err.message);
    }

    logMovement('ALERT_DELETED_PERMANENT', alertItem.id, { title: alertItem.title });
    toast.error('Alert Deleted', {
      description: `"${alertItem.title}" was permanently removed from database.`,
    });
  };

  // Form submission: Save changes or publish
  const handleSaveForm = async (asDraft = false) => {
    if (!formData.title.trim()) {
      toast.error('Please enter an alert title.');
      return;
    }
    if (!formData.message.trim()) {
      toast.error('Please enter an alert message.');
      return;
    }
    if (formData.recipientScope === 'Specific Barangays' && formData.barangays.length === 0) {
      toast.error('Please select at least one Barangay.');
      return;
    }

    const now = dayjs().tz(PHILIPPINE_TIMEZONE);
    const nowFormatted = now.format('MMM D, YYYY, hh:mm A');

    let calculatedStatus = 'active';
    let timeLabel = `Sent: ${nowFormatted}`;

    if (asDraft) {
      calculatedStatus = 'draft';
      timeLabel = `Draft saved: ${nowFormatted}`;
    } else if (formData.isScheduled && formData.scheduledDateTime) {
      calculatedStatus = 'scheduled';
      const schedFormatted = dayjs(formData.scheduledDateTime).format('MMM D, YYYY, hh:mm A');
      timeLabel = `Scheduled: ${schedFormatted}`;
    }

    let recipientsLabel = '15,000 recipients';
    let locLabel = 'All Barangays';

    if (formData.recipientScope === 'Specific Barangays') {
      const count = formData.barangays.length;
      recipientsLabel = `${count * 1200} recipients`;
      locLabel = formData.barangays.join(', ');
    }

    const expMs = calculateExpirationMs(formData.expiresIn);
    const calculatedExpiresAt = expMs ? new Date(Date.now() + expMs).toISOString() : null;

    if (selectedAlertForEdit) {
      // UPDATE EXISTING FIRESTORE DOCUMENT
      const updatedAlert = {
        ...selectedAlertForEdit,
        type: formData.type,
        title: formData.title.trim(),
        message: formData.message.trim(),
        recipientScope: formData.recipientScope,
        barangays: formData.barangays,
        status: calculatedStatus,
        timestampText: timeLabel,
        expiresIn: formData.expiresIn,
        expiresAt: calculatedExpiresAt,
        targetLocation: locLabel,
        recipientsCount: recipientsLabel,
        updatedAt: new Date().toISOString(),
      };

      const nextAlerts = alerts.map((a) => (a.id === selectedAlertForEdit.id ? updatedAlert : a));
      setAlerts(nextAlerts);

      try {
        const docRef = doc(db, 'alerts', selectedAlertForEdit.id);
        await setDoc(docRef, {
          ...updatedAlert,
          updatedAtServer: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.warn('Firestore update warning:', err.message);
      }

      logMovement('ALERT_UPDATED', selectedAlertForEdit.id, { title: updatedAlert.title });
      toast.success('Alert Updated', { description: `"${updatedAlert.title}" was saved successfully.` });
    } else {
      // CREATE NEW FIRESTORE DOCUMENT
      const newId = `alert-${Date.now()}`;
      const newAlert = {
        id: newId,
        type: formData.type,
        title: formData.title.trim(),
        message: formData.message.trim(),
        recipientScope: formData.recipientScope,
        barangays: formData.barangays,
        status: calculatedStatus,
        timestampText: timeLabel,
        expiresIn: formData.expiresIn,
        expiresAt: calculatedExpiresAt,
        targetLocation: locLabel,
        recipientsCount: recipientsLabel,
        createdAt: now.toISOString(),
        isArchived: false,
        createdBy: currentUser?.email || 'admin',
      };

      const nextAlerts = [newAlert, ...alerts];
      setAlerts(nextAlerts);

      try {
        const docRef = doc(db, 'alerts', newId);
        await setDoc(docRef, {
          ...newAlert,
          createdAtServer: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Firestore create document error:', err.message);
      }

      logMovement('ALERT_CREATED', newId, { title: newAlert.title });
      toast.success(asDraft ? 'Draft Saved' : 'Alert Created & Broadcasted', {
        description: `"${newAlert.title}" is now ${calculatedStatus}.`,
      });
    }

    // Direct FCM broadcast trigger via Backend if alert is active
    if (calculatedStatus === 'active') {
      const activePayload = selectedAlertForEdit
        ? { ...selectedAlertForEdit, ...formData, status: 'active' }
        : { ...formData, status: 'active' };
      fetchFromBackend('/alerts/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          alertId: selectedAlertForEdit ? selectedAlertForEdit.id : undefined,
          alertData: activePayload,
        }),
      }).catch(() => {});
    }

    setCurrentView('list');
  };

  // Toggle specific barangay
  const handleToggleBarangay = (brgy) => {
    setFormData((prev) => {
      const exists = prev.barangays.includes(brgy);
      return {
        ...prev,
        barangays: exists ? prev.barangays.filter((b) => b !== brgy) : [...prev.barangays, brgy],
      };
    });
  };

  // Select all barangays
  const handleSelectAllBarangays = () => {
    setFormData((prev) => ({
      ...prev,
      barangays: [...PAOMBONG_BARANGAYS],
    }));
  };

  // Clear all barangays
  const handleClearAllBarangays = () => {
    setFormData((prev) => ({
      ...prev,
      barangays: [],
    }));
  };

  return (
    <div className="space-y-6 pb-12">
      {/* -------------------------------------------------------------------- */}
      {/* PAGE HEADER & MONITORING TITLE (Date line removed per user request)  */}
      {/* -------------------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Dashboard Monitoring
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time overview of incident reports and active alerts
          </p>
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* VIEW: MAIN LIST VIEW                                                 */}
      {/* -------------------------------------------------------------------- */}
      {currentView === 'list' && (
        <div className="space-y-6">
          {/* STAT METRIC CARDS (4 Cards accurate with Firestore state) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Active Alerts */}
            <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-400/80 dark:border-emerald-500/60 bg-white dark:bg-slate-900 p-5 shadow-xs transition-all hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Active Alerts
                  </p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {metrics.active}
                  </p>
                </div>
                <div className="h-11 w-11 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Bell className="h-5 w-5" />
                </div>
              </div>
            </div>

            {/* Card 2: Scheduled */}
            <div className="relative overflow-hidden rounded-2xl border border-purple-300 dark:border-purple-800/60 bg-white dark:bg-slate-900 p-5 shadow-xs transition-all hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Scheduled
                  </p>
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                    {metrics.scheduled}
                  </p>
                </div>
                <div className="h-11 w-11 rounded-full bg-purple-50 dark:bg-purple-950/40 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <Clock className="h-5 w-5" />
                </div>
              </div>
            </div>

            {/* Card 3: Total Sent */}
            <div className="relative overflow-hidden rounded-2xl border border-blue-300 dark:border-blue-800/60 bg-white dark:bg-slate-900 p-5 shadow-xs transition-all hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Total Sent
                  </p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                    {metrics.sent}
                  </p>
                </div>
                <div className="h-11 w-11 rounded-full bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Send className="h-5 w-5" />
                </div>
              </div>
            </div>

            {/* Card 4: Drafts */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs transition-all hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Drafts
                  </p>
                  <p className="text-2xl font-bold text-slate-700 dark:text-slate-300 mt-1">
                    {metrics.drafts}
                  </p>
                </div>
                <div className="h-11 w-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400">
                  <Edit3 className="h-5 w-5" />
                </div>
              </div>
            </div>
          </div>

          {/* MAIN CARD: ALERT MANAGEMENT */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
            {/* CARD TOP TOOLBAR */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <Siren className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Alert Management
                </h2>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setCurrentView('archive')}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <Archive className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  <span>View Archive ({archivedAlerts.length})</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenCreateForm}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Alert</span>
                </button>
              </div>
            </div>

            {/* SEARCH AND FILTER BAR */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800/80">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search alerts..."
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
                {['All', 'Active', 'Scheduled', 'Sent', 'Draft'].map((pill) => {
                  const isActive = activeFilter === pill;
                  return (
                    <button
                      key={pill}
                      type="button"
                      onClick={() => setActiveFilter(pill)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700'
                      }`}
                    >
                      {pill}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ALERTS LIST */}
            <div className="p-4 sm:p-6 space-y-4">
              {displayedAlerts.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="mx-auto h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
                    <Bell className="h-6 w-6" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    No alerts found
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                    {searchQuery
                      ? 'No alerts match your search criteria. Try a different search.'
                      : 'No alerts broadcasted yet. Click "+ Create Alert" to broadcast your first alert.'}
                  </p>
                </div>
              ) : (
                displayedAlerts.map((item) => {
                  const visuals = getAlertVisuals(item.type);
                  const Icon = visuals.icon;
                  const itemStatus = (item.status || '').toLowerCase();

                  return (
                    <div
                      key={item.id}
                      className="group relative rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                        {/* Icon Circle */}
                        <div
                          className={`h-11 w-11 shrink-0 rounded-full border flex items-center justify-center ${visuals.bg} ${visuals.color}`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 min-w-0 space-y-2">
                          {/* Title + Status Badge */}
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                              {item.title}
                            </h3>
                            {renderStatusBadge(item.status, item.expiresAt)}
                          </div>

                          {/* Message Body */}
                          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                            {item.message}
                          </p>

                          {/* Meta details row: Recipients | Location | Time */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400 pt-1">
                            {item.recipientsCount && (
                              <span className="inline-flex items-center gap-1.5">
                                <Users className="h-3.5 w-3.5 text-slate-400" />
                                <span>{item.recipientsCount}</span>
                              </span>
                            )}

                            {item.targetLocation && (
                              <span className="inline-flex items-center gap-1.5">
                                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                                <span>{item.targetLocation}</span>
                              </span>
                            )}

                            {item.timestampText && (
                              <span className="inline-flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-slate-400" />
                                <span>{item.timestampText}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Top-Right Action Buttons */}
                        <div className="flex items-center gap-1.5 self-end sm:self-start shrink-0 pt-2 sm:pt-0">
                          {/* Cancel button (for active alerts) */}
                          {itemStatus === 'active' && (
                            <button
                              type="button"
                              onClick={() => handleCancelAlert(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors cursor-pointer"
                              title="Cancel Alert"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              <span>Cancel</span>
                            </button>
                          )}

                          {/* Resend button (for active & sent alerts) */}
                          {(itemStatus === 'active' || itemStatus === 'sent') && (
                            <button
                              type="button"
                              onClick={() => handleResend(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs cursor-pointer"
                              title="Resend Alert"
                            >
                              <RotateCw className="h-3.5 w-3.5" />
                              <span>Resend</span>
                            </button>
                          )}

                          {/* Send Now button (for scheduled & draft alerts) */}
                          {(itemStatus === 'scheduled' || itemStatus === 'draft') && (
                            <button
                              type="button"
                              onClick={() => handleSendNow(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-xs cursor-pointer"
                              title="Send Now"
                            >
                              <Send className="h-3.5 w-3.5" />
                              <span>Send Now</span>
                            </button>
                          )}

                          {/* Edit button */}
                          <button
                            type="button"
                            onClick={() => handleOpenEditForm(item)}
                            className="p-1.5 rounded-xl text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Edit Alert"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>

                          {/* View details button */}
                          <button
                            type="button"
                            onClick={() => setSelectedAlertForView(item)}
                            className="p-1.5 rounded-xl text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title="View Alert Details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          {/* Archive button */}
                          <button
                            type="button"
                            onClick={() => handleArchiveAlert(item)}
                            className="p-1.5 rounded-xl text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                            title="Archive Alert"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* VIEW: ARCHIVED ALERTS                                                */}
      {/* -------------------------------------------------------------------- */}
      {currentView === 'archive' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
            {/* ARCHIVE HEADER */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <Archive className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Archived Alerts
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setCurrentView('list')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Alerts</span>
              </button>
            </div>

            {/* ARCHIVE ITEMS LIST */}
            <div className="p-4 sm:p-6 space-y-4">
              {archivedAlerts.length === 0 ? (
                <div className="text-center py-12">
                  <Archive className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Archive is empty
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Alerts that you archive will appear here for future restoration.
                  </p>
                </div>
              ) : (
                archivedAlerts.map((item) => {
                  const visuals = getAlertVisuals(item.type);
                  const Icon = visuals.icon;

                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 sm:p-5 shadow-xs transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div
                            className={`h-11 w-11 shrink-0 rounded-full border flex items-center justify-center ${visuals.bg} ${visuals.color}`}
                          >
                            <Icon className="h-5 w-5" />
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                                {item.title}
                              </h3>
                              {renderStatusBadge(item.status, item.expiresAt)}
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                <Archive className="h-3 w-3" />
                                <span>Archived</span>
                              </span>
                            </div>

                            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                              {item.message}
                            </p>

                            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400 pt-1">
                              {item.recipientsCount && (
                                <span className="inline-flex items-center gap-1.5">
                                  <Users className="h-3.5 w-3.5 text-slate-400" />
                                  <span>{item.recipientsCount}</span>
                                </span>
                              )}

                              {item.archivedAtText && (
                                <span className="inline-flex items-center gap-1.5">
                                  <Archive className="h-3.5 w-3.5 text-slate-400" />
                                  <span>{item.archivedAtText}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons: Restore and Permanent Delete */}
                        <div className="flex items-center gap-2 self-end sm:self-start shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRestoreAlert(item)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs cursor-pointer"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Restore</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeletePermanent(item)}
                            className="p-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                            title="Delete Permanently"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* VIEW: CREATE / EDIT ALERT FORM                                       */}
      {/* -------------------------------------------------------------------- */}
      {(currentView === 'create' || currentView === 'edit') && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
            {/* FORM HEADER */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <Edit3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {currentView === 'edit' ? 'Edit Alert' : 'Create Alert'}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setCurrentView('list')}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* FORM BODY */}
            <div className="p-6 sm:p-8 space-y-6 max-w-3xl">
              {/* Alert Type */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Alert Type
                </label>
                <div className="relative">
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full appearance-none rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                  >
                    <option value="General">General</option>
                    <option value="Fire Alert">Fire Alert</option>
                    <option value="Flood Warning">Flood Warning</option>
                    <option value="Typhoon Update">Typhoon Update</option>
                    <option value="Earthquake Alert">Earthquake Alert</option>
                    <option value="Medical Emergency">Medical Emergency</option>
                    <option value="Public Advisory">Public Advisory</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                </div>
              </div>

              {/* Alert Title */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Alert Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. Fire Alert - MacArthur Highway"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>

              {/* Alert Message */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Alert Message
                </label>
                <textarea
                  rows={4}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Enter detailed alert message..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-y"
                />
                <div className="flex justify-start">
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {formData.message.length} characters
                  </span>
                </div>
              </div>

              {/* Recipients Radio Options */}
              <div className="space-y-3 pt-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Recipients
                </label>
                <div className="space-y-2.5">
                  {[
                    'All Residents',
                    'Specific Barangays',
                  ].map((scope) => (
                    <label
                      key={scope}
                      className="flex items-center gap-3 cursor-pointer group"
                    >
                      <input
                        type="radio"
                        name="recipientScope"
                        checked={formData.recipientScope === scope}
                        onChange={() => setFormData({ ...formData, recipientScope: scope })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                      />
                      <span className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
                        {scope}
                      </span>
                    </label>
                  ))}
                </div>

                {/* If "Specific Barangays" chosen, render barangay checklist */}
                {formData.recipientScope === 'Specific Barangays' && (
                  <div className="mt-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Select Target Barangays ({formData.barangays.length}/{PAOMBONG_BARANGAYS.length}):
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllBarangays}
                          className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          Select All
                        </button>
                        <span className="text-slate-300 dark:text-slate-600">•</span>
                        <button
                          type="button"
                          onClick={handleClearAllBarangays}
                          className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {PAOMBONG_BARANGAYS.map((b) => {
                        const isChecked = formData.barangays.includes(b);
                        return (
                          <label
                            key={b}
                            className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleBarangay(b)}
                              className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer h-4 w-4"
                            />
                            <span>{b}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Schedule Alert Checkbox */}
              <div className="space-y-3 pt-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={formData.isScheduled}
                    onChange={(e) => setFormData({ ...formData, isScheduled: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer h-4 w-4"
                  />
                  <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
                    <Clock className="h-4 w-4 text-slate-400" />
                    <span>Schedule Alert</span>
                  </div>
                </label>

                {formData.isScheduled && (
                  <div className="pl-7">
                    <input
                      type="datetime-local"
                      value={formData.scheduledDateTime}
                      onChange={(e) => setFormData({ ...formData, scheduledDateTime: e.target.value })}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 px-4 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
                    />
                  </div>
                )}
              </div>

              {/* Alert Expires In */}
              <div className="space-y-2 pt-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Alert Expires In
                </label>
                <div className="relative">
                  <select
                    value={formData.expiresIn}
                    onChange={(e) => setFormData({ ...formData, expiresIn: e.target.value })}
                    className="w-full appearance-none rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                  >
                    <option value="30 Minutes">30 Minutes</option>
                    <option value="1 Hour">1 Hour</option>
                    <option value="2 Hours">2 Hours</option>
                    <option value="6 Hours">6 Hours</option>
                    <option value="12 Hours">12 Hours</option>
                    <option value="24 Hours">24 Hours</option>
                    <option value="48 Hours">48 Hours</option>
                    <option value="Never">Never</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex flex-wrap items-center gap-3 pt-6 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => handleSaveForm(false)}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs cursor-pointer"
                >
                  {currentView === 'edit'
                    ? 'Save Changes'
                    : formData.isScheduled
                    ? 'Schedule Alert'
                    : 'Publish & Broadcast Alert'}
                </button>

                <button
                  type="button"
                  onClick={() => handleSaveForm(true)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Save as Draft
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentView('list')}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* MODAL: VIEW ALERT DETAILS                                            */}
      {/* -------------------------------------------------------------------- */}
      {selectedAlertForView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Siren className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Alert Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAlertForView(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Title & Status
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <h4 className="text-base font-bold text-slate-900 dark:text-white">
                    {selectedAlertForView.title}
                  </h4>
                  {renderStatusBadge(selectedAlertForView.status, selectedAlertForView.expiresAt)}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Type
                </p>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                  {selectedAlertForView.type || 'General'}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Broadcast Message
                </p>
                <div className="mt-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {selectedAlertForView.message}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs pt-2">
                <div>
                  <p className="font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Target Location
                  </p>
                  <p className="font-medium text-slate-700 dark:text-slate-300 mt-1">
                    {selectedAlertForView.targetLocation || 'All Barangays'}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Recipients
                  </p>
                  <p className="font-medium text-slate-700 dark:text-slate-300 mt-1">
                    {selectedAlertForView.recipientsCount || '15,000 residents'}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Audience Scope
                  </p>
                  <p className="font-medium text-slate-700 dark:text-slate-300 mt-1">
                    {selectedAlertForView.recipientScope || 'All Residents'}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Expires In
                  </p>
                  <p className="font-medium text-slate-700 dark:text-slate-300 mt-1">
                    {selectedAlertForView.expiresIn || '1 Hour'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end p-4 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedAlertForView(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
