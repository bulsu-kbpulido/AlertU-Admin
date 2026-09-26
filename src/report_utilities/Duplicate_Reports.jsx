import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  ShieldAlert, 
  Copy,
  Loader2,
  CheckSquare,
  Square,
  Check,
  Search,
  MapPin,
  Clock,
  ExternalLink,
  Calendar,
  RefreshCw
} from 'lucide-react';

// Import View Modal Component
import ViewDuplicate_Reports from './ViewDuplicate_Reports';
import { Button } from "@/components/ui/button";

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

// 🌐 Dynamic Environment Configuration for Railway Backend
const RAW_SERVER_URL = import.meta.env.VITE_API_URL || 'https://alertu-server-production.up.railway.app';
const CLEAN_SERVER_URL = RAW_SERVER_URL.replace(/\/+$/, '');
const API_BASE_URL = CLEAN_SERVER_URL.endsWith('/api')
  ? CLEAN_SERVER_URL
  : `${CLEAN_SERVER_URL}/api`;

// How long the success/error pop-ups stay on screen (ms)
const TOAST_DURATION = 10000;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2500;

/**
 * Incident type badge colors (same as the Send Reports tables)
 */
const getIncidentBadgeStyle = (incidentType) => {
  const normalized = (incidentType || '').trim().toLowerCase();
  if (normalized.includes('fire')) {
    return 'bg-red-600 text-white border-red-700';
  } else if (normalized.includes('flood')) {
    return 'bg-blue-600 text-white border-blue-700';
  } else if (normalized.includes('accident')) {
    return 'bg-violet-600 text-white border-violet-700';
  } else if (normalized.includes('quake') || normalized.includes('earthquake')) {
    return 'bg-amber-800 text-white border-amber-900';
  }
  return 'bg-orange-600 text-white border-orange-700';
};

/**
 * Format street and barangay helper for duplicate addresses
 */
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

/**
 * Fixed Date/time formatter supporting Firestore Timestamps, objects, & standard ISO strings
 */
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

/**
 * Reusable helper to generate standard Authorization headers
 */
const getAuthHeaders = async () => {
  let token = null;
  const auth = getAuth();

  if (auth.currentUser) {
    token = await auth.currentUser.getIdToken(true);
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

export default function Duplicate_Reports({ onCountChange } = {}) {
  const [duplicateReports, setDuplicateReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Cache Ref to eliminate redundant network requests and handle cold starts
  const duplicateCacheRef = useRef(null);

  // Selected row IDs state tracking
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Dialog state tracking
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [isBatchRestoreOpen, setIsBatchRestoreOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // View Modal state tracking
  const [viewingReport, setViewingReport] = useState(null);

  // Search filter term state
  const [searchTerm, setSearchTerm] = useState('');

  /**
   * Fetch duplicate reports with Caching and Railway Auto-Retry / Warmup Support
   */
  const fetchDuplicateReports = useCallback(async (forceRefresh = false) => {
    // 1. Serve from cache directly if valid and not forced to refresh
    if (!forceRefresh && duplicateCacheRef.current) {
      setDuplicateReports(duplicateCacheRef.current);
      setLoading(false);
      return;
    }

    if (forceRefresh) {
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
        const headers = await getAuthHeaders();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout for cold starts

        const response = await fetch(`${API_BASE_URL}/duplicate-reports`, {
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}`);
        }

        const json = await response.json();

        if (json && json.success) {
          const fetchedData = json.data || [];
          duplicateCacheRef.current = fetchedData;
          setDuplicateReports(fetchedData);
          setSelectedIds(new Set());
          success = true;
        } else {
          throw new Error(json.message || 'Failed to fetch duplicate reports');
        }
      } catch (err) {
        console.warn(`Attempt ${attempt} to fetch duplicates failed:`, err.message);

        if (attempt < MAX_RETRIES) {
          // Wait before retrying while Railway boots up
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          setError('Railway server is waking up or unavailable. Please retry shortly.');
        }
      }
    }

    setLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    fetchDuplicateReports();
  }, [fetchDuplicateReports]);

  const handleManualRefresh = () => {
    duplicateCacheRef.current = null;
    fetchDuplicateReports(true);
  };

  // Filter duplicate reports based on search term
  const filteredReports = useMemo(() => {
    const term = searchTerm?.trim().toLowerCase() || '';
    if (!term) return duplicateReports;

    return duplicateReports.filter((report) => {
      const title = (report.reportTitle || report.incidentType || report.hazard || '').toLowerCase();
      const address = (report.location?.address || report.address || report.correctedAddress || '').toLowerCase();
      const id = (report.reportID || report.reportId || report.id || '').toString().toLowerCase();

      return title.includes(term) || address.includes(term) || id.includes(term);
    });
  }, [duplicateReports, searchTerm]);

  // Keep the parent (tab badge) in sync with the real duplicate count
  useEffect(() => {
    onCountChange?.(duplicateReports.length);
  }, [duplicateReports, onCountChange]);

  // Pagination Logic
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

  // --- Row Selection Handlers ---
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

  // --- Trigger Handlers ---
  const triggerView = (report) => {
    setViewingReport(report);
  };

  const triggerRestore = (reportId) => {
    setSelectedReportId(reportId);
    setIsRestoreDialogOpen(true);
  };

  // Helper to remove records from local cache optimistic state
  const removeReportsFromStateAndCache = (idsToRemove) => {
    const removeSet = new Set(Array.isArray(idsToRemove) ? idsToRemove : [idsToRemove]);
    const updated = duplicateReports.filter((r) => {
      const id = r.id || r.reportId || r.reportID;
      return !removeSet.has(id);
    });

    duplicateCacheRef.current = updated;
    setDuplicateReports(updated);
  };

  // --- API Execution Handlers ---
  const handleRestore = async () => {
    if (!selectedReportId) return;

    const target = duplicateReports.find((r) => (r.id || r.reportId || r.reportID) === selectedReportId);
    const displayId = target?.reportID || target?.reportId || target?.id || selectedReportId;

    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();

      const response = await fetch(`${API_BASE_URL}/duplicate-reports/${selectedReportId}/restore`, {
        method: 'POST',
        headers: headers
      });

      const result = await response.json();

      if (response.status === 401) {
        toast.error('Session expired', {
          description: 'Please log in again to continue.',
          duration: TOAST_DURATION,
        });
        return;
      }

      if (response.ok && result.success) {
        removeReportsFromStateAndCache(selectedReportId);
        toast.success('Report restored', {
          description: `#${displayId} was removed from duplicates and moved back to Active Reports.`,
          duration: TOAST_DURATION,
        });
      } else {
        toast.error('Unable to restore report', {
          description: result.message || `#${displayId} could not be restored. Please try again.`,
          duration: TOAST_DURATION,
        });
      }
    } catch (err) {
      console.error("Restore error:", err);
      toast.error('Unable to restore report', {
        description: 'Something went wrong while restoring the report. Please try again.',
        duration: TOAST_DURATION,
      });
    } finally {
      setIsSubmitting(false);
      setIsRestoreDialogOpen(false);
      setSelectedReportId(null);
    }
  };

  // --- Batch Action Handlers ---
  const handleConfirmBatchRestore = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();

      const idsArray = Array.from(selectedIds);
      const restorePromises = idsArray.map((id) =>
        fetch(`${API_BASE_URL}/duplicate-reports/${id}/restore`, { 
          method: 'POST',
          headers: headers
        })
      );

      const responses = await Promise.all(restorePromises);
      const hasUnauthorized = responses.some(res => res.status === 401);

      if (hasUnauthorized) {
        toast.error('Session expired', {
          description: 'Please log in again to continue.',
          duration: TOAST_DURATION,
        });
        return;
      }

      const successfulIds = idsArray.filter((_, idx) => responses[idx]?.ok);

      setIsBatchRestoreOpen(false);

      if (successfulIds.length > 0) {
        removeReportsFromStateAndCache(successfulIds);
        setSelectedIds(new Set());
      }

      if (successfulIds.length === idsArray.length) {
        toast.success(`${successfulIds.length} report${successfulIds.length > 1 ? 's' : ''} restored`, {
          description: 'The selected reports were moved back to Active Reports.',
          duration: TOAST_DURATION,
        });
      } else if (successfulIds.length > 0) {
        toast.warning('Some reports could not be restored', {
          description: `${successfulIds.length} of ${idsArray.length} selected reports were restored. Please try the rest again.`,
          duration: TOAST_DURATION,
        });
      } else {
        toast.error('Unable to restore reports', {
          description: 'None of the selected reports could be restored. Please try again.',
          duration: TOAST_DURATION,
        });
      }
    } catch (err) {
      console.error('Error restoring selected reports:', err);
      toast.error('Unable to restore reports', {
        description: 'Something went wrong while restoring the selected reports. Please try again.',
        duration: TOAST_DURATION,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const areAllCurrentPageSelected = useMemo(() => {
    if (paginatedReports.length === 0) return false;
    return paginatedReports.every((r) => selectedIds.has(r.id || r.reportId || r.reportID));
  }, [paginatedReports, selectedIds]);

  // Loading Skeleton State
  if (loading) {
    return (
      <div className="w-full p-6 divide-y divide-slate-100 dark:divide-slate-800">
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
    );
  }

  // Error State
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ShieldAlert className="h-8 w-8 text-red-500" />
        <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={handleManualRefresh}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry Fetching Duplicates
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Filter and Selection Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-6 py-3 border-b border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/70">
        
        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            aria-label="Search duplicate reports"
            placeholder="Filter duplicates by ID, type, address..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white pl-9 pr-4 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Bulk Action & Refresh Controls */}
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

          {/* Animated Batch Restore Action */}
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Table Data */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs whitespace-nowrap lg:whitespace-normal">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider sticky top-0 z-10">
              <th className="w-12 px-4 py-3.5 text-center">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-5 py-3.5 w-36">Report ID</th>
              <th className="px-5 py-3.5 w-36">Type</th>
              <th className="px-5 py-3.5 min-w-[220px]">Location</th>
              <th className="px-5 py-3.5 w-36">Flagged At</th>
              <th className="px-5 py-3.5 text-right min-w-[160px]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {paginatedReports.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  <Copy className="mx-auto h-8 w-8 text-amber-500/60 dark:text-amber-500/40 mb-2" />
                  No duplicate reports found in the review queue.
                </td>
              </tr>
            ) : (
              paginatedReports.map((report) => {
                const reportId = report.id || report.reportId || report.reportID;
                const isSelected = selectedIds.has(reportId);
                const rawAddress = report.location?.address || report.address || report.correctedAddress;
                const formattedLocation = formatStreetAndBarangay(rawAddress);
                const rawTimestamp = report.flaggedAt || report.createdAt || report.updatedAt || report.timestamp || report.date;
                const { date, time } = formatDateTime(rawTimestamp);
                const incidentType = report.incidentType || report.hazard || report.reportTitle || 'General';

                return (
                  <motion.tr
                    key={reportId}
                    onDoubleClick={() => handleRowDoubleClick(report)}
                    animate={{
                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'rgba(0,0,0,0)',
                    }}
                    transition={{ duration: 0.2 }}
                    className={`group cursor-pointer transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                      isSelected ? 'border-l-4 border-l-blue-500' : ''
                    }`}
                  >
                    {/* Checkbox Column */}
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

                    <td className="px-5 py-4 font-['Roboto',sans-serif] font-medium text-slate-700 dark:text-slate-300">
                      {report.reportID || report.reportId || report.id || 'N/A'}
                    </td>

                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-xs transition-colors ${getIncidentBadgeStyle(incidentType)}`}>
                        <span>{incidentType}</span>
                      </span>
                    </td>

                    <td className="px-5 py-4 text-slate-600 dark:text-slate-300 max-w-xs xl:max-w-md truncate">
                      {formattedLocation}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex flex-col text-[11px]">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-blue-500 shrink-0" />
                          {date}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3 shrink-0" />
                          {time}
                        </span>
                      </div>
                    </td>

                    <td className="px-5 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-end gap-2 flex-wrap xl:flex-nowrap">
                        {/* VIEW BUTTON */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => triggerView(report)}
                          className="text-xs font-medium inline-flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>View</span>
                        </Button>

                        {/* RESTORE BUTTON */}
                        <Button
                          size="sm"
                          onClick={() => triggerRestore(reportId)}
                          className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1 shadow-sm"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Restore</span>
                        </Button>
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
            <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredReports.length}</span> duplicate records
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

      {/* VIEW DETAILS MODAL */}
      {viewingReport && (
        <ViewDuplicate_Reports
          report={viewingReport}
          onClose={() => setViewingReport(null)}
        />
      )}

      {/* SINGLE RESTORE ALERT DIALOG */}
      <AlertDialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <RotateCcw className="h-5 w-5" /> Restore Duplicate Report?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action will clear the duplicate status and move the report back into active verification queues.
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

      {/* BATCH RESTORE ALERT DIALOG */}
      <AlertDialog open={isBatchRestoreOpen} onOpenChange={setIsBatchRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <RotateCcw className="h-5 w-5" /> Restore {selectedIds.size} Duplicate Reports
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

    </div>
  );
}