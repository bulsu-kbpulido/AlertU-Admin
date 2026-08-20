import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase'; // Firestore instance
import { useCitizenStore } from './useCitizenStore'; // Zustand store
import { socket, joinSocketRoom } from '../socket'; // Socket instance

// Clean & Simple Lucide Icons
import {
  User,
  Mail,
  Phone,
  MapPin,
  Shield,
  Calendar,
  Clock,
  Circle
} from 'lucide-react';

// ── Simple Skeleton Loader ──
const Skeleton = ({ className = '', ...props }) => {
  return (
    <div
      className={`animate-pulse rounded-md bg-slate-200 dark:bg-slate-700 ${className}`}
      {...props}
    />
  );
};

const View_Citizens = ({ isOpen, citizen: propCitizen, onClose }) => {
  const updateLiveCitizen = useCitizenStore((state) => state.updateLiveCitizen);

  const [citizen, setCitizen] = useState(propCitizen);
  const [isLoading, setIsLoading] = useState(true);

  // Extract a consistent unique ID for the citizen
  const citizenId = propCitizen?.authUid || propCitizen?.id || propCitizen?.citizenID || propCitizen?.cid;

  // 🔄 FIX: Reset state whenever propCitizen or citizenId changes
  useEffect(() => {
    if (propCitizen) {
      setCitizen(propCitizen);
      setIsLoading(true); // Reset loading so old data doesn't flash
    }
  }, [propCitizen, citizenId]);

  const handleClose = () => {
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  // ⚡ 1. Firestore Real-time Updates
  useEffect(() => {
    if (!isOpen || !citizenId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const citizenRef = doc(db, 'citizens', String(citizenId));

    const unsubscribeFirestore = onSnapshot(
      citizenRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const updatedData = { id: snapshot.id, ...snapshot.data() };
          setCitizen(updatedData);
          if (updateLiveCitizen) updateLiveCitizen(updatedData);
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('Firestore Error:', error);
        setIsLoading(false);
      }
    );

    return () => unsubscribeFirestore();
  }, [isOpen, citizenId, updateLiveCitizen]);

  // ⚡ 2. Socket.IO Real-time Updates
  useEffect(() => {
    if (!isOpen || !citizenId) return;

    joinSocketRoom('admins');

    const handleDataUpdate = (data) => {
      const targetId = String(data.citizenID || data.cid || data.id || data.authUid || '');

      if (targetId && String(citizenId) === targetId) {
        setCitizen((prev) => ({ ...prev, ...data }));
        if (updateLiveCitizen) updateLiveCitizen(data);
      }
    };

    socket.on('citizen_updated', handleDataUpdate);
    socket.on('citizen_presence_changed', handleDataUpdate);
    socket.on('citizen_status_change', handleDataUpdate);
    socket.on('citizen_status_updated', handleDataUpdate);

    return () => {
      socket.off('citizen_updated', handleDataUpdate);
      socket.off('citizen_presence_changed', handleDataUpdate);
      socket.off('citizen_status_change', handleDataUpdate);
      socket.off('citizen_status_updated', handleDataUpdate);
    };
  }, [isOpen, citizenId, updateLiveCitizen]);

  if (!isOpen || !citizen) return null;

  // Simple Date Formatter
  const formatDate = (timestamp) => {
    if (!timestamp) return 'Not available';
    let date;
    if (typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    } else if (timestamp._seconds) {
      date = new Date(timestamp._seconds * 1000);
    } else {
      date = new Date(timestamp);
    }
    return isNaN(date.getTime())
      ? 'Not available'
      : date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
  };

  const isOnline = Boolean(citizen.isActive || citizen.isOnline);
  const isDisabled = Boolean(citizen.isDisabled) || citizen.status === 'Disabled';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Modal Header ── */}
        <div className="border-b border-slate-100 dark:border-slate-800 p-6 bg-slate-50/50 dark:bg-slate-900/50">
          {isLoading ? (
            <div className="flex items-center gap-4">
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-56" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
                  <User className="h-7 w-7" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                    {citizen.fullName || 'Citizen Details'}
                  </h2>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                    ID: {citizen.citizenID || citizen.cid || citizen.id || 'N/A'}
                  </p>
                </div>
              </div>

              {/* Real-time Status Badge */}
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                  isOnline
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                <Circle className={`h-2 w-2 fill-current ${isOnline ? 'animate-pulse text-emerald-500' : 'text-slate-400'}`} />
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          )}
        </div>

        {/* ── Modal Body: Content Grid ── */}
        <div className="p-8 space-y-6">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-full rounded-md" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Email */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <Mail className="h-4 w-4 text-blue-500" />
                  Email Address
                </div>
                <p className="text-base font-semibold text-slate-800 dark:text-slate-200 break-all">
                  {citizen.email || 'None'}
                </p>
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <Phone className="h-4 w-4 text-blue-500" />
                  Phone Number
                </div>
                <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  {citizen.phoneNumber || 'None'}
                </p>
              </div>

              {/* Zone / Area */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <MapPin className="h-4 w-4 text-blue-500" />
                  Zone / Area
                </div>
                <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  {citizen.zone || 'Unassigned'}
                </p>
              </div>

              {/* Account Status */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <Shield className="h-4 w-4 text-blue-500" />
                  Account Status
                </div>
                <p
                  className={`text-base font-bold ${
                    isDisabled ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {isDisabled ? 'Disabled' : 'Active'}
                </p>
              </div>

              {/* Date Joined */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <Calendar className="h-4 w-4 text-blue-500" />
                  Date Joined
                </div>
                <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  {formatDate(citizen.createdAt)}
                </p>
              </div>

              {/* Last Seen */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <Clock className="h-4 w-4 text-blue-500" />
                  Last Seen
                </div>
                <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  {formatDate(citizen.lastActiveAt)}
                </p>
              </div>

            </div>
          )}
        </div>

        {/* ── Modal Footer: Single Close Button ── */}
        <div className="border-t border-slate-100 dark:border-slate-800 p-5 px-8 flex justify-end bg-slate-50/50 dark:bg-slate-900/50">
          <button
            onClick={handleClose}
            className="px-6 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm transition-all active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default View_Citizens;