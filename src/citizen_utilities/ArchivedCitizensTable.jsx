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
      const response = await fetchWithRetry('/citizens/archived?query
