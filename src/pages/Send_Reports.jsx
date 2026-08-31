import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchFromBackend } from '../api';
import 'ol/ol.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import { Point, LineString, Circle as CircleGeom } from 'ol/geom';
import { fromLonLat } from 'ol/proj';
import { Style, Stroke, Fill, Icon } from 'ol/style';
import { getVectorContext } from 'ol/render';

import { 
  ExternalLink, 
  MapPin, 
  CheckCircle2, 
  Archive, 
  Send, 
  Inbox,
  Search,
  RefreshCw,
  Grid,
  List,
  ArrowRight,
  AlertTriangle,
  Tag,
  Clock,
  ChevronLeft,
  ChevronRight,
  Hash,
  Calendar,
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
} from "@/components/ui/alert-dialog";

// Import Shadcn UI Button component
import { Button } from "@/components/ui/button";

import LinkPreview from './LinkPreview'; 
import GeneratedLink from './GeneratedLink';
import CitizenOrDepartments from './Citizen_or_Departments'; 
import Archived_Approved from '../reportsapproved_utils/Archived_Approved';
import Resolved_Incidents from '../reportsapproved_utils/Resolved_Incidents';
import { useAuditLog } from '../useAuditLog'; // Adjust import path if needed
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const ITEMS_PER_PAGE = 8;

const resolveMediaAsset = (report) => {
  const candidate =
    report?.mediaUrl ||
    report?.imageUrl ||
    (Array.isArray(report?.media) ? report.media[0] : report?.media) ||
    (Array.isArray(report?.attachments) ? report.attachments[0] : report?.attachments) ||
    null;

  const url = typeof candidate === 'string'
    ? candidate
    : candidate?.url || candidate?.downloadURL || candidate?.src || null;

  const type = typeof candidate === 'object'
    ? (candidate?.type || candidate?.mimeType || candidate?.contentType || '')
    : (report?.mediaType || report?.mimeType || report?.contentType || '');

  const cleanUrl = String(url || '').split('?')[0].split('#')[0].toLowerCase();
  const isVideo = String(type).toLowerCase().startsWith('video/') ||
    /\.(mp4|webm|ogg|mov|m4v|avi|mpeg|mpg)$/i.test(cleanUrl) ||
    /[\\/]video[\\/](upload|raw)[\\/]/i.test(String(url || ''));

  return { url, type, isVideo };
};
 

// Helper to resolve the display ID (Prioritizes VRID over RID)
const getDisplayId = (report) => {
  if (!report) return 'N/A';
  return report.verifiedReportId || report.verifiedreportID || report.id || report.reportDocId || 'N/A';
};

// Helper to extract Barangay and Street from location data or address string (Used for Table View)
const formatAddress = (location) => {
  if (!location) return 'Location unknown';

  if (location.barangay || location.street) {
    const parts = [];
    if (location.street) parts.push(location.street);
    if (location.barangay) {
      const bgry = location.barangay.toLowerCase().startsWith('brgy') || location.barangay.toLowerCase().startsWith('barangay')
        ? location.barangay 
        : `Brgy. ${location.barangay}`;
      parts.push(bgry);
    }
    return parts.join(', ');
  }

  const rawAddress = location.address || '';
  if (!rawAddress) return 'Location unknown';

  const parts = rawAddress.split(',').map(p => p.trim());
  let street = '';
  let barangay = '';

  for (const part of parts) {
    if (/^(brgy|barangay)\b/i.test(part)) {
      barangay = part;
    } else if (/\b(street|st\.|avenue|ave\.|road|rd\.|drive|dr\.|lane|ln\.|way)\b/i.test(part) && !street) {
      street = part;
    }
  }

  if (!barangay && !street) {
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[1]}`;
    }
    return parts[0];
  }

  return [street, barangay].filter(Boolean).join(', ');
};

// Helper for Shadcn Incident Badges
const getIncidentBadgeStyle = (incidentType) => {
  const normalized = (incidentType || '').trim().toLowerCase();
  if (normalized.includes('fire')) {
    return 'bg-red-600 text-white border-red-700';
  } else if (normalized.includes('flood')) {
    return 'bg-blue-600 text-white border-blue-700';
  } else if (normalized.includes('accident')) {
    return 'bg-violet-600 text-white border-violet-700';
  } else {
    return 'bg-orange-600 text-white border-orange-700';
  }
};

// Helper to format Date and Time
const formatDateTime = (timestamp) => {
  if (!timestamp) return { date: 'N/A', time: '' };
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return { date: 'N/A', time: '' };

  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  return { date, time };
};

// --- Magic UI Interactive Hover Button Component ---
const InteractiveHoverButton = ({ children, onClick, className = "", ...props }) => {
  return (
    <button
      onClick={onClick}
      className={`group relative w-full min-w-0 cursor-pointer overflow-hidden rounded-lg bg-slate-900 dark:bg-slate-100 p-2 text-center text-xs font-semibold text-white dark:text-slate-900 transition-all duration-300 hover:bg-slate-800 dark:hover:bg-white border border-slate-800 dark:border-slate-200 shadow-sm ${className}`}
      {...props}
    >
      <div className="flex items-center justify-center gap-1.5 sm:gap-2">
        <div className="h-1.5 w-1.5 rounded-full bg-blue-500 transition-all duration-300 group-hover:scale-[100]" />
        <span className="inline-block transition-all duration-300 group-hover:translate-x-12 group-hover:opacity-0 relative z-10 whitespace-nowrap truncate">
          {children}
        </span>
      </div>
      <div className="absolute top-0 z-10 flex h-full w-full translate-x-12 items-center justify-center gap-1.5 sm:gap-2 text-white dark:text-slate-900 opacity-0 transition-all duration-300 group-hover:-translate-x-2 group-hover:opacity-100 px-1">
        <span className="text-xs font-bold whitespace-nowrap truncate">{children}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
      </div>
    </button>
  );
};

// --- Skeleton Components ---
const CardSkeleton = () => (
  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4 animate-pulse shadow-sm">
    <div className="w-full h-40 bg-slate-200 dark:bg-slate-800 rounded-lg" />
    <div className="flex items-center justify-between gap-2">
      <div className="h-5 w-20 bg-slate-200 dark:bg-slate-800 rounded-md" />
      <div className="h-5 w-16 bg-slate-200 dark:bg-slate-800 rounded-md" />
    </div>
    <div className="space-y-2">
      <div className="h-5 w-3/4 bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="h-4 w-1/2 bg-slate-200 dark:bg-slate-800 rounded" />
    </div>
    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2">
      <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-lg" />
      <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-lg" />
    </div>
  </div>
);

const TableSkeleton = () => (
  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm p-4 space-y-4 animate-pulse">
    {[...Array(6)].map((_, i) => (
      <div key={i} className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 dark:border-slate-800 last:border-none">
        <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </div>
    ))}
  </div>
);

const ICON_COLOR_MAP = {
  'fireicon.png': '#ef4444',
  'floodicon.png': '#3b82f6',
  'accicon.png': '#eab308',
  'caricon.png': '#eab308',
  'quakeicon.png': '#78350f',
  'warnicon.png': '#f97316'
};

const hexToRgba = (hex, alpha) => {
  const cleanHex = (hex || '#3b82f6').replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Map preview renderer
const ReportMapPreview = ({ report, isTerminalState }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const { radius, polyline, location, selectedMarkerIcon, incidentType, routeCoords } = report;
    const centerLat = radius?.centerLat || location?.latitude || 14.75;
    const centerLng = radius?.centerLng || location?.longitude || 120.95;
    const centerMeters = fromLonLat([centerLng, centerLat]);

    const vectorSource = new VectorSource();
    const normalizedType = (incidentType || '').trim().toLowerCase();

    const INCIDENT_ICON_MAP = {
      fire: 'fireicon.png',
      flood: 'floodicon.png',
      accident: 'accicon.png',
      others: 'warnicon.png'
    };

    const iconFile = selectedMarkerIcon || INCIDENT_ICON_MAP[normalizedType] || 'warnicon.png';
    const activeColor = isTerminalState ? '#64748b' : (ICON_COLOR_MAP[iconFile] || '#3b82f6');

    let targetMeters = centerMeters;

    if (radius) {
      const circle = new Feature({ geometry: new CircleGeom(centerMeters, radius.radiusMeters || 300) });
      circle.setStyle(new Style({
        stroke: new Stroke({ color: activeColor, width: 2 }),
        fill: new Fill({ color: hexToRgba(activeColor, 0.15) })
      }));
      vectorSource.addFeature(circle);
    } else if (routeCoords && routeCoords.length > 0) {
      const sortedCoords = [...routeCoords].sort((a, b) => a.order - b.order);
      const lineCoords = sortedCoords.map(pt => fromLonLat([pt.lng, pt.lat]));
      const lineGeometry = new LineString(lineCoords);
      const line = new Feature({ geometry: lineGeometry });
      line.setStyle(new Style({
        stroke: new Stroke({ color: activeColor, width: 5, lineCap: 'round' })
      }));
      vectorSource.addFeature(line);
      targetMeters = lineGeometry.getCoordinateAt(0.50);
    } else if (polyline && polyline.length >= 2) {
      const lineCoords = polyline.map(pt => fromLonLat([pt.lng, pt.lat]));
      const lineGeometry = new LineString(lineCoords);
      const line = new Feature({ geometry: lineGeometry });
      line.setStyle(new Style({
        stroke: new Stroke({ color: activeColor, width: 4, lineCap: 'round' })
      }));
      vectorSource.addFeature(line);
      targetMeters = lineGeometry.getCoordinateAt(0.50);
    }

    const marker = new Feature({ geometry: new Point(targetMeters) });
    marker.setStyle(new Style({
      image: new Icon({
        anchor: [0.5, 1.0], 
        src: `/${iconFile}`,
        scale: 0.85,
        rotation: 0, 
        crossOrigin: 'anonymous'
      }),
      zIndex: 100
    }));
    vectorSource.addFeature(marker);

    const vectorLayer = new VectorLayer({ source: vectorSource });
    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        vectorLayer
      ],
      view: new View({ center: targetMeters, zoom: 14 })
    });
    mapInstance.current = map;

    if (!isTerminalState) {
      let radiusProgress = 0;
      vectorLayer.on('postrender', (event) => {
        const vectorContext = getVectorContext(event);
        const frameState = event.frameState;
        if (!vectorContext || !frameState) return;

        radiusProgress += frameState.time - (frameState.time - 16);
        const maxPulseRadius = 40;
        const currentRadius = (radiusProgress / 25) % maxPulseRadius;
        const opacity = 1 - (currentRadius / maxPulseRadius);
        
        const pulseStyle = new Style({
          stroke: new Stroke({ color: hexToRgba(activeColor, opacity), width: 3 }),
          fill: new Fill({ color: hexToRgba(activeColor, opacity * 0.15) })
        });

        vectorContext.setStyle(pulseStyle);
        vectorContext.drawGeometry(new Point(targetMeters));
        map.render();
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      map.updateSize();
    });
    resizeObserver.observe(mapRef.current);

    return () => {
      resizeObserver.disconnect();
      map.setTarget(null);
    };
  }, [report, isTerminalState]);

  return <div ref={mapRef} className={`w-full h-44 bg-slate-100 dark:bg-slate-900 rounded-t-xl overflow-hidden ${isTerminalState ? 'grayscale opacity-60' : ''}`} />;
};

export default function Send_Report() {
  useDocumentTitle('Send Reports – AlertU');

  const [activeTab, setActiveTab] = useState('approved'); 
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid'); 
  const [currentPage, setCurrentPage] = useState(1);

  // Modals state
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false); 
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [dispatchTarget, setDispatchTarget] = useState(''); 

  // Archive Alert Dialog state
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false);
  const [reportToArchive, setReportToArchive] = useState(null);
  const [isArchiving, setIsArchiving] = useState(false);

  // Resolve Alert Dialog state
  const [isResolveDialogOpen, setIsResolveDialogOpen] = useState(false);
  const [reportToResolve, setReportToResolve] = useState(null);
  const [isResolving, setIsResolving] = useState(false);

  // Initialize Audit Logging Hook
  const { logMovement } = useAuditLog();

  useEffect(() => {
    if (activeTab === 'approved') {
      fetchReports();
    }
  }, [activeTab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const json = await fetchFromBackend('/reports?view=approved');
      if (json.success) {
        setReports(json.data || []);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredReports = useMemo(() => {
    if (!searchTerm.trim()) return reports;
    const term = searchTerm.toLowerCase();
    return reports.filter(r => {
      const displayId = getDisplayId(r).toLowerCase();
      return (
        (r.reportTitle || '').toLowerCase().includes(term) ||
        (r.incidentType || '').toLowerCase().includes(term) ||
        (r.location?.address || '').toLowerCase().includes(term) ||
        displayId.includes(term) ||
        (r.id || '').toLowerCase().includes(term)
      );
    });
  }, [reports, searchTerm]);

  const totalPages = Math.ceil(filteredReports.length / ITEMS_PER_PAGE) || 1;
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredReports.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredReports, currentPage]);

  const handleOpenPreview = (report) => {
    const media = resolveMediaAsset(report);
    const resolvedReport = {
      ...report,
      mediaUrl: media.url || report.mediaUrl || null,
      mediaType: media.type || report.mediaType || null,
      isVideo: media.isVideo,
      selectedAgencies: report.selectedAgencies || report.assignedAgencies || []
    };
    setSelectedReport(resolvedReport);
    setIsPreviewModalOpen(true);
  };

  const handleOpenSelectionModal = (report) => {
    setSelectedReport(report);
    setIsSelectionModalOpen(true);
  };

  const handleTargetSelection = (target) => {
    setDispatchTarget(target);
    setIsSelectionModalOpen(false); 
    setIsLinkModalOpen(true);       
  };

  // Open Resolve Alert Dialog
  const triggerResolveModal = (report) => {
    setReportToResolve(report);
    setIsResolveDialogOpen(true);
  };

  const handleConfirmResolve = async () => {
    if (!reportToResolve) return;
    
    setIsResolving(true);
    const actualCollection = reportToResolve.source === 'admin' ? 'AdminReports' : 'approved_reports';
    
    const displayId = getDisplayId(reportToResolve);

    try {
      const json = await fetchFromBackend(`/resolve/${reportToResolve.id}`, {
        method: 'POST',
        body: JSON.stringify({ sourceCollection: actualCollection }),
      });
      if (json.success) {
        await logMovement('REPORT_RESOLVED', displayId, {
          reportId: reportToResolve.id,
          reportTitle: reportToResolve.reportTitle || reportToResolve.title || 'N/A',
          incidentType: reportToResolve.incidentType || reportToResolve.type || 'N/A',
          sourceCollection: actualCollection,
          resolvedAt: new Date().toISOString()
        });

        setReports(prev => prev.filter(r => r.id !== reportToResolve.id));
      } else {
        console.error("Resolve error:", json.message);
      }
    } catch (err) {
      console.error("Resolve error:", err);
    } finally {
      setIsResolving(false);
      setIsResolveDialogOpen(false);
      setReportToResolve(null);
    }
  };

  // Open Archive Alert Dialog
  const triggerArchiveModal = (report) => {
    setReportToArchive(report);
    setIsArchiveDialogOpen(true);
  };

  const handleConfirmArchive = async () => {
    if (!reportToArchive) return;
    
    setIsArchiving(true);
    const actualCollection = reportToArchive.source === 'admin' ? 'AdminReports' : 'approved_reports';
    
    const displayId = getDisplayId(reportToArchive);
  
    try {
      const json = await fetchFromBackend(`/archive-approved/${reportToArchive.id}`, {
        method: 'POST',
        body: JSON.stringify({ sourceCollection: actualCollection }),
      });
      if (json.success) {
        await logMovement('REPORT_ARCHIVED', displayId, {
          reportId: reportToArchive.id,
          reportTitle: reportToArchive.reportTitle || reportToArchive.title || 'N/A',
          incidentType: reportToArchive.incidentType || reportToArchive.type || 'N/A',
          sourceCollection: actualCollection,
          archivedAt: new Date().toISOString()
        });

        setReports(prev => prev.filter(r => r.id !== reportToArchive.id));
      } else {
        console.error("Archive error:", json.message);
      }
    } catch (err) {
      console.error("Archive error:", err);
    } finally {
      setIsArchiving(false);
      setIsArchiveDialogOpen(false);
      setReportToArchive(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 sm:p-6 lg:p-8 xl:p-10 font-sans transition-all">
      <div className="w-full max-w-[1920px] mx-auto space-y-6">
        
        {/* Responsive Header Section */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
              <Send className="h-7 w-7 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>Send Reports</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              {activeTab === 'approved' && 'View verified incident reports and share updates.'}
              {activeTab === 'resolved' && 'View reports that have been completed and resolved.'}
              {activeTab === 'archived' && 'View older archived incident records.'}
            </p>
          </div>

          {/* Tab Selection Navigation */}
          <div className="flex items-center gap-1.5 bg-slate-200/80 dark:bg-slate-900 p-1.5 rounded-xl border border-slate-300/50 dark:border-slate-800 self-start lg:self-auto shadow-inner flex-wrap sm:flex-nowrap">
            <button
              onClick={() => setActiveTab('approved')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === 'approved'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Send className="h-4 w-4" />
              <span>Approved {activeTab === 'approved' ? `(${reports.length})` : ''}</span>
            </button>
            <button
              onClick={() => setActiveTab('resolved')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === 'resolved'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-emerald-600'
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Resolved</span>
            </button>
            <button
              onClick={() => setActiveTab('archived')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === 'archived'
                  ? 'bg-red-800 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-red-600'
              }`}
            >
              <Inbox className="h-4 w-4" />
              <span>Archived</span>
            </button>
          </div>
        </div>

        {/* CONDITIONALLY RENDER TAB CONTENTS */}
        {activeTab === 'archived' ? (
          <Archived_Approved onRestoreSuccess={fetchReports} />
        ) : activeTab === 'resolved' ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <Resolved_Incidents onRestoreSuccess={fetchReports} />
          </div>
        ) : (
          <>
            {/* Search & Toolbar Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="relative w-full sm:w-80 md:w-96 lg:w-[26rem] max-w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search by VRID, title, type, or address..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>

              <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end shrink-0">
                <Button
                  variant="outline"
                  onClick={fetchReports}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </Button>

                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md transition-all ${
                      viewMode === 'grid'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                    }`}
                    title="Grid View"
                  >
                    <Grid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    className={`p-2 rounded-md transition-all ${
                      viewMode === 'table'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                    }`}
                    title="Table View"
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Content Section */}
            {loading ? (
              viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-6">
                  {[...Array(8)].map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <TableSkeleton />
              )
            ) : filteredReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 text-center px-4">
                <AlertTriangle className="h-10 w-10 text-amber-500 mb-3" />
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">No Reports Found</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1">
                  {searchTerm 
                    ? 'No reports matched your search keyword.' 
                    : 'There are currently no reports in the approved section.'}
                </p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentPage}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                >
                  {viewMode === 'grid' ? (
                    /* Dynamic Responsive Grid View */
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-6">
                      {paginatedReports.map((report) => {
                        const dt = formatDateTime(report.timestamp || report.createdAt || report.resolvedAt);
                        const displayId = getDisplayId(report);

                        return (
                          <div
                            key={report.id || displayId}
                            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden group min-w-0"
                          >
                            <ReportMapPreview report={report} isTerminalState={false} />

                            <div className="p-4 sm:p-5 flex-1 flex flex-col space-y-3 sm:space-y-4 min-w-0">
                              <div className="flex items-start justify-between gap-2 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  {/* Display VRID badge */}
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium font-['Roboto',sans-serif] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                                    <Hash className="h-2.5 w-2.5 text-slate-400" />
                                    {displayId}
                                  </span>
                                  
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-xs transition-colors shrink-0 max-w-[130px] ${getIncidentBadgeStyle(report.incidentType)}`}>
                                    <Tag className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                    <span className="truncate">{report.incidentType || 'General'}</span>
                                  </span>
                                </div>

                                <div className="flex flex-col items-end text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                                  <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                    <Calendar className="h-2.5 w-2.5 text-blue-500 shrink-0" />
                                    {dt.date}
                                  </span>
                                  {dt.time && (
                                    <span className="flex items-center gap-1 font-normal text-slate-400 dark:text-slate-500 whitespace-nowrap">
                                      <Clock className="h-2.5 w-2.5 shrink-0" />
                                      {dt.time}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="min-w-0">
                                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate" title={report.reportTitle || report.hazard || report.incidentType || 'Verified Report'}>
                                  {report.reportTitle || report.hazard || report.incidentType || 'Verified Report'}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1.5 mt-1.5 min-h-[32px] min-w-0" title={report.location?.address || 'Location unknown'}>
                                  <MapPin className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
                                  <span className="break-words line-clamp-2">{report.location?.address || 'Location unknown'}</span>
                                </p>
                              </div>

                              <div className="mt-auto pt-3.5 sm:pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2 w-full">
                                <div className="grid grid-cols-2 gap-2 w-full">
                                  <Button
                                    variant="outline"
                                    onClick={() => handleOpenPreview(report)}
                                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-2 py-2"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">View</span>
                                  </Button>

                                  <InteractiveHoverButton onClick={() => handleOpenSelectionModal(report)}>
                                    Share Updates
                                  </InteractiveHoverButton>
                                </div>

                                <div className="grid grid-cols-2 gap-2 w-full">
                                  <Button
                                    onClick={() => triggerResolveModal(report)}
                                    className="w-full inline-flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-sm px-2 py-2"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">Resolve</span>
                                  </Button>

                                  <Button
                                    onClick={() => triggerArchiveModal(report)}
                                    className="w-full inline-flex items-center justify-center gap-1.5 bg-red-800 hover:bg-red-900 text-white text-xs font-semibold shadow-sm px-2 py-2"
                                  >
                                    <Archive className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">Archive</span>
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Table View Layout */
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                      <div className="overflow-x-auto w-full">
                        <table className="w-full text-left border-collapse text-xs whitespace-nowrap lg:whitespace-normal">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider sticky top-0 z-10">
                              <th className="px-5 py-3.5 w-32">VRID</th>
                              <th className="px-5 py-3.5 w-32">Type</th>
                              <th className="px-5 py-3.5 min-w-[180px]">Report Title</th>
                              <th className="px-5 py-3.5 min-w-[220px]">Location</th>
                              <th className="px-5 py-3.5 w-36">Date & Time</th>
                              <th className="px-5 py-3.5 text-right min-w-[280px]">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {paginatedReports.map((report) => {
                              const dt = formatDateTime(report.timestamp || report.createdAt || report.resolvedAt);
                              const displayId = getDisplayId(report);

                              return (
                                <tr key={report.id || displayId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                  <td className="px-5 py-4 font-['Roboto',sans-serif] font-medium text-slate-700 dark:text-slate-300">
                                    {displayId}
                                  </td>
                                  <td className="px-5 py-4">
                                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-xs transition-colors ${getIncidentBadgeStyle(report.incidentType)}`}>
                                      <Tag className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                      <span>{report.incidentType || 'General'}</span>
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 font-bold text-slate-900 dark:text-white">
                                    {report.reportTitle || report.hazard || report.incidentType || 'Verified Report'}
                                  </td>
                                  <td className="px-5 py-4 text-slate-600 dark:text-slate-300 max-w-xs xl:max-w-md truncate">
                                    {formatAddress(report.location)}
                                  </td>
                                  <td className="px-5 py-4">
                                    <div className="flex flex-col text-[11px]">
                                      <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                                        <Calendar className="h-3 w-3 text-blue-500 shrink-0" />
                                        {dt.date}
                                      </span>
                                      {dt.time && (
                                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                                          <Clock className="h-3 w-3 shrink-0" />
                                          {dt.time}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-5 py-4 text-right">
                                    <div className="inline-flex items-center justify-end gap-2 flex-wrap xl:flex-nowrap">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleOpenPreview(report)}
                                        className="text-xs font-medium inline-flex items-center gap-1"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        <span>View</span>
                                      </Button>

                                      <InteractiveHoverButton onClick={() => handleOpenSelectionModal(report)}>
                                        Share Updates
                                      </InteractiveHoverButton>

                                      <Button
                                        size="sm"
                                        onClick={() => triggerResolveModal(report)}
                                        className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1 shadow-sm"
                                      >
                                        <CheckCircle2 className="h-3 w-3" />
                                        <span>Resolve</span>
                                      </Button>

                                      <Button
                                        size="sm"
                                        onClick={() => triggerArchiveModal(report)}
                                        className="bg-red-800 hover:bg-red-900 text-white text-xs font-medium inline-flex items-center gap-1 shadow-sm"
                                      >
                                        <Archive className="h-3 w-3" />
                                        <span>Archive</span>
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            )}

            {/* Responsive Pagination Section */}
            {!loading && filteredReports.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left">
                  Showing <span className="font-semibold text-slate-900 dark:text-slate-100">{((currentPage - 1) * ITEMS_PER_PAGE) + 1}</span> to{' '}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {Math.min(currentPage * ITEMS_PER_PAGE, filteredReports.length)}
                  </span> of{' '}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{filteredReports.length}</span> reports
                </p>

                <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                    title="Previous Page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <span className="px-3 text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    Page {currentPage} of {totalPages}
                  </span>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                    title="Next Page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

      </div>

      {/* Action Modals */}
      <CitizenOrDepartments
        isOpen={isSelectionModalOpen}
        onClose={() => setIsSelectionModalOpen(false)}
        onSelect={handleTargetSelection}
        report={selectedReport}
      />

      <LinkPreview 
        isOpen={isPreviewModalOpen} 
        onClose={() => setIsPreviewModalOpen(false)} 
        report={selectedReport} 
      />

      <GeneratedLink
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        report={selectedReport}
        target={dispatchTarget} 
      />

      {/* SHADCN RESOLVE CONFIRMATION ALERT DIALOG */}
      <AlertDialog open={isResolveDialogOpen} onOpenChange={setIsResolveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Mark Report as Resolved?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to resolve <strong>#{getDisplayId(reportToResolve)}</strong>? This report will be moved to the Resolved tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResolving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmResolve}
              disabled={isResolving}
              className="bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-700 dark:hover:bg-emerald-800"
            >
              {isResolving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resolving...
                </>
              ) : (
                'Mark as Resolved'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SHADCN ARCHIVE CONFIRMATION ALERT DIALOG */}
      <AlertDialog open={isArchiveDialogOpen} onOpenChange={setIsArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <Archive className="h-5 w-5 text-red-600" /> Archive Incident Report?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to move <strong>#{getDisplayId(reportToArchive)}</strong> to archives? You can access or restore archived reports anytime from the Archived tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmArchive}
              disabled={isArchiving}
              className="bg-red-800 text-white hover:bg-red-900 dark:bg-red-800 dark:hover:bg-red-900"
            >
              {isArchiving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Archiving...
                </>
              ) : (
                'Archive Report'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
