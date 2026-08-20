import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  RotateCcw, 
  Trash2, 
  ChevronLeft, 
  ChevronRight, 
  ShieldAlert, 
  Archive,
  Loader2,
  CheckSquare,
  Square,
  Check,
  Search,
  MapPin,
  Clock,
  WifiOff,
  Eye,
  X,
  RefreshCw,
  Server
} from 'lucide-react';


// Import Shadcn UI AlertDialog components
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const RAW_SERVER_URL = import.meta.env.VITE_API_URL || 'https://resqwave-backend.onrender.com';
const CLEAN_SERVER_URL = RAW_SERVER_URL.replace(/\/+$/, '');
const API_BASE_URL = CLEAN_SERVER_URL.endsWith('/api')
  ? CLEAN_SERVER_URL
  : `${CLEAN_SERVER_URL}/api`;

const ARCHIVE_CACHE_KEY = 'resqwave_archived_reports_cache';
const ARCHIVE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2500;

const formatStreetAndBarangay = (fullAddress) => {
  if (!fullAddress || fullAddress === 'No location specified' || fullAddress === 'Location unavailable') {
    return 'Location unavailable';
  }
  const parts = fullAddress.split(',').map((p) => p.trim());
  let street = parts[0] || '';
  let barangay = parts.find((p) => /brgy|barangay/i.test(p)) || parts[1] || '';

  if (street && barangay && street !== barangay) {
    return `${street}, ${barangay}`;
  }
  return parts.slice(0, 2).join(', ') || fullAddress;
};

const formatDateTime = (timestamp) => {
  if (!timestamp) return { date: 'N/A', time: 'N/A' };
  
  let dateObj = null;

  if (typeof timestamp?.toDate === 'function') {
    dateObj = timestamp.toDate();
  } else if (typeof timestamp === 'object' && (timestamp.seconds !== undefined || timestamp._seconds !== undefined)) {
    const seconds = timestamp.seconds ?? timestamp._seconds;
    dateObj = new Date(seconds * 1000);
  } else {
    dateObj = new Date(timestamp);
  }

  if (!dateObj || isNaN(dateObj.getTime())) return { date: 'N/A', time: 'N/A' };

  return {
    date: dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
};

const getAuthHeaders = async () => {
  let token = null;
  const auth = getAuth();

  if (auth.currentUser) {
    token = await auth.currentUser.getIdToken(/* forceRefresh */ true);
    localStorage.setItem('token', token);
  } else {
    token = localStorage.getItem('token') || localStorage.getItem('adminToken');
  }

  if (!token) {
    console.warn('⚠️ No active session or token found in localStorage.');
    return { 'Content-Type': 'application/json' };
  }

  const cleanToken = token.replace(/^"(.*)"$/, '$1').trim();

  return {
    'Content-Type': 'application/json',
    'Authorization': cleanToken.startsWith('Bearer ') ? cleanToken : `Bearer ${cleanToken}`
  };
};

export default function Archived_Routes({ cachedData = null, onDataFetched }) {
  const [archivedReports, setArchivedReports] = useState(cachedData || []);
  const [loading, setLoading] = useState(!cachedData || cachedData.length === 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const archiveCacheRef = useRef(cachedData || null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [selectedReportId, setSelectedReportId] = useState(null);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isBatchRestoreOpen, setIsBatchRestoreOpen] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [viewingReport, setViewingReport] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const getCachedStorageReports = useCallback(() => {
    try {
      const cached = sessionStorage.getItem(ARCHIVE_CACHE_KEY) || localStorage.getItem(ARCHIVE_CACHE_KEY);
      if (!cached) return null;
      
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < ARCHIVE_CACHE_TTL) {
        return data;
      }
    } catch (e) {
      console.warn('Failed to parse archive cache from storage:', e);
    }
    return null;
  }, []);

  const setCachedStorageReports = useCallback((data) => {
    try {
      const payload = JSON.stringify({ data, timestamp: Date.now() });
      sessionStorage.setItem(ARCHIVE_CACHE_KEY, payload);
      localStorage.setItem(ARCHIVE_CACHE_KEY, payload);
      
      if (onDataFetched) {
        onDataFetched(data);
      }
    } catch (e) {
      console.warn('Failed to save archive cache to storage:', e);
    }
  }, [onDataFetched]);

  const fetchArchivedReports = useCallback(async (limitNum = 50, forceFresh = false) => {
    if (!forceFresh && archiveCacheRef.current && archiveCacheRef.current.length > 0) {
      setArchivedReports(archiveCacheRef.current);
      setLoading(false);
      return;
    }

    if (!forceFresh) {
      const localCache = cachedData || getCachedStorageReports();
      if (localCache && localCache.length > 0) {
        archiveCacheRef.current = localCache;
        setArchivedReports(localCache);
        setLoading(false);
        return;
      }
    }

    if (forceFresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);
    let attempt = 0;
    let success = false;

    while (attempt < MAX_RETRIES && !success) {
      try {
        attempt++;
        setRetryAttempt(attempt);

        const headers = await getAuthHeaders();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const response = await fetch(`${API_BASE_URL}/archived-reports?queryLimit=${limitNum}`, {
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}`);
        }

        const json = await response.json();

        if (json && json.success) {
          const freshData = json.data || [];
          archiveCacheRef.current = freshData;
          setArchivedReports(freshData);
          setCachedStorageReports(freshData);
          setSelectedIds(new Set());
          success = true;
        } else {
          throw new Error(json.message || 'Failed to fetch archived reports');
        }
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          const fallbackData = cachedData || getCachedStorageReports();
          if (fallbackData) {
            archiveCacheRef.current = fallbackData;
            setArchivedReports(fallbackData);
            setError('Connected using cached records. Render backend is waking up.');
          } else {
            setError('Render server is waking up or unavailable. Please retry shortly.');
          }
        }
      }
    }

    setLoading(false);
    setIsRefreshing(false);
    setRetryAttempt(0);
  }, [getCachedStorageReports, setCachedStorageReports, cachedData]);

  useEffect(() => {
    fetchArchivedReports(50);
  }, [fetchArchivedReports]);

  const handleManualRefresh = () => {
    archiveCacheRef.current = null;
    fetchArchivedReports(50, true);
  };

  const filteredReports = useMemo(() => {
    const term = searchTerm?.trim().toLowerCase() || '';
    if (!term) return archivedReports;

    return archivedReports.filter((report) => {
      const title = (report.reportTitle || report.incidentType || report.hazard || '').toLowerCase();
      const address = (report.location?.address || report.address || report.correctedAddress || '').toLowerCase();
      const id = (report.reportID || report.reportId || report.id || '').toString().toLowerCase();

      return title.includes(term) || address.includes(term) || id.includes(term);
    });
  }, [archivedReports, searchTerm]);

  const totalPages = Math.ceil(filteredReports.length / itemsPerPage) || 1;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredReports.slice(start, start + itemsPerPage);
  }, [filteredReports, currentPage, itemsPerPage]);

  const toggleSelectRow = useCallback((reportId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) {
        next.delete(reportId);
      } else {
        next.add(reportId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentPageIds = paginatedReports
      .map((r) => r.id || r.reportId || r.reportID)
      .filter(Boolean);

    const allSelectedOnPage = currentPageIds.every((id) => selectedIds.has(id));

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        currentPageIds.forEach((id) => next.delete(id));
      } else {
        currentPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [paginatedReports, selectedIds]);

  const handleRowDoubleClick = (report) => {
    const id = report.id || report.reportId || report.reportID;
    if (id) toggleSelectRow(id);
  };

  const triggerView = (report) => setViewingReport(report);
  const triggerRestore = (reportId) => {
    setSelectedReportId(reportId);
    setIsRestoreDialogOpen(true);
  };
  const triggerDelete = (reportId) => {
    setSelectedReportId(reportId);
    setIsDeleteDialogOpen(true);
  };

  const removeReportsFromStateAndCache = (idsToRemove) => {
    const removeSet = new Set(Array.isArray(idsToRemove) ? idsToRemove : [idsToRemove]);
    const updated = archivedReports.filter((r) => {
      const id = r.id || r.reportId || r.reportID;
      return !removeSet.has(id);
    });

    archiveCacheRef.current = updated;
    setArchivedReports(updated);
    setCachedStorageReports(updated);
  };

  const handleRestore = async () => {
    if (!selectedReportId) return;

    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();

      const response = await fetch(`${API_BASE_URL}/archived-reports/${selectedReportId}/restore`, {
        method: 'POST',
        headers
      });

      const result = await response.json();

      if (response.status === 401) {
        alert("Session expired or unauthorized. Please log in again.");
        return;
      }

      if (response.ok && result.success) {
        removeReportsFromStateAndCache(selectedReportId);
      } else {
        alert(result.message || "Failed to restore archived report.");
      }
    } catch (err) {
      alert("Failed to restore archived report. Please try again.");
    } finally {
      setIsSubmitting(false);
      setIsRestoreDialogOpen(false);
      setSelectedReportId(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedReportId) return;

    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();

      const response = await fetch(`${API_BASE_URL}/archived-reports/${selectedReportId}`, {
        method: 'DELETE',
        headers
      });
      const result = await response.json();

      if (response.status === 401) {
        alert("Session expired or unauthorized. Please log in again.");
        return;
      }

      if (response.ok && result.success) {
        removeReportsFromStateAndCache(selectedReportId);
      } else {
        alert(result.message || "Failed to delete archived report.");
      }
    } catch (err) {
      alert("Failed to delete archived report. Please try again.");
    } finally {
      setIsSubmitting(false);
      setIsDeleteDialogOpen(false);
      setSelectedReportId(null);
    }
  };

  const handleConfirmBatchRestore = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();
      const idsArray = Array.from(selectedIds);

      const responses = await Promise.all(
        idsArray.map((id) =>
          fetch(`${API_BASE_URL}/archived-reports/${id}/restore`, { method: 'POST', headers })
        )
      );

      if (responses.some(res => res.status === 401)) {
        alert("Session expired or unauthorized. Please log in again.");
        return;
      }

      removeReportsFromStateAndCache(idsArray);
      setIsBatchRestoreOpen(false);
      setSelectedIds(new Set());
    } catch (err) {
      alert('Failed to restore some selected records.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();
      const idsArray = Array.from(selectedIds);

      const responses = await Promise.all(
        idsArray.map((id) =>
          fetch(`${API_BASE_URL}/archived-reports/${id}`, { method: 'DELETE', headers })
        )
      );

      if (responses.some(res => res.status === 401)) {
        alert("Session expired or unauthorized. Please log in again.");
        return;
      }

      removeReportsFromStateAndCache(idsArray);
      setIsBatchDeleteOpen(false);
      setSelectedIds(new Set());
    } catch (err) {
      alert('Failed to delete some selected records.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const areAllCurrentPageSelected = useMemo(() => {
    if (paginatedReports.length === 0) return false;
    return paginatedReports.every((r) => selectedIds.has(r.id || r.reportId || r.reportID));
  }, [paginatedReports, selectedIds]);

  if (loading) {
    return (
      <div className="w-full p-6 space-y-4">
        {retryAttempt > 1 && (
          <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-md border border-amber-200 dark:border-amber-900/50">
            <Server className="h-4 w-4 animate-bounce shrink-0" />
            <span>Waking up free-tier backend server... (Attempt {retryAttempt} of {MAX_RETRIES})</span>
          </div>
        )}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between p-4 space-x-4 animate-pulse">
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-24" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
                <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-1/6" />
              </div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/5" />
              <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded-full w-20" />
              <div className="flex items-center space-x-2">
                <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-md w-16" />
                <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-md w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !archivedReports.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <ShieldAlert className="h-8 w-8 text-red-500" />
        <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400 max-w-md">{error}</p>
        <button
          onClick={handleManualRefresh}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry Fetching Archives
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      {error && archivedReports.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="flex items-center gap-2">
            <WifiOff className="h-3.5 w-3.5 text-amber-600" />
            {error}
          </span>
          <button
            onClick={handleManualRefresh}
            className="underline hover:text-amber-900 dark:hover:text-amber-100"
          >
            Refresh Data
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-6 py-3 border-b border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            aria-label="Search archived reports"
            placeholder="Filter archived by ID, type, address..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white pl-9 pr-4 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 transition-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={handleSelectAll}
            disabled={paginatedReports.length === 0}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
              areAllCurrentPageSelected
                ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-300'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {areAllCurrentPageSelected ? (
              <CheckSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            ) : (
              <Square className="h-4 w-4 text-slate-400" />
            )}
            {areAllCurrentPageSelected ? 'Deselect All' : 'Select All'}
          </button>

          <AnimatePresence>
            {selectedIds.size > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, x: 15 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: 15 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => setIsBatchRestoreOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 focus:outline-none transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore ({selectedIds.size})
                </button>

                <button
                  type="button"
                  onClick={() => setIsBatchDeleteOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-rose-700 focus:outline-none transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Purge ({selectedIds.size})
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Table Data */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="w-12 px-4 py-4 text-center">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-6 py-4">Report ID</th>
              <th className="px-6 py-4">Incident Type</th>
              <th className="px-6 py-4">Location</th>
              <th className="px-6 py-4">Archived At</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {paginatedReports.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  <Archive className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" />
                  No rejected reports found in the archive partition.
                </td>
              </tr>
            ) : (
              paginatedReports.map((report) => {
                const reportId = report.id || report.reportId || report.reportID;
                const isSelected = selectedIds.has(reportId);
                const rawAddress = report.location?.address || report.address || report.correctedAddress;
                const formattedLocation = formatStreetAndBarangay(rawAddress);
                const rawTimestamp = report.archivedAt || report.rejectedAt || report.updatedAt || report.createdAt || report.timestamp;
                const { date, time } = formatDateTime(rawTimestamp);

                return (
                  <motion.tr
                    key={reportId}
                    onDoubleClick={() => handleRowDoubleClick(report)}
                    animate={{
                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'rgba(0,0,0,0)',
                    }}
                    transition={{ duration: 0.2 }}
                    className={`group cursor-pointer transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50 ${
                      isSelected ? 'border-l-4 border-l-blue-500' : ''
                    }`}
                  >
                    <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => toggleSelectRow(reportId)}
                        className={`inline-flex items-center justify-center h-5 w-5 rounded border transition-all ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white dark:bg-blue-500 dark:border-blue-500'
                            : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 hover:border-slate-400'
                        }`}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                      </button>
                    </td>

                    <td className="px-6 py-4">
                      <span className="inline-block rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-bold tracking-wide text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80">
                        {report.reportID || report.reportId || report.id || 'N/A'}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100 capitalize">
                        {report.reportTitle || report.incidentType || report.hazard || 'Rejected Incident'}
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 max-w-xs truncate">
                        <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{formattedLocation}</span>
                      </span>
                    </td>

                    <td className="px-6 py-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{date}</span>
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3 text-slate-400" /> {time}
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          onClick={() => triggerView(report)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>

                        <button
                          onClick={() => triggerRestore(reportId)}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/60 px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </button>

                        <button
                          onClick={() => triggerDelete(reportId)}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-900/60 px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {!loading && filteredReports.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 px-6 py-4 gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.min(currentPage * itemsPerPage, filteredReports.length)}</span> of{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredReports.length}</span> archived records
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
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
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* View Modal */}
      <AnimatePresence>
        {viewingReport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    {viewingReport.reportID || viewingReport.reportId || viewingReport.id || 'N/A'}
                  </span>
                  <h3 className="font-bold text-slate-900 dark:text-white capitalize">
                    {viewingReport.reportTitle || viewingReport.incidentType || viewingReport.hazard || 'Archived Incident'}
                  </h3>
                </div>
                <button
                  onClick={() => setViewingReport(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4">
                <ViewArchived_Reports report={viewingReport} onClose={() => setViewingReport(null)} />
              </div>

              <div className="mt-6 flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => setViewingReport(null)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Dialogs */}
      <AlertDialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <RotateCcw className="h-5 w-5" /> Restore Incident Report?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action will move the report out of the rejected vault back into active pending verification pipelines.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestore}
              disabled={isSubmitting}
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restoring...
                </>
              ) : (
                'Restore Report'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBatchRestoreOpen} onOpenChange={setIsBatchRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <RotateCcw className="h-5 w-5" /> Restore {selectedIds.size} Reports
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore <strong>{selectedIds.size} selected reports</strong> back to active records?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBatchRestore}
              disabled={isSubmitting}
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restoring Selected...
                </>
              ) : (
                `Confirm Restore (${selectedIds.size})`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Trash2 className="h-5 w-5" /> Permanently Delete Record?
            </AlertDialogTitle>
            <AlertDialogDescription>
              CRITICAL: This action <strong>cannot be undone</strong>. The incident record will be permanently erased from database archives.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isSubmitting}
              className="bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Purging...
                </>
              ) : (
                'Delete Permanently'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBatchDeleteOpen} onOpenChange={setIsBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Trash2 className="h-5 w-5" /> Permanently Delete {selectedIds.size} Records
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action <strong>cannot be undone</strong>. You are about to permanently purge <strong>{selectedIds.size} selected reports</strong> from storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBatchDelete}
              disabled={isSubmitting}
              className="bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Purging Selected...
                </>
              ) : (
                `Purge Selected (${selectedIds.size})`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}