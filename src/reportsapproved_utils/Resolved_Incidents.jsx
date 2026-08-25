import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchFromBackend } from '../api';
import { 
  RotateCcw,
  ChevronLeft, 
  ChevronRight, 
  ShieldAlert, 
  CheckCircle,
  CheckSquare,
  Square,
  Check,
  Search,
  MapPin,
  Clock,
  Calendar,
  Tag,
  Hash,
  Loader2
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Format street and barangay helper for resolved addresses
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
 * Date/time formatter for timestamps (Handles Firestore Timestamps and ISO strings)
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

export default function Resolved_Incidents({ onRestoreSuccess }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Selected row IDs state tracking
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Search filter term state
  const [searchTerm, setSearchTerm] = useState('');

  // Dialog state tracking
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [isBatchRestoreOpen, setIsBatchRestoreOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Client-side cache ref (stores data and timestamp)
  const cacheRef = useRef({ data: null, timestamp: 0 });
  const CACHE_TTL_MS = 60000; // 1-minute TTL

  // Fetch resolved incident reports with client-side caching
  const fetchResolvedReports = useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    
    // Serve from cache if available and fresh
    if (!forceRefresh && cacheRef.current.data && (now - cacheRef.current.timestamp < CACHE_TTL_MS)) {
      setReports(cacheRef.current.data);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const json = await fetchFromBackend('/resolved-incidents');
      
      if (json && json.success) {
        const fetchedData = json.data || [];
        
        // Update cache
        cacheRef.current = {
          data: fetchedData,
          timestamp: now
        };

        setReports(fetchedData);
        setSelectedIds(new Set());
      } else {
        throw new Error(json?.message || 'Failed to fetch resolved incidents');
      }
    } catch (err) {
      console.error('Error fetching resolved incidents:', err);
      setError(err.message || 'Failed to load records from storage.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResolvedReports();
  }, [fetchResolvedReports]);

  // Filter resolved reports based on search term
  const filteredReports = useMemo(() => {
    const term = searchTerm?.trim().toLowerCase() || '';
    if (!term) return reports;

    return reports.filter((report) => {
      const title = (report.reportTitle || report.incidentType || report.hazard || '').toLowerCase();
      const address = (report.location?.address || report.address || '').toLowerCase();
      const id = (report.verifiedReportId || report.verifiedreportID || report.id || report.reportDocId || '').toString().toLowerCase();

      return title.includes(term) || address.includes(term) || id.includes(term);
    });
  }, [reports, searchTerm]);

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

  // --- Trigger Restore Dialogs ---
  const triggerRestore = (reportId) => {
    setSelectedReportId(reportId);
    setIsRestoreDialogOpen(true);
  };

  // Helper to update local state and invalidate/sync cache
  const updateLocalReportsAndCache = (reportIdsToRemove) => {
    const idsSet = new Set(reportIdsToRemove);
    const updated = reports.filter(r => !idsSet.has(r.id || r.reportId || r.verifiedReportId));
    
    setReports(updated);
    cacheRef.current = {
      data: updated,
      timestamp: Date.now()
    };
  };

  // --- Single Restore Handler ---
  const handleRestore = async () => {
    if (!selectedReportId) return;

    try {
      setIsSubmitting(true);
      const result = await fetchFromBackend(`/resolve/restore/${selectedReportId}`, {
        method: 'POST'
      });

      if (result && result.success) {
        // Optimistically remove from view and clear cache entry
        updateLocalReportsAndCache([selectedReportId]);
        if (typeof onRestoreSuccess === 'function') {
          onRestoreSuccess();
        }
      } else {
        alert(result?.message || "Failed to restore incident.");
      }
    } catch (err) {
      console.error("Restore error:", err);
      alert("Failed to restore incident. Please try again.");
    } finally {
      setIsSubmitting(false);
      setIsRestoreDialogOpen(false);
      setSelectedReportId(null);
    }
  };

  // --- Batch Restore Handler ---
  const handleConfirmBatchRestore = async () => {
    if (selectedIds.size === 0) return;

    const idsArray = Array.from(selectedIds);

    try {
      setIsSubmitting(true);
      const result = await fetchFromBackend('/resolve/batch-restore', {
        method: 'POST',
        body: JSON.stringify({ ids: idsArray })
      });

      if (result && result.success) {
        setIsBatchRestoreOpen(false);
        
        // Optimistically remove batch from view and clear cache
        updateLocalReportsAndCache(idsArray);
        setSelectedIds(new Set());

        if (typeof onRestoreSuccess === 'function') {
          onRestoreSuccess();
        }
      } else {
        alert(result?.message || 'Failed to restore selected records.');
      }
    } catch (err) {
      console.error('Error restoring selected incidents:', err);
      alert('Failed to restore selected records. Please check server connectivity.');
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
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-md w-20" />
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
          onClick={() => fetchResolvedReports(true)}
          className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Retry Fetching Incidents
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
            aria-label="Search resolved incidents"
            placeholder="Filter resolved by ID, type, address..."
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
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="w-12 px-4 py-4 text-center">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-6 py-4">Report ID</th>
              <th className="px-6 py-4">Incident Type</th>
              <th className="px-6 py-4">Location</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Resolved At</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {paginatedReports.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  <CheckCircle className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" />
                  No resolved incidents found in history.
                </td>
              </tr>
            ) : (
              paginatedReports.map((report) => {
                const reportId = report.id || report.reportId || report.verifiedReportId;
                const displayId = report.verifiedReportId || report.verifiedreportID || report.id || 'N/A';
                const isSelected = selectedIds.has(reportId);
                const rawAddress = report.location?.address || report.address;
                const formattedLocation = formatStreetAndBarangay(rawAddress);
                const { date, time } = formatDateTime(report.resolvedAt || report.timestamp || report.updatedAt);

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
                        {report.reportTitle || report.incidentType || report.hazard || 'Resolved Incident'}
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 max-w-xs truncate">
                        <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{formattedLocation}</span>
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-0.5 text-xs font-semibold">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                        Resolved
                      </span>
                    </td>

                    <td className="px-6 py-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-emerald-500" />
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
            <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredReports.length}</span> resolved records
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
              <RotateCcw className="h-5 w-5" /> Restore Resolved Incident?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action will move the incident out of the resolved history back into active status.
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
                'Restore Incident'
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
              <RotateCcw className="h-5 w-5" /> Restore {selectedIds.size} Incidents
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore <strong>{selectedIds.size} selected incidents</strong> back to active status?
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