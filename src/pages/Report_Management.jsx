import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import { useReportStore } from '../useReportStore'; 

// Firestore & Firebase Auth Imports
import { db, auth } from '../firebase';
import { collection, onSnapshot, query, limit } from 'firebase/firestore';

// Components
import View_Reports from '@/report_utilities/View_Reports';
import ReportedIncidentModal from './ReportedIncidentModal'; 
import VerifyIncidentModal from './VerifyIncidentModal';
import ReportTitle from './ReportTitle'; 
import Archived_Routes from '@/report_utilities/Archived_Routes';
import DuplicateReports from '@/report_utilities/Duplicate_Reports';

// Shadcn UI Skeleton & Dialog Components
import { Skeleton } from "@/components/ui/skeleton";
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

// Lucide React Icons
import { 
  RefreshCw, 
  Search, 
  Archive, 
  CheckCircle2, 
  AlertTriangle,
  FileText,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Eye,
  XCircle,
  MapPin,
  Clock,
  Loader2,
  Copy
} from 'lucide-react';

// 🌐 Dynamic Environment Configuration
const RAW_SERVER_URL = import.meta.env.VITE_API_URL || 'https://alertu-server-production.up.railway.app';
const CLEAN_SERVER_URL = RAW_SERVER_URL.replace(/\/+$/, '');
const API_BASE_URL = CLEAN_SERVER_URL.endsWith('/api')
  ? CLEAN_SERVER_URL
  : `${CLEAN_SERVER_URL}/api`;
const SOCKET_SERVER_URL = CLEAN_SERVER_URL.replace(/\/api$/, '');

const REPORT_LIMIT = 100; // Cache & query payload limit per active tab

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
  if (!timestamp) return 'N/A';
  const dateObj = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  if (isNaN(dateObj.getTime())) return 'N/A';

  return {
    date: dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
};

/**
 * Helper to extract numeric value from Report ID strings (e.g. "RID00000009" -> 9)
 */
const parseReportIdNumber = (idStr) => {
  if (!idStr) return 0;
  const match = String(idStr).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

/**
 * Enhanced Shadcn Skeleton Loader for Table Rows
 */
const TableSkeletonLoader = () => (
  <motion.div 
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.25 }}
    className="w-full divide-y divide-slate-100 dark:divide-slate-800"
  >
    {[...Array(5)].map((_, i) => (
      <div key={i} className="flex items-center justify-between p-4 space-x-4">
        <Skeleton className="h-7 w-24 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3 rounded" />
          <Skeleton className="h-3 w-1/4 rounded" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-36 rounded-md" />
        <Skeleton className="h-6 w-28 rounded-md" />
        <div className="flex items-center space-x-2">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      </div>
    ))}
  </motion.div>
);

export default function Report_Management() {
  const socketRef = useRef(null);
  
  // Cache Ref for reports by tab type
  const reportCacheRef = useRef({
    active: null,
    duplicate: null,
    archived: null,
  });

  // Global State for Verification Workflow
  const {
    isVerifyModalOpen,
    currentStep,
    selectedReport,
    customLocation,
    verifiedIncidentType,
    verifiedSeverity,
    adminNotes,
    reportTitle,
    tempSpatialData,
    selectedAgencies,
    isSensitive,
    setVerifyModalOpen,
    setCurrentStep,
    setSelectedReport,
    setCustomLocation,
    setVerifiedIncidentType,
    setVerifiedSeverity,
    setAdminNotes,
    setIsSensitive,
    setReportTitle,
    setSelectedAgencies,
    setTempSpatialData,
    resetModalState,
  } = useReportStore();

  // Modal & Dialog States
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedViewReport, setSelectedViewReport] = useState(null);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [reportToReject, setReportToReject] = useState(null);
  const [isRejecting, setIsRejecting] = useState(false);

  // Data & Refetch Loading States
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'duplicate' | 'archived'

  // Filtering & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // 🔥 FIRESTORE REAL-TIME LISTENER FOR ACTIVE & DUPLICATE TABS 🔥
  useEffect(() => {
    if (activeTab === 'archived') return;

    if (reportCacheRef.current[activeTab]) {
      setReports(reportCacheRef.current[activeTab]);
      setLoading(false);
    } else {
      setLoading(true);
    }
    
    setError(null);

    const reportsQuery = query(
      collection(db, 'reports'),
      limit(REPORT_LIMIT)
    );

    const unsubscribe = onSnapshot(
      reportsQuery,
      (snapshot) => {
        let fetchedReports = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Client-side filtering ensures both boolean flags and status fields work cleanly
        if (activeTab === 'active') {
          fetchedReports = fetchedReports.filter(r => !r.isDuplicate && r.status !== 'duplicate');
        } else if (activeTab === 'duplicate') {
          fetchedReports = fetchedReports.filter(r => r.isDuplicate === true || r.status === 'duplicate');
        }

        reportCacheRef.current[activeTab] = fetchedReports;
        setReports(fetchedReports);
        setLoading(false);
      },
      (err) => {
        console.error("Firestore subscription error:", err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeTab]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    reportCacheRef.current[activeTab] = null;
    
    setTimeout(() => {
      setIsRefreshing(false);
    }, 750);
  };

  // Socket Connection
  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER_URL, {
      transports: ['websocket'],
      query: { role: 'admin', room: 'super_admins' },
    });

    const socket = socketRef.current;
    socket.on('connect', () => socket.emit('join_room', 'super_admins'));

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  const getAuthToken = async () => {
    const firebaseUser = auth.currentUser;
    if (firebaseUser) {
      return await firebaseUser.getIdToken();
    }
    return localStorage.getItem('token') || localStorage.getItem('adminToken');
  };

  const logAdminAction = async (action, target, metadata = {}) => {
    const reportIdentifier = selectedReport?.reportID || selectedReport?.id;
    const payload = {
      action,
      target: target || (reportIdentifier ? `Report_#${reportIdentifier}` : 'Report_Management'),
      adminName: 'Admin User',
      adminId: 'usr_admin',
      metadata,
      targetRoom: 'super_admins',
      timestamp: new Date().toISOString()
    };

    if (socketRef.current?.connected) {
      socketRef.current.emit('admin_action_event', payload);
    }

    try {
      const token = await getAuthToken();
      await fetch(`${API_BASE_URL}/admin-actions/log`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn("Failed to log action:", err.message);
    }
  };

  const generateVerifiedReportID = (report) => {
    if (report?.verifiedReportID) return report.verifiedReportID;
    const numId = parseReportIdNumber(report?.reportID || report?.id);
    if (numId > 0) {
      return `VRID-${String(numId).padStart(8, '0')}`;
    }
    return `VRID-${Date.now().toString().slice(-8)}`;
  };

  const handleOpenViewModal = (report) => {
    const reportIdentifier = report.reportID || report.id;
    setSelectedViewReport(report);
    setIsViewModalOpen(true);
    logAdminAction('VIEW_REPORT', `Report_#${reportIdentifier}`, { reportId: reportIdentifier });
  };

  const handleCloseViewModal = () => {
    setIsViewModalOpen(false);
    setSelectedViewReport(null);
  };

  const openVerifyWorkflow = (report) => {
    if (!report) return;
  
    const reportIdentifier = 
      report.reportID || 
      report.reportId || 
      report.customId || 
      (report.id && !isNaN(report.id) ? `RID${String(report.id).padStart(8, '0')}` : report.id);
  
    const normalizedReport = {
      ...report,
      reportID: reportIdentifier,
      verifiedReportID: report.verifiedReportID || null,
      timestamp: report.timestamp || report.createdAt || report.submittedAt || new Date().toISOString(),
      submitterName: 
        report.submitterName || 
        report.fullName || 
        report.userName || 
        report.reporterName || 
        report.user?.name || 
        report.user?.fullName || 
        'N/A',
      submitterPhone: 
        report.submitterPhone || 
        report.phoneNumber || 
        report.phone || 
        report.contactNumber || 
        report.user?.phone || 
        'N/A',
      submitterEmail: 
        report.submitterEmail || 
        report.email || 
        report.user?.email || 
        'N/A',
    };
  
    setSelectedReport(normalizedReport);
    setCurrentStep(1);
    setReportTitle('');
    setSelectedAgencies([]);
    setIsSensitive(report.isSensitive || false);
    
    const initialLat = Number(report?.location?.latitude || report?.latitude || 14.75);
    const initialLng = Number(report?.location?.longitude || report?.longitude || 120.95);
    const initialAddr = report?.location?.address || report?.address || 'Location unavailable';
    
    setCustomLocation({ lat: initialLat, lng: initialLng, address: initialAddr });
    setVerifiedIncidentType(report.incidentType || report.hazard || 'Fire');
    setVerifiedSeverity(report.severity || 'Medium');
    setAdminNotes(report.notes || '');
    
    setVerifyModalOpen(true);

    // ⚡ Notify Flutter citizen app that review has started
    if (socketRef.current) {
      socketRef.current.emit('ADMIN_ACTION_EVENT', {
        action: 'OPEN_VERIFY_MODAL',
        target: reportIdentifier,
        reportId: reportIdentifier,
        timestamp: new Date().toISOString(),
      });
    }

    logAdminAction('START_VERIFY_WORKFLOW', `Report_#${reportIdentifier}`, { reportId: reportIdentifier });
  };

  const closeVerifyModal = async () => {
    const reportIdentifier = selectedReport?.reportID || selectedReport?.id;
    
    if (reportIdentifier) {
      // ⚡ Notify Flutter citizen app that review was closed/cancelled
      if (socketRef.current) {
        socketRef.current.emit('ADMIN_ACTION_EVENT', {
          action: 'CLOSE_VERIFY_MODAL',
          target: reportIdentifier,
          reportId: reportIdentifier,
          timestamp: new Date().toISOString(),
        });
      }

      await logAdminAction('CLOSE_VERIFY_MODAL', `Report_#${reportIdentifier}`, { 
        reportId: reportIdentifier,
        abandonedAtStep: currentStep 
      });
    }
    resetModalState();
  };

  const handleStepChange = (targetStep, direction = 'forward') => {
    const reportIdentifier = selectedReport?.reportID || selectedReport?.id;
    setCurrentStep(targetStep);
    let actionName = targetStep === 1 ? 'FIRST_STEPMODAL' : targetStep === 2 ? 'SECOND_STEPMODAL' : 'THIRD_STEPMODAL';
    logAdminAction(actionName, `Report_#${reportIdentifier}`, { reportId: reportIdentifier, step: targetStep, navigation: direction });
  };

  const handleProceedToTitle = (status, spatialData) => {
    setTempSpatialData(spatialData);
    handleStepChange(3, 'forward');
  };

  const handleFinalSubmit = async () => {
    const sourceDocumentId =
      selectedReport?.id ||
      selectedReport?._id ||
      selectedReport?.reportID ||
      selectedReport?.reportId;

    if (!sourceDocumentId || sourceDocumentId === '_') {
      alert('Unable to verify this report because its document ID is missing.');
      return;
    }

    const reportIdentifier = selectedReport?.reportID || sourceDocumentId;
    const verifiedReportID = generateVerifiedReportID(selectedReport);

    // Extract target citizen user ID for room routing
    const targetUserId =
      selectedReport?.userId ||
      selectedReport?.citizenId ||
      selectedReport?.reportedBy ||
      selectedReport?.user?.uid ||
      selectedReport?.user?.id ||
      '';

    try {
      const payload = {
        status: 'verified',
        verifiedReportID: verifiedReportID,
        incidentType: verifiedIncidentType.toLowerCase(),
        verifiedSeverity,
        adminNotes,
        reportTitle,
        selectedAgencies: selectedAgencies.map(agency => ({ id: agency.id, name: agency.name })), 
        verifiedAt: new Date().toISOString(),
        correctedLatitude: customLocation.lat,
        correctedLongitude: customLocation.lng,
        correctedAddress: customLocation.address,
        radius: tempSpatialData.radius || null,
        polyline: tempSpatialData.polyline || null,
        selectedMarkerIcon: tempSpatialData.selectedMarkerIcon || '',
        routeCoords: tempSpatialData.routeCoords || [],
        isSensitive: isSensitive,
      };

      const token = await getAuthToken();
      const response = await fetch(`${API_BASE_URL}/reports/${encodeURIComponent(sourceDocumentId)}/verify`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // ⚡ Prepare complete payload for Flutter client socket listener
        const realtimeSocketPayload = {
          action: 'REPORT_VERIFIED',             // Matches Flutter isApprovedAction
          status: 'APPROVED',                    // Fallback status match
          reportId: reportIdentifier,
          reportID: reportIdentifier,
          verifiedReportID: verifiedReportID,
          userId: targetUserId,                  // Crucial for backend routing to citizen room
          citizenId: targetUserId,
          title: reportTitle,
          severity: verifiedSeverity,
          agencies: selectedAgencies,
          location: customLocation,
          timestamp: new Date().toISOString(),
          eventId: `verified_${reportIdentifier}_${Date.now()}`
        };

        await logAdminAction(
          'VERIFIED_REPORT_DISPATCH',
          `Report_#${reportIdentifier}`,
          realtimeSocketPayload
        );

        // ⚡ Emit across all real-time channels Flutter listens to
        if (socketRef.current) {
          socketRef.current.emit('ADMIN_ACTION_EVENT', realtimeSocketPayload);
          socketRef.current.emit('DISPATCH_VERIFIED_INCIDENT', realtimeSocketPayload);
          socketRef.current.emit('CITIZEN_REPORT_UPDATED', realtimeSocketPayload);
        }

        reportCacheRef.current[activeTab] = null;

        // 🛑 Unmount/reset modal ONLY AFTER emitting socket events
        resetModalState();
      } else {
        alert("Failed to save report: " + result.message);
      }
    } catch (err) {
      console.error("Final submission error:", err);
      alert("An error occurred during submission.");
    }
  };

  const triggerReject = (reportId) => {
    setReportToReject(reportId);
    setIsRejectDialogOpen(true);
    logAdminAction('OPEN_REJECT_DIALOG', `Report_#${reportId}`, { reportId });
  };

  const handleReject = async () => {
    if (!reportToReject) return;
    
    try {
      setIsRejecting(true);
      const token = await getAuthToken();

      if (!token) {
        alert("Session expired. Please log in again.");
        return;
      }
      
      const response = await fetch(`${API_BASE_URL}/reports/${reportToReject}/reject`, { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        const rejectedReport = reports.find((report) => [
          report?.id,
          report?.reportID,
          report?.reportId,
        ].some((value) => String(value ?? '') === String(reportToReject)));

        const rejectionPayload = {
          action: 'REPORT_REJECTED',
          status: 'REJECTED',
          reportId: reportToReject,
          reportID: reportToReject,
          userId: rejectedReport?.userId ||
            rejectedReport?.authUid ||
            rejectedReport?.uid ||
            rejectedReport?.reportedBy ||
            rejectedReport?.user?.uid ||
            '',
          citizenId: rejectedReport?.citizenID ||
            rejectedReport?.citizenId ||
            rejectedReport?.CID ||
            '',
          rejectedAt: new Date().toISOString(),
          eventId: `rejected_${reportToReject}_${Date.now()}`,
        };

        // Use the authenticated backend relay so the server resolves the citizen
        // rooms and forwards ADMIN_ACTION_EVENT/CITIZEN_REPORT_UPDATED safely.
        await logAdminAction(
          'REPORT_REJECTED',
          `Report_#${reportToReject}`,
          rejectionPayload,
        );

        reportCacheRef.current[activeTab] = null;
        setIsRejectDialogOpen(false);
        setReportToReject(null);
      } else {
        alert(result.message || 'Failed to reject report.');
      }
    } catch (err) {
      console.error("Reject error:", err);
      alert("An error occurred while rejecting the report.");
    } finally {
      setIsRejecting(false);
    }
  };

  // Filter & Pagination Logic (Active Tab)
  const filteredReports = useMemo(() => {
    const result = reports.filter((report) => {
      const title = (report.reportTitle || report.incidentType || report.hazard || '').toLowerCase();
      const address = (report.location?.address || report.address || report.correctedAddress || '').toLowerCase();
      const id = String(report.reportID || report.id || '').toLowerCase();
      const parentId = String(report.parentReportId || report.originalReportId || '').toLowerCase();
      const queryStr = searchQuery.trim().toLowerCase();

      const matchesSearch = !queryStr || title.includes(queryStr) || address.includes(queryStr) || id.includes(queryStr) || parentId.includes(queryStr);
      const matchesSeverity = severityFilter === 'ALL' || (report.severity || '').toUpperCase() === severityFilter.toUpperCase();

      return matchesSearch && matchesSeverity;
    });

    return result.sort((a, b) => {
      const idA = parseReportIdNumber(a.reportID || a.id);
      const idB = parseReportIdNumber(b.reportID || b.id);

      if (idA !== idB) {
        return idB - idA;
      }

      return String(b.reportID || b.id).localeCompare(String(a.reportID || a.id), undefined, { numeric: true });
    });
  }, [reports, searchQuery, severityFilter]);

  const totalPages = Math.ceil(filteredReports.length / itemsPerPage) || 1;
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredReports.slice(start, start + itemsPerPage);
  }, [filteredReports, currentPage, itemsPerPage]);

  const severityFilterOptions = [
    { label: 'All', value: 'ALL' },
    { label: 'Critical', value: 'CRITICAL' },
    { label: 'High', value: 'HIGH' },
    { label: 'Medium', value: 'MEDIUM' },
    { label: 'Low', value: 'LOW' },
  ];

  return (
    <div className="w-full p-6 font-sans text-slate-900 dark:text-slate-100 transition-colors duration-200">
      
      {/* Header */}
      <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Report Management</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Monitor, verify incoming citizen emergency reports, manage duplicates, dispatch agency responses, and review archives.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleManualRefresh} 
            disabled={isRefreshing || loading}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
            Refresh Data
          </button>
        </div>
      </header>

      {/* Main Card Wrapper */}
      <div className="w-full rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 px-6">
          <button
            onClick={() => { setActiveTab('active'); setCurrentPage(1); }}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors ${
              activeTab === 'active'
                ? 'border-blue-600 bg-white text-blue-600 dark:bg-slate-900 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <FileText className="h-4 w-4" />
            Active Reports
            {activeTab === 'active' && (
              <span className="ml-1 rounded-full bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                {reports.length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveTab('duplicate'); setCurrentPage(1); }}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors ${
              activeTab === 'duplicate'
                ? 'border-amber-500 bg-white text-amber-600 dark:bg-slate-900 dark:text-amber-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Copy className="h-4 w-4" />
            Duplicate Reports
            {activeTab === 'duplicate' && (
              <span className="ml-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 px-2 py-0.5 text-xs font-semibold">
                {reports.length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveTab('archived'); setCurrentPage(1); }}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors ${
              activeTab === 'archived'
                ? 'border-blue-600 bg-white text-blue-600 dark:bg-slate-900 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Archive className="h-4 w-4" />
            Rejected Reports
          </button>
        </div>

        {/* Toolbar Controls (Active Tab Only) */}
        {activeTab === 'active' && (
          <div className="flex flex-col gap-4 border-b border-slate-200 dark:border-slate-800 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-lg">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                aria-label="Search incident reports"
                placeholder="Search by Report ID, incident type, or street/barangay..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white pl-9 pr-4 py-2 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80">
              {severityFilterOptions.map((opt) => {
                const isSelected = severityFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setSeverityFilter(opt.value); setCurrentPage(1); }}
                    className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isSelected
                        ? 'text-slate-900 dark:text-white font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="activeReportFilterPill"
                        className="absolute inset-0 bg-white dark:bg-slate-900 rounded-md shadow-sm border border-slate-200/60 dark:border-slate-700/60"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Table Content & Dynamic Transitions */}
        <AnimatePresence mode="wait">
          {activeTab === 'archived' ? (
            <Archived_Routes key="archived-tab" cachedData={reportCacheRef.current.archived} onDataFetched={(data) => { reportCacheRef.current.archived = data; }} />
          ) : activeTab === 'duplicate' ? (
            <DuplicateReports key="duplicate-tab" reports={reports} />
          ) : loading || isRefreshing ? (
            <TableSkeletonLoader key="skeleton-loader" />
          ) : error ? (
            <motion.div 
              key="error-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-12 text-center"
            >
              <ShieldAlert className="h-8 w-8 text-red-500" />
              <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">Failed to load reports: {error}</p>
            </motion.div>
          ) : (
            <motion.div 
              key="table-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full overflow-x-auto"
            >
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="px-6 py-4">Report ID</th>
                    <th className="px-6 py-4">Incident Type</th>
                    <th className="px-6 py-4">Severity</th>
                    <th className="px-6 py-4">Location (Street & Brgy)</th>
                    <th className="px-6 py-4">Date & Time</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <AnimatePresence mode="wait">
                    {paginatedReports.length === 0 ? (
                      <motion.tr
                        key="empty-state"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400">
                          <AlertTriangle className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" />
                          No active reports match your selected criteria.
                        </td>
                      </motion.tr>
                    ) : (
                      <React.Fragment key="report-list-container">
                        {paginatedReports.map((report) => {
                          const displayType = report.reportTitle || report.incidentType || report.hazard || 'General Incident';
                          const fullAddress = report.location?.address || report.address || report.correctedAddress;
                          const formattedLocation = formatStreetAndBarangay(fullAddress);
                          const severity = (report.severity || 'Medium').toLowerCase();
                          const rawTimestamp = report.timestamp || report.createdAt;
                          const { date, time } = formatDateTime(rawTimestamp);

                          return (
                            <motion.tr
                              key={report.id || report.reportID}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.2 }}
                              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                            >
                              <td className="px-6 py-4">
                                <span 
                                  style={{ fontFamily: "'Roboto', sans-serif" }} 
                                  className="inline-block rounded-md px-2.5 py-1 text-sm font-bold tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80"
                                >
                                  {report.reportID || report.id}
                                </span>
                              </td>

                              <td className="px-6 py-4 font-medium capitalize text-slate-900 dark:text-slate-100">
                                {displayType}
                              </td>

                              <td className="px-6 py-4">
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${
                                  severity === 'critical' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400' :
                                  severity === 'high' ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-400' :
                                  severity === 'medium' ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400' :
                                  'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400'
                                }`}>
                                  <AlertTriangle className="h-3 w-3" />
                                  {severity}
                                </span>
                              </td>

                              <td className="px-6 py-4">
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 truncate max-w-xs">
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

                              {/* Action Buttons */}
                              <td className="px-6 py-4 text-right">
                                <div className="inline-flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => handleOpenViewModal(report)}
                                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors"
                                  >
                                    <Eye className="h-3.5 w-3.5" /> View
                                  </button>

                                  <button
                                    onClick={() => openVerifyWorkflow(report)}
                                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Verify
                                  </button>

                                  <button
                                    onClick={() => triggerReject(report.id)}
                                    className="inline-flex items-center gap-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors"
                                  >
                                    <XCircle className="h-3.5 w-3.5" /> Reject
                                  </button>
                                </div>
                              </td>
                            </motion.tr>
                          );
                        })}
                      </React.Fragment>
                    )}
                  </AnimatePresence>
                </tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pagination Controls (Active Tab Only) */}
        {activeTab === 'active' && !loading && !isRefreshing && filteredReports.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 px-6 py-4 gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.min(currentPage * itemsPerPage, filteredReports.length)}</span> of{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredReports.length}</span> records
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
      </div>

      {/* 1️⃣ VIEW REPORT MODAL */}
      {isViewModalOpen && selectedViewReport && (
        <View_Reports
          isOpen={isViewModalOpen}
          onClose={handleCloseViewModal}
          report={selectedViewReport}
        />
      )}

      {/* 2️⃣ VERIFICATION WORKFLOW MODALS */}
      {isVerifyModalOpen && (
        <>
          {currentStep === 1 && (
            <ReportedIncidentModal
              isOpen={isVerifyModalOpen}
              onClose={closeVerifyModal}
              selectedReport={selectedReport}
              setCurrentStep={(step) => handleStepChange(typeof step === 'function' ? step(currentStep) : step, 'forward')}
              customLocation={customLocation}
              setCustomLocation={setCustomLocation}
              verifiedIncidentType={verifiedIncidentType}
              setVerifiedIncidentType={setVerifiedIncidentType}
              verifiedSeverity={verifiedSeverity}
              setVerifiedSeverity={setVerifiedSeverity}
              adminNotes={adminNotes}
              setAdminNotes={setAdminNotes}
              isSensitive={isSensitive}
              setIsSensitive={setIsSensitive}
              socketInstance={socketRef.current}
            />
          )}

          {currentStep === 2 && (
            <VerifyIncidentModal
              isOpen={isVerifyModalOpen}
              currentStep={currentStep}
              setCurrentStep={(step) => {
                const nextStep = typeof step === 'function' ? step(currentStep) : step;
                handleStepChange(nextStep, nextStep < currentStep ? 'back' : 'forward');
              }}
              selectedReport={selectedReport}
              currentReportLat={customLocation.lat}
              currentReportLng={customLocation.lng}
              customLocation={customLocation}
              setCustomLocation={setCustomLocation}
              verifiedIncidentType={verifiedIncidentType}
              handleVerifySubmit={handleProceedToTitle}
              setIsVerifyModalOpen={closeVerifyModal}
              socketInstance={socketRef.current}
            />
          )}

          {currentStep === 3 && (
            <ReportTitle
              isOpen={isVerifyModalOpen}
              selectedReport={selectedReport}      
              spatialData={tempSpatialData}          
              adminNotes={adminNotes}                
              setAdminNotes={setAdminNotes}          
              currentStep={currentStep}
              reportTitle={reportTitle}
              setReportTitle={setReportTitle}
              selectedAgencies={selectedAgencies}  
              setSelectedAgencies={setSelectedAgencies} 
              setCurrentStep={(step) => {
                const nextStep = typeof step === 'function' ? step(currentStep) : step;
                handleStepChange(nextStep, nextStep < currentStep ? 'back' : 'forward');
              }}
              handleFinalSubmit={handleFinalSubmit}
              onClose={closeVerifyModal}
              socketInstance={socketRef.current}
            />
          )}
        </>
      )}

      {/* REJECT CONFIRMATION DIALOG */}
      <AlertDialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <XCircle className="h-5 w-5" /> Reject Emergency Report?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reject this emergency report? This action will decline the incident dispatch and move the record to the rejected system archive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRejecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleReject} 
              disabled={isRejecting}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isRejecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rejecting...
                </>
              ) : (
                'Confirm Reject'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}