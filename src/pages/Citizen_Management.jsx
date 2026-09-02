import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchFromBackend } from '../api';
import { socket, joinSocketRoom } from '../socket';
import { useCitizenStore } from '../citizen_utilities/useCitizenStore';
import { useAuditLog } from '../useAuditLog';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// Lucide React Icons
import { 
  UserPlus, 
  RefreshCw, 
  Search, 
  Users, 
  Archive, 
  Eye, 
  Edit3, 
  FolderArchive, 
  ChevronLeft, 
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserX,
  Loader2,
  AlertTriangle,
  Wifi,
  WifiOff
} from 'lucide-react';

// Modular Action Modals
import Create_Citizen from '@/citizen_utilities/Create_Citizen';
import Archive_Citizen from '@/citizen_utilities/Archive_Citizen';
import Edit_Citizen from '@/citizen_utilities/Edit_Citizen';
import View_Citizens from '@/citizen_utilities/View_Citizens';

// Extension Component for Vault Table
import ArchivedCitizensTable from '@/citizen_utilities/ArchivedCitizensTable';

// --- Helper Functions ---
const getCitizenId = (c) => c?.citizenID || c?.cid || c?.id;

// Compare the numeric portion of IDs such as CID00000002 and CID00000001.
const getCitizenIdNumber = (citizen) => {
  const value = getCitizenId(citizen);
  const match = String(value ?? '').match(/(\d+)$/);
  return match ? Number(match[1]) : Number.NEGATIVE_INFINITY;
};

const checkIsAccountEnabled = (citizen, storeOverride) => {
  if (!citizen) return false;
  if (typeof storeOverride === 'boolean') {
    return !storeOverride;
  }
  if (typeof citizen.isDisabled === 'boolean') {
    return !citizen.isDisabled;
  }
  return citizen.status === 'Active';
};

const CACHE_STORAGE_KEY = 'alertu_citizens_cache_v1';

// --- Framer Motion Live Presence Indicator ---
const PresenceBadge = ({ isActive }) => {
  return (
    <div className="relative flex items-center h-7 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {isActive ? (
          <motion.span
            key="online-badge"
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400"
          >
            <span className="relative flex h-2 w-2">
              <motion.span
                animate={{ scale: [1, 2, 1], opacity: [0.7, 0, 0.7] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
              />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <Wifi className="h-3 w-3" />
            Online
          </motion.span>
        ) : (
          <motion.span
            key="offline-badge"
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
          >
            <span className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500" />
            <WifiOff className="h-3 w-3" />
            Offline
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Shadcn Style Table Loading Skeleton ---
const TableSkeleton = () => {
  return (
    <div className="w-full">
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between p-4 space-x-4 animate-pulse">
            <div className="h-7 bg-slate-200 dark:bg-slate-700/80 rounded-md w-24"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-slate-200 dark:bg-slate-700/80 rounded w-1/4"></div>
              <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-1/3"></div>
            </div>
            <div className="h-6 bg-slate-200 dark:bg-slate-700/80 rounded-full w-20"></div>
            <div className="h-6 bg-slate-200 dark:bg-slate-700/80 rounded-md w-28"></div>
            <div className="h-6 bg-slate-200 dark:bg-slate-700/80 rounded-full w-16"></div>
            <div className="flex items-center space-x-2">
              <div className="h-8 bg-slate-200 dark:bg-slate-700/80 rounded-md w-14"></div>
              <div className="h-8 bg-slate-200 dark:bg-slate-700/80 rounded-md w-14"></div>
              <div className="h-8 bg-slate-200 dark:bg-slate-700/80 rounded-md w-16"></div>
              <div className="h-8 bg-slate-200 dark:bg-slate-700/80 rounded-md w-16"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Status Alert Modal ---
const StatusToggleAlertDialog = ({ isOpen, citizen, isCurrentlyActive, loading, onConfirm, onClose }) => {
  if (!isOpen || !citizen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4 animate-in fade-in-0 duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 animate-in zoom-in-95 duration-200">
        <div className="flex items-start gap-4">
          <div className={`rounded-full p-3 ${isCurrentlyActive ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'}`}>
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 id="dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {isCurrentlyActive ? 'Disable Citizen Account?' : 'Enable Citizen Account?'}
            </h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Are you sure you want to {isCurrentlyActive ? 'disable' : 'enable'} access for{' '}
              <strong className="text-slate-900 dark:text-slate-200">{citizen.fullName || citizen.citizenID || 'this citizen'}</strong>? 
              {isCurrentlyActive 
                ? ' This will prevent them from submitting new emergency reports or logging into the system.'
                : ' This will restore their active status and permit normal system operations.'}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow transition-colors disabled:opacity-50 ${
              isCurrentlyActive 
                ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500' 
                : 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500'
            }`}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isCurrentlyActive ? 'Yes, Disable Account' : 'Yes, Enable Account'}
          </button>
        </div>
      </div>
    </div>
  );
};

const CitizenManagement = () => {
  useDocumentTitle('Manage Citizens – AlertU');

  const setAccountDisabledState = useCitizenStore((state) => state.setAccountDisabledState);
  const disabledCitizens = useCitizenStore((state) => state.disabledCitizens);

  // 📡 Initialize Audit Log Hook
  const {
    logViewCitizen,
    logRegisterCitizen,
    logEditCitizen,
    logToggleCitizenStatus,
    logArchiveCitizen,
  } = useAuditLog();

  const [citizens, setCitizens] = useState(() => {
    try {
      const cached = sessionStorage.getItem(CACHE_STORAGE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      return [];
    }
  });

  const [loading, setLoading] = useState(() => citizens.length === 0);
  const [error, setError] = useState(null);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  // 🔹 Maximum Rows per Page
  const itemsPerPage = 5;

  const [toggleDialog, setToggleDialog] = useState({
    isOpen: false,
    citizen: null
  });

  const [selectedCitizen, setSelectedCitizen] = useState(null);
  const [modals, setModals] = useState({
    create: false,
    view: false,
    edit: false,
    archive: false
  });

  // Helper to sync local state with session cache
  const updateCitizensStateAndCache = useCallback((updater) => {
    setCitizens((prev) => {
      const updated = typeof updater === 'function' ? updater(prev) : updater;
      try {
        sessionStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to update citizen session storage:', e);
      }
      return updated;
    });
  }, []);

  // 📡 Fetch Records with Cache Warm-up & Revalidation Strategy
  const loadCitizens = useCallback(async (showSkeleton = true, forceRefresh = false) => {
    try {
      if (showSkeleton && citizens.length === 0) {
        setLoading(true);
      }
      setError(null);

      const queryParam = forceRefresh ? `?queryLimit=100&_t=${Date.now()}` : `?queryLimit=100`;
      const response = await fetchFromBackend(`/citizens${queryParam}`);
      
      const rawData = Array.isArray(response) ? response : (response?.citizens || response?.data || []);
      const validData = rawData.filter(c => c && (c.citizenID || c.cid || c.id || c.fullName || c.email));

      updateCitizensStateAndCache(validData);
    } catch (err) {
      console.error('Fetch error:', err);
      if (citizens.length === 0) {
        setError('Failed to sync citizen records with server.');
      } else {
        setError('Working offline / using cached data.');
      }
    } finally {
      setLoading(false);
    }
  }, [citizens.length, updateCitizensStateAndCache]);

  // Handler for smooth citizen registration transition
  const handleCitizenCreated = useCallback(async (newCitizen) => {
    setActiveTab('active');
    setCurrentPage(1);

    if (newCitizen && (newCitizen.citizenID || newCitizen.cid || newCitizen.id)) {
      updateCitizensStateAndCache((prev) => [newCitizen, ...prev]);

      // ⚡ Audit Log Dispatch: Citizen Creation
      logRegisterCitizen(newCitizen);
    }

    setTimeout(async () => {
      await loadCitizens(false, true);
    }, 200);
  }, [loadCitizens, logRegisterCitizen, updateCitizensStateAndCache]);

  // Update Local UI Optimistically
  const updateLocalCitizenState = useCallback((id, isDisabledValue, statusText) => {
    updateCitizensStateAndCache((prev) =>
      prev.map(c => {
        if (String(getCitizenId(c)) === String(id)) {
          return { 
            ...c, 
            isDisabled: isDisabledValue, 
            status: statusText 
          };
        }
        return c;
      })
    );
  }, [updateCitizensStateAndCache]);

  // 🔌 Real-Time Socket Event Handlers & In-Memory Presence Updater
  useEffect(() => {
    loadCitizens(citizens.length === 0);

    if (!socket) return;

    const handleConnect = () => {
      joinSocketRoom('admins');
    };

    if (socket.connected) {
      joinSocketRoom('admins');
    }

    socket.on('connect', handleConnect);

    // Updates presence purely via Socket.IO events
    const handlePresenceChange = (data) => {
      if (!data) return;

      const targetId = String(data.citizenID || data.cid || data.id || data.userId || '');
      const isActiveStatus = typeof data.isActive === 'boolean'
        ? data.isActive
        : data.isOnline === true || data.status === 'Online';

      if (!targetId) {
        loadCitizens(false);
        return;
      }

      updateCitizensStateAndCache((prevCitizens) => {
        let matchFound = false;

        const updatedList = prevCitizens.map((citizen) => {
          const currentId = String(getCitizenId(citizen) || '');
          if (currentId === targetId) {
            matchFound = true;
            return {
              ...citizen,
              isActive: isActiveStatus,
              isOnline: isActiveStatus
            };
          }
          return citizen;
        });

        if (!matchFound) {
          loadCitizens(false);
          return prevCitizens;
        }

        return updatedList;
      });
    };

    const handleGeneralUpdate = () => {
      loadCitizens(false, true);
    };

    const handleCreatedSocketEvent = (data) => {
      handleCitizenCreated(data);
    };

    socket.on('citizen_presence_changed', handlePresenceChange);
    socket.on('citizen_created', handleCreatedSocketEvent);
    socket.on('citizen_updated', handleGeneralUpdate);
    socket.on('citizen_archived', handleGeneralUpdate);
    socket.on('citizen_restored', handleGeneralUpdate);
    socket.on('citizen_permanently_deleted', handleGeneralUpdate);
    socket.on('citizen_status_changed', handleGeneralUpdate);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('citizen_presence_changed', handlePresenceChange);
      socket.off('citizen_created', handleCreatedSocketEvent);
      socket.off('citizen_updated', handleGeneralUpdate);
      socket.off('citizen_archived', handleGeneralUpdate);
      socket.off('citizen_restored', handleGeneralUpdate);
      socket.off('citizen_permanently_deleted', handleGeneralUpdate);
      socket.off('citizen_status_changed', handleGeneralUpdate);
    };
  }, [loadCitizens, handleCitizenCreated, updateCitizensStateAndCache, citizens.length]);

  const openModal = (type, citizen = null) => {
    setSelectedCitizen(citizen);
    setModals(prev => ({ ...prev, [type]: true }));

    // ⚡ Audit Log Dispatch: View Profile Movement
    if (type === 'view' && citizen) {
      logViewCitizen(citizen);
    }
  };

  const closeModal = (type) => {
    setModals(prev => ({ ...prev, [type]: false }));
    if (type !== 'create') setSelectedCitizen(null);
  };

  const triggerStatusConfirm = (citizen) => {
    setToggleDialog({ isOpen: true, citizen });
  };

  const confirmToggleStatus = async () => {
    const citizen = toggleDialog.citizen;
    if (!citizen) return;

    const citizenId = getCitizenId(citizen);
    const storeOverride = disabledCitizens[citizenId];
    const currentlyActive = checkIsAccountEnabled(citizen, storeOverride);
    
    const nextIsDisabled = currentlyActive;
    const nextStatus = currentlyActive ? 'Disabled' : 'Active';

    const actionTag = setAccountDisabledState(citizenId, nextIsDisabled);

    try {
      setActionLoadingId(citizenId);

      updateLocalCitizenState(citizenId, nextIsDisabled, nextStatus);

      await fetchFromBackend(`/citizens/${citizenId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          isDisabled: nextIsDisabled,
          status: nextStatus,
          actionTag
        })
      });

      // ⚡ Audit Log Dispatch: Toggle Account Status
      await logToggleCitizenStatus(citizen, nextIsDisabled);

      setToggleDialog({ isOpen: false, citizen: null });
    } catch (err) {
      console.error('Failed to update citizen status:', err);
      setAccountDisabledState(citizenId, !nextIsDisabled);
      loadCitizens(false, true);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Safe Search & Multi-Filter Logic
  const filteredCitizens = useMemo(() => {
    return citizens.filter(citizen => {
      const matchesTab = activeTab === 'archived' ? citizen.isArchived === true : !citizen.isArchived;
      if (!matchesTab) return false;

      const citizenId = getCitizenId(citizen);
      const isAccountEnabled = checkIsAccountEnabled(citizen, disabledCitizens[citizenId]);
      const isOnline = Boolean(citizen.isActive || citizen.isOnline);

      if (statusFilter === 'Active' && !isAccountEnabled) return false;
      if (statusFilter === 'Disabled' && isAccountEnabled) return false;
      if (statusFilter === 'Online' && !isOnline) return false;
      if (statusFilter === 'Offline' && isOnline) return false;

      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;

      return (
        citizenId?.toString().toLowerCase().includes(term) ||
        citizen.fullName?.toLowerCase().includes(term) ||
        citizen.email?.toLowerCase().includes(term) ||
        citizen.zone?.toLowerCase().includes(term) ||
        citizen.phoneNumber?.toLowerCase().includes(term)
      );
    }).sort((a, b) => getCitizenIdNumber(b) - getCitizenIdNumber(a));
  }, [citizens, activeTab, statusFilter, searchTerm, disabledCitizens]);

  // Reset page when search, tab, or filter updates
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeTab, statusFilter]);

  const totalPages = Math.ceil(filteredCitizens.length / itemsPerPage) || 1;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedCitizens = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredCitizens.slice(start, start + itemsPerPage);
  }, [filteredCitizens, currentPage, itemsPerPage]);

  const activeCount = citizens.filter(c => !c.isArchived).length;
  const archivedCount = citizens.filter(c => c.isArchived).length;

  // Filter options config for Segmented Control
  const filterOptions = [
    { label: 'All', value: 'ALL' },
    { label: 'Online', value: 'Online' },
    { label: 'Offline', value: 'Offline' },
    { label: 'Active', value: 'Active' },
    { label: 'Disabled', value: 'Disabled' },
  ];

  return (
    <div className="w-full p-6 font-sans text-slate-900 dark:text-slate-100 transition-colors duration-200">
      
      {/* Header */}
      <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Citizen Directory</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage registered citizen accounts, monitor online presence, and adjust profile parameters.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => openModal('create')} 
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 focus:outline-none transition-colors cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            Register Citizen
          </button>
          <button 
            onClick={() => loadCitizens(true, true)} 
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </button>
        </div>
      </header>

      {/* Main Card Wrapper */}
      <div className="w-full rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 px-6">
          <button
            onClick={() => setActiveTab('active')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'active'
                ? 'border-blue-600 bg-white text-blue-600 dark:bg-slate-900 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Users className="h-4 w-4" />
            Active Accounts
            <span className="ml-1 rounded-full bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {activeCount}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('archived')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'archived'
                ? 'border-blue-600 bg-white text-blue-600 dark:bg-slate-900 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Archive className="h-4 w-4" />
            Archived Vault
            <span className="ml-1 rounded-full bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {archivedCount}
            </span>
          </button>
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-col gap-4 border-b border-slate-200 dark:border-slate-800 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              aria-label="Search citizens"
              placeholder="Search by Citizen ID, full name, email, or zone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white pl-9 pr-4 py-2 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Button Group Filter */}
          {activeTab === 'active' && (
            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80">
              {filterOptions.map((opt) => {
                const isSelected = statusFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer ${
                      isSelected
                        ? 'text-slate-900 dark:text-white font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="activeFilterPill"
                        className="absolute inset-0 bg-white dark:bg-slate-900 rounded-md shadow-sm border border-slate-200/60 dark:border-slate-700/60"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Table Content Switcher */}
        {activeTab === 'archived' ? (
          <ArchivedCitizensTable 
            searchTerm={searchTerm} 
            onViewCitizen={(citizen) => openModal('view', citizen)}
            onArchiveModal={(citizen) => openModal('archive', citizen)}
            onRefresh={() => loadCitizens(true, true)}
          />
        ) : loading ? (
          <TableSkeleton />
        ) : error && citizens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-red-500" />
            <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={() => loadCitizens(true, true)}
              className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              Retry Sync
            </button>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            {error && citizens.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50 px-6 py-2 text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="px-6 py-4">Citizen ID</th>
                  <th className="px-6 py-4">Full Name</th>
                  <th className="px-6 py-4">Presence</th>
                  <th className="px-6 py-4">Location Address</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedCitizens.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400">
                      <UserCheck className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" />
                      No records match your selected criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedCitizens.map((citizen) => {
                    const citizenId = getCitizenId(citizen);
                    const isAccountEnabled = checkIsAccountEnabled(citizen, disabledCitizens[citizenId]);
                    const isActionBusy = actionLoadingId === citizenId;
                    const isOnline = Boolean(citizen.isActive || citizen.isOnline);

                    return (
                      <tr key={citizenId || citizen.email} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-6 py-4">
                          <span 
                            style={{ fontFamily: "'Roboto', sans-serif" }} 
                            className="inline-block rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-sm font-bold tracking-wide text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80"
                          >
                            {citizenId || 'N/A'}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{citizen.fullName || 'Unnamed Record'}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{citizen.email || 'No Email Provided'}</div>
                        </td>

                        {/* Presence Badge */}
                        <td className="px-6 py-4">
                          <PresenceBadge isActive={isOnline} />
                        </td>

                        <td className="px-6 py-4">
                          <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {citizen.zone || 'Unassigned'}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          {isAccountEnabled ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-400 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                              <ShieldCheck className="h-3 w-3" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                              <ShieldAlert className="h-3 w-3" />
                              {citizen.status || 'Disabled'}
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            <button
                              onClick={() => openModal('view', citizen)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" /> View
                            </button>

                            {/* Edit Button (Disabled if Online) */}
                            <button
                              onClick={() => openModal('edit', citizen)}
                              disabled={isOnline}
                              title={isOnline ? 'Cannot edit citizen while online' : 'Edit citizen'}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-slate-800 cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" /> Edit
                            </button>

                            {/* Enable/Disable Toggle */}
                            <button
                              onClick={() => triggerStatusConfirm(citizen)}
                              disabled={isActionBusy}
                              className={`inline-flex items-center gap-1 w-[82px] justify-center rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                                isAccountEnabled
                                  ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-900/60'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/60'
                              }`}
                            >
                              {isActionBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : isAccountEnabled ? (
                                <>
                                  <UserX className="h-3.5 w-3.5" /> Disable
                                </>
                              ) : (
                                <>
                                  <UserCheck className="h-3.5 w-3.5" /> Enable
                                </>
                              )}
                            </button>

                            {/* Archive Button (Disabled if Online) */}
                            <button
                              onClick={() => openModal('archive', citizen)}
                              disabled={isOnline}
                              title={isOnline ? 'Cannot archive citizen while online' : 'Archive citizen'}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-900/60 px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-sm hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-50 dark:disabled:hover:bg-red-950/40 cursor-pointer"
                            >
                              <FolderArchive className="h-3.5 w-3.5" /> Archive
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls for Active Tab */}
        {activeTab === 'active' && !loading && filteredCitizens.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 px-6 py-4 gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.min(currentPage * itemsPerPage, filteredCitizens.length)}</span> of{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredCitizens.length}</span> records
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-xs text-slate-600 dark:text-slate-400 px-2">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                aria-label="Next page"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action Modals */}
      <Create_Citizen 
        isOpen={modals.create} 
        onClose={() => closeModal('create')} 
        onRefresh={handleCitizenCreated} 
      />

      <View_Citizens 
        isOpen={modals.view} 
        citizen={selectedCitizen} 
        onClose={() => closeModal('view')} 
      />

      <Edit_Citizen 
        isOpen={modals.edit} 
        citizen={selectedCitizen} 
        onClose={() => closeModal('edit')} 
        onRefresh={(updatedData) => {
          if (selectedCitizen) {
            logEditCitizen(selectedCitizen, updatedData || {});
          }
          loadCitizens(true, true);
        }} 
      />

      <Archive_Citizen 
        isOpen={modals.archive} 
        citizen={selectedCitizen} 
        onClose={() => closeModal('archive')} 
        onRefresh={(reason) => {
          if (selectedCitizen) {
            logArchiveCitizen(selectedCitizen, typeof reason === 'string' ? reason : 'Admin archived record');
          }
          loadCitizens(true, true);
        }} 
      />

      {/* Confirmation Dialog */}
      <StatusToggleAlertDialog 
        isOpen={toggleDialog.isOpen}
        citizen={toggleDialog.citizen}
        isCurrentlyActive={toggleDialog.citizen ? checkIsAccountEnabled(toggleDialog.citizen, disabledCitizens[getCitizenId(toggleDialog.citizen)]) : false}
        loading={actionLoadingId === getCitizenId(toggleDialog.citizen)}
        onConfirm={confirmToggleStatus}
        onClose={() => setToggleDialog({ isOpen: false, citizen: null })}
      />

    </div>
  );
};

export default CitizenManagement;
