import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchFromBackend } from '../api';
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
  RefreshCw
} from 'lucide-react';

// Import shadcn/ui AlertDialog components
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

// Cache Configuration matching CitizenManagement pattern
const CACHE_KEY = 'ALERTU_ARCHIVED_CITIZENS_CACHE';
const CACHE_TTL_MS = 60 * 1000; // 1 minute client-side TTL
let memoryArchivedCache = null;
let memoryCacheTimestamp = 0;

const getCitizenId = (c) => c?.citizenID || c?.cid || c?.id;

const ArchivedCitizensTable = ({ 
  searchTerm, 
  onRefresh 
}) => {
  const [archivedCitizens, setArchivedCitizens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Selected row IDs state tracking
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Dialog state tracking
  const [selectedCitizen, setSelectedCitizen] = useState(null);
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isBatchRestoreOpen, setIsBatchRestoreOpen] = useState(false);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mountRef = useRef(true);

  useEffect(() => {
    mountRef.current = true;
    return () => {
      mountRef.current = false;
    };
  }, []);

  // --- Resilience Helper: Fetch with Auto-Retry for Render Cold-Starts ---
  const fetchWithRetry = useCallback(async (endpoint, options = {}, retries = 3, backoff = 1000) => {
    try {
      return await fetchFromBackend(endpoint, options);
    } catch (err) {
      if (retries > 0) {
        if (mountRef.current) setRetrying(true);
        await new Promise((res) => setTimeout(res, backoff));
        return fetchWithRetry(endpoint, options, retries - 1, backoff * 1.5);
      }
      throw err;
    } finally {
      if (mountRef.current) setRetrying(false);
    }
  }, []);

  // Load archived citizens with dual-layer caching (Memory + sessionStorage)
  const loadArchivedCitizens = useCallback(async (forceRefresh = false) => {
    const now = Date.now();

    // 1. Check in-memory cache
    if (!forceRefresh && memoryArchivedCache && (now - memoryCacheTimestamp < CACHE_TTL_MS)) {
      setArchivedCitizens(memoryArchivedCache);
      setLoading(false);
      return;
    }

    // 2. Check sessionStorage fallback
    if (!forceRefresh) {
      try {
        const cachedStr = sessionStorage.getItem(CACHE_KEY);
        if (cachedStr) {
          const { data, timestamp } = JSON.parse(cachedStr);
          if (now - timestamp < CACHE_TTL_MS && Array.isArray(data)) {
            memoryArchivedCache = data;
            memoryCacheTimestamp = timestamp;
            setArchivedCitizens(data);
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to parse archived citizens cache:', e);
      }
    }

    try {
      setLoading(true);
      setError(null);

      // Query archived backend endpoint with automatic retry
      const response = await fetchWithRetry('/citizens/archived?queryLimit=50');
      const rawData = response?.data ? response.data : response;
      const cleanData = Array.isArray(rawData) ? rawData : [];

      // Update in-memory & session cache
      memoryArchivedCache = cleanData;
      memoryCacheTimestamp = Date.now();
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          data: cleanData,
          timestamp: memoryCacheTimestamp
        }));
      } catch (e) {
        console.warn('Could not save to sessionStorage:', e);
      }

      if (mountRef.current) {
        setArchivedCitizens(cleanData);
        setSelectedIds(new Set()); // Reset selections on fresh fetch
      }
    } catch (err) {
      console.error('Failed to fetch archived citizens:', err);
      
      // Fallback to existing memory cache if fetch failed completely
      if (memoryArchivedCache) {
        setArchivedCitizens(memoryArchivedCache);
        setError('Connected using cached vault records (Server response slow).');
      } else {
        setError('Failed to load records from the Archived Vault. Server may be spinning up.');
      }
    } finally {
      if (mountRef.current) setLoading(false);
    }
  }, [fetchWithRetry]);

  useEffect(() => {
    loadArchivedCitizens();
  }, [loadArchivedCitizens]);

  // Filter archived citizens based on search term
  const filteredCitizens = useMemo(() => {
    const term = searchTerm?.trim().toLowerCase() || '';
    if (!term) return archivedCitizens;

    return archivedCitizens.filter((citizen) => {
      const citizenId = getCitizenId(citizen);
      return (
        citizenId?.toString().toLowerCase().includes(term) ||
        citizen.fullName?.toLowerCase().includes(term) ||
        citizen.email?.toLowerCase().includes(term) ||
        citizen.zone?.toLowerCase().includes(term) ||
        citizen.phoneNumber?.toLowerCase().includes(term)
      );
    });
  }, [archivedCitizens, searchTerm]);

  // Reset page when search term changes
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [searchTerm]);

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

  // --- Row Selection Handlers ---
  const toggleSelectRow = useCallback((citizenId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(citizenId)) {
        next.delete(citizenId);
      } else {
        next.add(citizenId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentPageIds = paginatedCitizens.map(getCitizenId).filter(Boolean);
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
  }, [paginatedCitizens, selectedIds]);

  // Double click row toggle
  const handleRowDoubleClick = (citizen) => {
    const id = getCitizenId(citizen);
    if (id) toggleSelectRow(id);
  };

  // Dialog Openers
  const openRestoreDialog = (citizen) => {
    setSelectedCitizen(citizen);
    setIsRestoreOpen(true);
  };

  const openDeleteDialog = (citizen) => {
    setSelectedCitizen(citizen);
    setIsDeleteOpen(true);
  };

  // Perform Single Restore Request
  const handleConfirmRestore = async () => {
    if (!selectedCitizen) return;
    const citizenId = getCitizenId(selectedCitizen);

    try {
      setIsSubmitting(true);
      await fetchWithRetry(`/citizens/${citizenId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionTag: `RESTORE_CITIZEN_${citizenId}` })
      });

      setIsRestoreOpen(false);
      setSelectedCitizen(null);
      await loadArchivedCitizens(true);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Error restoring citizen:', err);
      alert('Failed to restore citizen. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Perform Single Permanent Delete Request
  const handleConfirmDelete = async () => {
    if (!selectedCitizen) return;
    const citizenId = getCitizenId(selectedCitizen);

    try {
      setIsSubmitting(true);
      await fetchWithRetry(`/citizens/${citizenId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionTag: `PERMANENT_DELETE_${citizenId}` })
      });

      setIsDeleteOpen(false);
      setSelectedCitizen(null);
      await loadArchivedCitizens(true);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Error deleting citizen permanently:', err);
      alert('Failed to permanently delete record. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Perform Batch Restore Request
  const handleConfirmBatchRestore = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsSubmitting(true);
      const restorePromises = Array.from(selectedIds).map((id) =>
        fetchWithRetry(`/citizens/${id}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionTag: `BATCH_RESTORE_${id}` })
        })
      );

      await Promise.all(restorePromises);

      setIsBatchRestoreOpen(false);
      setSelectedIds(new Set());
      await loadArchivedCitizens(true);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Error restoring selected citizens:', err);
      alert('Failed to restore some selected records. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Perform Batch Permanent Delete Request
  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsSubmitting(true);
      const deletePromises = Array.from(selectedIds).map((id) =>
        fetchWithRetry(`/citizens/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionTag: `BATCH_DELETE_${id}` })
        })
      );

      await Promise.all(deletePromises);

      setIsBatchDeleteOpen(false);
      setSelectedIds(new Set());
      await loadArchivedCitizens(true);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Error deleting selected citizens:', err);
      alert('Failed to delete some selected records. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const areAllCurrentPageSelected = useMemo(() => {
    if (paginatedCitizens.length === 0) return false;
    return paginatedCitizens.every((c) => selectedIds.has(getCitizenId(c)));
  }, [paginatedCitizens, selectedIds]);

  if (loading && !retrying) {
    return (
      <div className="w-full divide-y divide-slate-100 dark:divide-slate-800">
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

  return (
    <>
      {/* Retrying Banner Indicator */}
      {retrying && (
        <div className="bg-amber-50 border-b border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/60 px-4 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
            Connecting to Render server... Attempting automatic retry.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between bg-red-50 border-b border-red-200 dark:bg-red-950/40 dark:border-red-900/50 px-6 py-3 text-xs text-red-700 dark:text-red-300">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-500" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadArchivedCitizens(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold hover:underline text-red-700 dark:text-red-300"
          >
            <RefreshCw className="h-3 w-3" /> Retry Sync
          </button>
        </div>
      )}

      {/* 🔹 Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/70 min-h-[52px]">
        <div className="flex items-center gap-3">
          {/* Select All Button */}
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={paginatedCitizens.length === 0}
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

          <button
            type="button"
            onClick={() => loadArchivedCitizens(true)}
            title="Force refresh vault from server"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border bg-white border-slate-300 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400">
            Tip: Double-click any row to toggle selection
          </span>
        </div>

        {/* 🔹 Framer Motion Animated Action Buttons (Restore & Delete) */}
        <AnimatePresence>
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, x: 15 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 15 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="flex items-center gap-2"
            >
              {/* 🟩 BATCH RESTORE BUTTON */}
              <button
                type="button"
                onClick={() => setIsBatchRestoreOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 focus:outline-none transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore Selected ({selectedIds.size})
              </button>

              {/* 🟥 BATCH DELETE BUTTON */}
              <button
                type="button"
                onClick={() => setIsBatchDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-rose-700 focus:outline-none transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selectedIds.size})
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Table Data */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="w-12 px-4 py-4 text-center">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-6 py-4">Citizen ID</th>
              <th className="px-6 py-4">Full Name</th>
              <th className="px-6 py-4">Location Address</th>
              <th className="px-6 py-4">Archived At</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {paginatedCitizens.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  <Archive className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" />
                  No archived citizens found in the Vault.
                </td>
              </tr>
            ) : (
              paginatedCitizens.map((citizen) => {
                const citizenId = getCitizenId(citizen);
                const isSelected = selectedIds.has(citizenId);
                const archivedDate = citizen.archivedAt 
                  ? new Date(citizen.archivedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })
                  : 'N/A';

                return (
                  <motion.tr
                    key={citizenId}
                    onDoubleClick={() => handleRowDoubleClick(citizen)}
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
                        onClick={() => toggleSelectRow(citizenId)}
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
                      <span 
                        style={{ fontFamily: "'Roboto', sans-serif" }} 
                        className="inline-block rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-sm font-bold tracking-wide text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80"
                      >
                        {citizenId || 'N/A'}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {citizen.fullName || 'Unnamed Record'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{citizen.email}</div>
                    </td>

                    <td className="px-6 py-4">
                      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {citizen.zone || 'Unassigned'}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {archivedDate}
                    </td>

                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-end gap-2">
                        {/* 🟩 RESTORE BUTTON */}
                        <button
                          onClick={() => openRestoreDialog(citizen)}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/60 px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </button>

                        {/* 🟥 DELETE BUTTON */}
                        <button
                          onClick={() => openDeleteDialog(citizen)}
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
      {!loading && filteredCitizens.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 px-6 py-4 gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.min(currentPage * itemsPerPage, filteredCitizens.length)}</span> of{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredCitizens.length}</span> archived records
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

      {/* 🟩 RESTORE ALERT DIALOG */}
      <AlertDialog open={isRestoreOpen} onOpenChange={setIsRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <RotateCcw className="h-5 w-5" /> Restore Citizen Record
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore <strong>{selectedCitizen?.fullName || getCitizenId(selectedCitizen)}</strong> back to active citizen records? This will also reactivate their account access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRestore}
              disabled={isSubmitting}
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restoring...
                </>
              ) : (
                'Confirm Restore'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 🟩 BATCH RESTORE ALERT DIALOG */}
      <AlertDialog open={isBatchRestoreOpen} onOpenChange={setIsBatchRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <RotateCcw className="h-5 w-5" /> Restore {selectedIds.size} Citizen Records
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore <strong>{selectedIds.size} selected citizen records</strong> back to active citizen records? This will reactivate their accounts and move them out of the vault.
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

      {/* 🟥 PERMANENT DELETE ALERT DIALOG */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Trash2 className="h-5 w-5" /> Permanently Delete Citizen
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action <strong>cannot be undone</strong>. This will permanently delete <strong>{selectedCitizen?.fullName || getCitizenId(selectedCitizen)}</strong> from both the archived Firestore database and Firebase Authentication.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isSubmitting}
              className="bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...
                </>
              ) : (
                'Permanently Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 🟥 BATCH DELETE ALERT DIALOG */}
      <AlertDialog open={isBatchDeleteOpen} onOpenChange={setIsBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Trash2 className="h-5 w-5" /> Permanently Delete {selectedIds.size} Records
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action <strong>cannot be undone</strong>. You are about to permanently remove <strong>{selectedIds.size} selected citizen records</strong> from both the database and authentication services.
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting Selected...
                </>
              ) : (
                `Permanently Delete (${selectedIds.size})`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ArchivedCitizensTable;