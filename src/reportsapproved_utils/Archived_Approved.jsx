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
  Calendar,
  Tag,
  Hash
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

// Updated API URL pointing to the live Render deployment
const API_BASE_URL = 'https://alertu-server.onrender.com/api';

/**
 * Format street and barangay helper for archived addresses
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
 * Date/time formatter for timestamps
 */
const formatDateTime = (timestamp) => {
  if (!timestamp) return { date: 'N/A', time: 'N/A' };
  const dateObj = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  if (isNaN(dateObj.getTime())) return { date: 'N/A', time: 'N/A' };

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

export default function Archived_Approved({ onRestoreSuccess }) {
  const [archivedReports, setArchivedReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Selected row IDs state tracking
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Dialog state tracking
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isBatchRestoreOpen, setIsBatchRestoreOpen] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search filter term state
  const [searchTerm, setSearchTerm] = useState('');

  // Client-side cache ref (stores data and timestamp)
  const cacheRef = useRef({ data: null, timestamp: 0 });
  const CACHE_TTL_MS = 60000; // 1-minute TTL

  // Fetch archived approved reports from backend with client-side caching
  const fetchArchivedReports = useCallback(async (forceRefresh = false) => {
    const now = Date.now();

    // Serve from cache if available and fresh
    if (!forceRefresh && cacheRef.current.data && (now - cacheRef.current.timestamp < CACHE_TTL_MS)) {
      setArchivedReports(cacheRef.current.data);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/archived-approved`, {
        headers
      });
      const json = await response.json();
      
      if (json && json.success) {
        const fetchedData = json.data || [];

        // Update cache
        cacheRef.current = {
          data: fetchedData,
          timestamp: now
        };

        setArchivedReports(fetchedData);
        setSelectedIds(new Set());
      } else {
        throw new Error(json.message || 'Failed to fetch archived approved reports');
      }
    } catch (err) {
      console.error('Error fetching archived approved reports:', err);
      setError(err.message || 'Failed to load records from storage.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArchivedReports();
  }, [fetchArchivedReports]);

  // Helper to update local state and invalidate/sync cache
  const updateLocalReportsAndCache = (reportIdsToRemove) => {
    const idsSet = new Set(reportIdsToRemove);
    const updated = archivedReports.filter(r => !idsSet.has(r.id || r.reportId || r.verifiedReportId));
    
    setArchivedReports(updated);
    cacheRef.current = {
      data: updated,
      timestamp: Date.now()
    };
  };

  // Filter archived reports based on search term
  const filteredReports = useMemo(() => {
    const term = searchTerm?.trim().toLowerCase() || '';
    if (!term) return archivedReports;

    return archivedReports.filter((report) => {
      const title = (report.reportTitle || report.incidentType || report.hazard || '').toLowerCase();
      const address = (report.location?.address || report.address || '').toLowerCase();
      const id = (report.verifiedReportId || report.verifiedreportID || report.id || report.reportDocId || '').toString().toLowerCase();

      return title.includes(term) || address.includes(term) || id.includes(term);
    });
  }, [archivedReports, searchTerm]);

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
      .map((r) => r.id || r.reportId || r.verifiedReportId)
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
    const id = report.id || report.reportId || report.verifiedReportId;
    if (id) toggleSelectRow(id);
  };

  // --- Trigger Dialog Handlers ---
  const triggerRestore = (reportId) => {
    setSelectedReportId(reportId);
    setIsRestoreDialogOpen(true);
  };

  const triggerDelete = (reportId) => {
    setSelectedReportId(reportId);
    setIsDeleteDialogOpen(true);
  };

  // --- API Execution Handlers ---
  const handleRestore = async () => {
    if (!selectedReportId) return;
  
    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();

      const response = await fetch(`${API_BASE_URL}/archived-approved/${selectedReportId}/restore`, {
        method: 'POST',
        headers: headers
      });
      
      const result = await response.json();
  
      if (response.status === 401) {
        alert("Session expired or unauthorized. Please log in again.");
        return;
      }

      if (response.ok && result.success) {
        // Optimistically remove from view and update cache
        updateLocalReportsAndCache([selectedReportId]);
        if (typeof onRestoreSuccess === 'function') {
          onRestoreSuccess();
        }
      } else {
        alert(result.message || "Failed to restore report.");
      }
    } catch (err) {
      console.error("Restore error:", err);
      alert("Failed to restore report. Please try again.");
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

      const response = await fetch(`${API_BASE_URL}/archived-approved/${selectedReportId}`, {
        method: 'DELETE',
        headers: headers
      });
      const result = await response.json();

      if (response.status === 401) {
        alert("Session expired or unauthorized. Please log in again.");
        return;
      }

      if (response.ok && result.success) {
        // Optimistically remove from view and update cache
        updateLocalReportsAndCache([selectedReportId]);
      } else {
        console.error("Failed to delete report:", result.message);
        alert(result.message || "Failed to delete report.");
      }
    } catch (err) {
      console.error("Delete error:", err);
      alert("Failed to delete report. Please try again.");
    } finally {
      setIsSubmitting(false);
      setIsDeleteDialogOpen(false);
      setSelectedReportId(null);
    }
  };

  // --- Batch Action Handlers ---
  const handleConfirmBatchRestore = async () => {
    if (selectedIds.size === 0) return;

    const idsArray = Array.from(selectedIds);

    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();

      const restorePromises = idsArray.map((id) =>
        fetch(`${API_BASE_URL}/archived-approved/${id}/restore`, { 
          method: 'POST',
          headers: headers
        })
      );

      const responses = await Promise.all(restorePromises);
      const hasUnauthorized = responses.some(res => res.status === 401);

      if (hasUnauthorized) {
        alert("Session expired or unauthorized. Please log in again.");
        return;
      }

      setIsBatchRestoreOpen(false);
      
      // Optimistically remove restored records from local state and cache
      updateLocalReportsAndCache(idsArray);
      setSelectedIds(new Set());

      if (typeof onRestoreSuccess === 'function') {
        onRestoreSuccess();
      }
    } catch (err) {
      console.error('Error restoring selected reports:', err);
      alert('Failed to restore some selected records.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;

    const idsArray = Array.from(selectedIds);

    try {
      setIsSubmitting(true);
      const headers = await getAuthHeaders();

      const deletePromises = idsArray.map((id) =>
        fetch(`${API_BASE_URL}/archived-approved/${id}`, { 
          method: 'DELETE',
          headers: headers
        })
      );

      const responses = await Promise.all(deletePromises);
      const hasUnauthorized = responses.some(res => res.status === 401);

      if (hasUnauthorized) {
        alert("Session expired or unauthorized. Please log in again.");
        return;
      }

      setIsBatchDeleteOpen(false);
      
      // Optimistically remove purged records from local state and cache
      updateLocalReportsAndCache(idsArray);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Error deleting selected reports:', err);
      alert('Failed to delete some selected records.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const areAllCurrentPageSelected = useMemo(() => {
    if (paginatedReports.length === 0) return false;
    return paginatedReports.every((r) => selectedIds.has(r.id || r.reportId || r.verifiedReportId));
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
          onClick={() => fetchArchivedReports(true)}
          className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Retry Fetching Archives
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
            aria-label="Search archived reports"
            placeholder="Filter archived by ID, type, address..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white pl-9 pr-4 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Bulk Action Controls */}
        <div className="flex items-center justify-between sm:justify-end gap-3">
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

          {/* Animated Batch Restore & Purge Actions */}
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
                  No approved reports found in the archive partition.
                </td>
              </tr>
            ) : (
              paginatedReports.map((report) => {
                const reportId = report.id || report.reportId || report.verifiedReportId;
                const displayId = report.verifiedReportId || report.verifiedreportID || report.id || 'N/A';
                const isSelected = selectedIds.has(reportId);
                const rawAddress = report.location?.address || report.address;
                const formattedLocation = formatStreetAndBarangay(rawAddress);
                const { date, time } = formatDateTime(report.timestamp || report.archivedAt || report.updatedAt);

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

                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-bold tracking-wide text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80">
                        <Hash className="h-3 w-3 text-slate-400" />
                        {displayId}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100 capitalize">
                        {report.reportTitle || report.incidentType || report.hazard || 'Approved Incident'}
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
                        <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-blue-500" />
                          {date}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3 text-slate-400" /> {time}
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-end gap-2">
                        {/* RESTORE BUTTON */}
                        <button
                          onClick={() => triggerRestore(reportId)}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/60 px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </button>

                        {/* DELETE BUTTON */}
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

      {/* SINGLE RESTORE ALERT DIALOG */}
      <AlertDialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <RotateCcw className="h-5 w-5" /> Restore Approved Incident Report?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action will move the report out of archives back into the active approved incidents list.
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
              <RotateCcw className="h-5 w-5" /> Restore {selectedIds.size} Reports
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore <strong>{selectedIds.size} selected reports</strong> back to active approved records?
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

      {/* SINGLE PERMANENT DELETE ALERT DIALOG */}
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

      {/* BATCH PERMANENT DELETE ALERT DIALOG */}
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