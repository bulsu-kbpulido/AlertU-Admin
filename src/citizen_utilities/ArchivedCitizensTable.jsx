import useNewRows from '../hooks/useNewRows';
import NewBadge from '../components/NewBadge';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchFromBackend } from '../api';
import { 
  ChevronLeft, 
  ChevronRight, 
  ShieldAlert, 
  Archive,
  Loader2,
  RefreshCw,
  Eye
} from 'lucide-react';

// Import shadcn/ui AlertDialog components
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from 'sonner';

// Cache Configuration matching CitizenManagement pattern
const CACHE_KEY = 'ALERTU_ARCHIVED_CITIZENS_CACHE';
const CACHE_TTL_MS = 60 * 1000; // 1 minute client-side TTL
let memoryArchivedCache = null;
let memoryCacheTimestamp = 0;

const getCitizenId = (c) => c?.citizenID || c?.cid || c?.id;

const ArchivedCitizensTable = ({ 
  searchTerm, 
  onRefresh,
  onCountChange,
  refreshSignal = 0,
  onViewCitizen
}) => {
  const [archivedCitizens, setArchivedCitizens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const mountRef = useRef(true);

  useEffect(() => {
    mountRef.current = true;
    return () => {
      mountRef.current = false;
    };
  }, []);

  // Keep the parent (Archived Vault tab badge) in sync with the real archived count
  useEffect(() => {
    onCountChange?.(archivedCitizens.length);
  }, [archivedCitizens, onCountChange]);

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

  // Parent's "Refresh Data" button bumps refreshSignal -> force a fresh fetch
  const lastRefreshSignalRef = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === lastRefreshSignalRef.current) return;
    lastRefreshSignalRef.current = refreshSignal;
    loadArchivedCitizens(true);
  }, [refreshSignal, loadArchivedCitizens]);

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
  }, [searchTerm]);

  const totalPages = Math.ceil(filteredCitizens.length / itemsPerPage) || 1;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const { isNew, markSeen } = useNewRows('citizens-archived', archivedCitizens, {
    getTime: (item) => item.archivedAt || item.updatedAt || item.createdAt,
  });

  const paginatedCitizens = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredCitizens.slice(start, start + itemsPerPage);
  }, [filteredCitizens, currentPage, itemsPerPage]);

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

      {/* Table Data */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
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
                <td colSpan={5} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  <Archive className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" />
                  No archived citizens found in the Vault.
                </td>
              </tr>
            ) : (
              paginatedCitizens.map((citizen) => {
                const citizenId = getCitizenId(citizen);
                const archivedDate = citizen.archivedAt 
                  ? new Date(citizen.archivedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })
                  : 'N/A';

                return (
                  <tr
                    key={citizenId} 
                    onClickCapture={() => markSeen(citizen)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="px-6 py-4 font-medium text-slate-700 dark:text-slate-300">
                      {citizenId || 'N/A'}{isNew(citizen) && <NewBadge className="ml-2" />}
                    </td>

                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {citizen.fullName || 'Unnamed Record'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{citizen.email}</div>
                    </td>

                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300 max-w-xs xl:max-w-md truncate">
                      {citizen.zone || 'Unassigned'}
                    </td>

                    <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {archivedDate}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onViewCitizen && onViewCitizen(citizen)}
                          className="text-xs font-medium inline-flex items-center gap-1 shadow-sm"
                        >
                          <Eye className="h-3 w-3" />
                          <span>View</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
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
    </>
  );
};

export default ArchivedCitizensTable;
