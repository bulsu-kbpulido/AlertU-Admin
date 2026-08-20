import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from 'react-router-dom';

// Sub-components
import Dashboard_Wrapper from './Dashboard_Wrapper';
import MetricsGrid from '../dashboard_utils/MetricsGrid';
import DashboardMap from '../dashboard_utils/DashboardMap';
import Dashboard_Searchbar from '../dashboard_utils/Dashboard_Searchbar';
import ReportDetailsPanel from '../dashboard_utils/ReportDetailsPanel';
import Dashboard_MidSection from './Dashboard_MidSection';
import Dashboard_BottomSection from './Dashboard_BottomSection';
import Dashboard_LastSection from './Dashboard_LastSection';
import View_Modal from '../dashboard_utils/View_Modal';

// Live Render backend URL base
const SOCKET_SERVER_URL = 'https://alertu-server.onrender.com';
const API_BASE_URL = `${SOCKET_SERVER_URL}/api`;

const DASHBOARD_SECTION_MAP = {
  'dashboard': 0,
  'dashboard-mid': 1,
  'dashboard-bottom': 2,
  'dashboard-last': 3
};

export default function Dashboard() {
  const [allReports, setAllReports] = useState([]);
  const [resolvedReports, setResolvedReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState(null);
  const [mapTargetCoords, setMapTargetCoords] = useState(null);
  const [activeTab, setActiveTab] = useState('active');

  const [searchTerminalQuery, setSearchTerminalQuery] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterIncidentType, setFilterIncidentType] = useState('all');
  const [filterHazardType, setFilterHazardType] = useState('all');
  const [filterAgency, setFilterAgency] = useState([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReport, setModalReport] = useState(null);

  const wrapperRef = useRef(null);
  const location = useLocation();

  // Capture current path and scroll to target section
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/admin/')) {
      const pageId = path.replace('/admin/', '');
      const sectionIndex = DASHBOARD_SECTION_MAP[pageId];
      
      if (sectionIndex !== undefined && wrapperRef.current) {
        if (typeof wrapperRef.current.scrollToSection === 'function') {
          wrapperRef.current.scrollToSection(sectionIndex);
        }
      }
    }
  }, [location.pathname, loading]);

  // Fetch all reports & resolved reports from live Render server
  const fetchDashboardData = async () => {
    try {
      const [approvedRes, adminRes, resolvedRes] = await Promise.all([
        fetch(`${API_BASE_URL}/approved-reports`),
        fetch(`${API_BASE_URL}/approved-admin-reports`),
        fetch(`${API_BASE_URL}/reports?view=resolved`)
      ]);

      const approvedJson = await approvedRes.json();
      const adminJson = await adminRes.json();
      const resolvedJson = await resolvedRes.json();

      const approvedList = (approvedJson.data || []).map(doc => ({
        ...doc,
        source: 'approved'
      }));

      const adminList = (adminJson.data || [])
        .filter(doc => doc.isAuthenticated !== false)
        .map(doc => ({
          ...doc,
          source: 'admin',
          selectedMarkerIcon: doc.selectedMarkerIcon || 'warnicon.png',
          severity: doc.verifiedSeverity || doc.severity || 'medium',
          radius: doc.radius || null,
          polyline: doc.polyline || [],
          routeCoords: doc.routeCoords || []
        }));

      const resolvedList = (resolvedJson.data || []).map(doc => ({
        ...doc,
        source: 'resolved',
        _isResolvedFeedItem: true
      }));

      setAllReports([...approvedList, ...adminList]);
      setResolvedReports(resolvedList);
    } catch (err) {
      console.error("Failed to fetch dashboard reports from Render API:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch and polling setup
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);

    // Socket.IO setup targeting Render server
    const socket = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });

    const handleDataChange = () => {
      fetchDashboardData();
    };

    socket.on('report_created', handleDataChange);
    socket.on('report_updated', handleDataChange);
    socket.on('report_approved', handleDataChange);
    socket.on('report_resolved', handleDataChange);
    socket.on('report_archived', handleDataChange);
    socket.on('report_deleted', handleDataChange);

    return () => {
      clearInterval(interval);
      socket.off('report_created', handleDataChange);
      socket.off('report_updated', handleDataChange);
      socket.off('report_approved', handleDataChange);
      socket.off('report_resolved', handleDataChange);
      socket.off('report_archived', handleDataChange);
      socket.off('report_deleted', handleDataChange);
      socket.disconnect();
    };
  }, []);

  const processedReports = useMemo(() => {
    if (!searchTerminalQuery && filterSeverity === 'all' && filterIncidentType === 'all' && filterHazardType === 'all' && (!filterAgency || filterAgency.length === 0)) {
      return allReports;
    }

    const term = searchTerminalQuery.trim().toLowerCase();

    return allReports.filter((report) => {
      if (!report) return false;

      const rawAddress = typeof report.location === 'string' 
        ? report.location 
        : report.location?.address || report.address || '';
      
      const barangay = report.barangay || report.brgy || report.location?.barangay || '';
      const municipality = report.municipality || report.city || report.location?.city || '';

      const fullLocationString = `${rawAddress} ${barangay} ${municipality}`.toLowerCase();

      const reportSeverity = (report.verifiedSeverity || report.severity || 'medium').toLowerCase();
      const reportType = (report.incidentType || report.reportTitle || report.type || '').toLowerCase();
      const reportHazard = (report.hazardType || report.hazard || '').toLowerCase();

      const rawReportAgencies = report.selectedAgencies || report.assignedAgencies || [];
      const reportAgenciesArray = Array.isArray(rawReportAgencies) ? rawReportAgencies : [rawReportAgencies];

      const reportAgencies = reportAgenciesArray.map(item => {
        if (item && typeof item === 'object') {
          return String(item.id || item.name || '').toLowerCase().trim();
        }
        return String(item || '').toLowerCase().trim();
      });

      const matchesSearch = !term || 
        fullLocationString.includes(term) ||
        reportType.includes(term) ||
        (report.description && String(report.description).toLowerCase().includes(term));

      const matchesSeverity = filterSeverity === 'all' || reportSeverity === filterSeverity.toLowerCase();
      const matchesIncidentType = filterIncidentType === 'all' || reportType === filterIncidentType.toLowerCase();
      const matchesHazard = filterHazardType === 'all' || reportHazard === filterHazardType.toLowerCase();
      
      const matchesAgency = 
        !Array.isArray(filterAgency) || 
        filterAgency.length === 0 || 
        filterAgency.some(requiredId => {
          const normalizedRequired = String(requiredId).toLowerCase().trim();
          
          return reportAgencies.some(normalizedAgency => {
            return normalizedAgency === normalizedRequired || 
                   normalizedAgency.includes(normalizedRequired) ||
                   normalizedRequired.includes(normalizedAgency);
          });
        });

      return matchesSearch && matchesSeverity && matchesIncidentType && matchesHazard && matchesAgency;
    });
  }, [allReports, searchTerminalQuery, filterSeverity, filterIncidentType, filterHazardType, filterAgency]);

  // Metric recalculation across Active & Resolved streams
  const metrics = useMemo(() => {
    const active = processedReports.filter(r => r.status !== 'resolved' && r.status !== 'archived').length;
    const pending = processedReports.filter(r => r.status === 'pending' || !r.status).length;
    const resolved = resolvedReports.length + processedReports.filter(r => r.status === 'resolved').length;
    const archived = processedReports.filter(r => r.status === 'archived').length;

    return { active, pending, resolved, archived };
  }, [processedReports, resolvedReports]);

  const handleResetFilters = () => {
    setSearchTerminalQuery('');
    setFilterSeverity('all');
    setFilterIncidentType('all');
    setFilterHazardType('all');
    setFilterAgency([]);
    setMapTargetCoords(null);
  };

  const triggerRefresh = () => {
    setLoading(true);
    fetchDashboardData();
  };

  const openDossierModal = (report) => {
    setModalReport(report);
    setIsModalOpen(true);
  };

  const closeDossierModal = () => {
    setModalReport(null);
    setIsModalOpen(false);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full h-full p-4 box-border">
        <Skeleton className="h-[100px] w-full rounded-xl bg-slate-200 dark:bg-slate-800" />
        <Skeleton className="h-[100px] w-full rounded-xl bg-slate-200 dark:bg-slate-800" />
        <Skeleton className="h-[100px] w-full rounded-xl bg-slate-200 dark:bg-slate-800" />
        <Skeleton className="h-[100px] w-full rounded-xl bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="w-full h-[calc(100vh-theme(spacing.24))] relative overflow-hidden box-border p-0 m-0">
      <Dashboard_Wrapper ref={wrapperRef}>
        
        {/* OVERVIEW PANEL (0) */}
        <div className="w-full max-w-full h-full flex flex-col gap-4 md:gap-6 box-border animate-in fade-in duration-500 overflow-y-auto xl:overflow-hidden pb-4">
          <MetricsGrid 
            metrics={metrics} 
            onRefresh={triggerRefresh} 
            isLoading={loading}
            reports={processedReports} 
          />

          <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-12 items-stretch flex-1 min-h-0">
            <div className="xl:col-span-8 w-full h-[400px] xl:h-full">
              <DashboardMap 
                liveReports={processedReports} 
                selectedReport={selectedReport}
                setSelectedReport={setSelectedReport} 
                mapTargetCoords={mapTargetCoords} 
              />
            </div>

            <div className="xl:col-span-4 w-full h-full flex flex-col gap-4 md:gap-6 min-h-0 xl:overflow-y-auto">
              <Dashboard_Searchbar
                searchTerminalQuery={searchTerminalQuery}
                setSearchTerminalQuery={setSearchTerminalQuery}
                filterSeverity={filterSeverity}
                setFilterSeverity={setFilterSeverity}
                filterIncidentType={filterIncidentType}
                setFilterIncidentType={setFilterIncidentType}
                filterHazardType={filterHazardType}
                setFilterHazardType={setFilterHazardType}
                filterAgency={filterAgency}
                setFilterAgency={setFilterAgency}
                onLocationSelect={(coords) => setMapTargetCoords(coords)}
                onResetFilters={handleResetFilters}
              />
              
              <ReportDetailsPanel 
                reportsList={processedReports} 
                selectedReport={selectedReport} 
                setSelectedReport={setSelectedReport} 
                loading={loading}
                onViewClick={openDossierModal} 
              />
            </div>
          </div>
        </div>

        {/* MID STATISTICS PANEL (1) */}
        <div className="w-full max-w-full h-full box-border overflow-y-auto py-2">
          <Dashboard_MidSection 
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            metrics={metrics}
            filteredReports={processedReports}
            setSelectedReport={setSelectedReport}
          />
        </div>

        {/* BOTTOM BARANGAY PANEL (2) */}
        <div className="w-full max-w-full h-full box-border overflow-y-auto py-2">
          <Dashboard_BottomSection 
            reports={allReports} 
            resolvedReports={resolvedReports}
            filteredReports={processedReports} 
          />
        </div>

        {/* LAST CITIZEN & AGENCY PANEL (3) */}
        <div className="w-full max-w-full h-full pb-12 box-border overflow-y-auto py-2">
          <Dashboard_LastSection 
            reports={allReports}
            resolvedReports={resolvedReports}
            filteredReports={processedReports}
          />
        </div>

      </Dashboard_Wrapper>

      <View_Modal 
        isOpen={isModalOpen} 
        onClose={closeDossierModal} 
        report={modalReport} 
      />
    </div>
  );
}