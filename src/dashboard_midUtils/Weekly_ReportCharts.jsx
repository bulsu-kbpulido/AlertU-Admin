import React, { useMemo, useState, useEffect } from 'react';
import { Bar } from 'react-chartjs-2';
import 'chart.js/auto';
import { 
  parseISO, 
  startOfWeek, 
  endOfWeek, 
  isWithinInterval, 
  getDay,
  format,
  isSameDay,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
  differenceInDays
} from 'date-fns';

// Firestore Database Connectivity Imports
import { db } from '../firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';

// Audit Log Custom Hook
import { useAuditLog } from '../useAuditLog';

// UI Icons & Components
import { 
  Calendar as CalendarIcon, 
  ChevronDown, 
  RefreshCw,
  Download, 
  FileSpreadsheet, 
  FileText, 
  Loader2,
  Wifi
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Calendar Picker Core Engine
import { DatePicker } from '@mantine/dates';
import '@mantine/dates/styles.css'; 

// Download Libraries
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';

// 🎯 Universal Timestamp Helper to catch all possible date fields across Active & Resolved collections
const getReportDate = (report) => {
  if (!report) return null;
  const rawTimestamp = 
    report.resolvedAt || 
    report.dateResolved ||
    report.timestamp || 
    report.verifiedAt || 
    report.reportTimestamp || 
    report.createdAt ||
    report.updatedAt ||
    report.time;
    
  if (!rawTimestamp) return null;

  try {
    let reportDate;
    if (typeof rawTimestamp.toDate === 'function') {
      reportDate = rawTimestamp.toDate();
    } else if (typeof rawTimestamp === 'object' && 'seconds' in rawTimestamp) {
      reportDate = new Date(rawTimestamp.seconds * 1000);
    } else if (typeof rawTimestamp === 'string') {
      reportDate = parseISO(rawTimestamp);
      if (isNaN(reportDate.getTime())) {
        reportDate = new Date(rawTimestamp);
      }
    } else {
      reportDate = new Date(rawTimestamp);
    }
    return isNaN(reportDate.getTime()) ? null : reportDate;
  } catch {
    return null;
  }
};

// 🎯 Date Filter Function
export const filterReportsByDate = (reports = [], dateValue, pickerType) => {
  if (!reports || !Array.isArray(reports)) return [];

  const now = new Date();
  const defaultStart = startOfDay(startOfWeek(now, { weekStartsOn: 0 }));
  const defaultEnd = endOfDay(endOfWeek(now, { weekStartsOn: 0 }));

  const isCustomFilterActive = 
    (pickerType === 'single' && dateValue) ||
    (pickerType === 'range' && dateValue?.[0]) ||
    (pickerType === 'multiple' && Array.isArray(dateValue) && dateValue.length > 0);

  return reports.filter(report => {
    const reportDate = getReportDate(report);
    if (!reportDate) return false;

    if (!isCustomFilterActive) {
      return isWithinInterval(reportDate, { start: defaultStart, end: defaultEnd });
    }

    if (pickerType === 'single' && dateValue) {
      return isSameDay(reportDate, dateValue);
    }

    if (pickerType === 'multiple' && Array.isArray(dateValue)) {
      return dateValue.some(d => d && isSameDay(reportDate, d));
    }

    if (pickerType === 'range' && dateValue[0]) {
      const start = startOfDay(dateValue[0]);
      const end = dateValue[1] ? endOfDay(dateValue[1]) : endOfDay(dateValue[0]);
      return isWithinInterval(reportDate, { start, end });
    }

    return false;
  });
};

// 🎯 Converts agency information into standard text strings supporting selectedAgencies migration
const parseAgencies = (report) => {
  if (!report) return 'None Assigned';

  const rawAgencies = 
    report.selectedAgencies || 
    report.assignedAgencies || 
    report.assignedAgency || 
    report.agency || 
    report.agencies;

  if (!rawAgencies) return 'None Assigned';

  if (Array.isArray(rawAgencies)) {
    if (rawAgencies.length === 0) return 'None Assigned';
    return rawAgencies
      .map(agency => {
        if (typeof agency === 'object' && agency !== null) {
          return agency.name || agency.label || agency.title || agency.id || '';
        }
        return String(agency || '');
      })
      .filter(Boolean)
      .join(', ') || 'None Assigned';
  }

  if (typeof rawAgencies === 'object' && rawAgencies !== null) {
    return rawAgencies.name || rawAgencies.label || rawAgencies.title || rawAgencies.id || 'None Assigned';
  }

  return String(rawAgencies).trim() || 'None Assigned';
};

// 🎯 Robust Date Formatter that checks all fields on the report
const formatDate = (report) => {
  if (!report) return 'N/A';
  
  const parsedDate = getReportDate(report);
  if (parsedDate) {
    return parsedDate.toLocaleString();
  }

  // Fallback string display if date parsing failed
  if (report.time) return String(report.time);
  if (report.date) return String(report.date);

  return 'N/A';
};

const getExportTimestamp = () => {
  return new Date().toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).replace(' at', '');
};

const isResolvedReport = (report) => {
  if (!report) return false;
  const statusStr = String(report.status || '').toLowerCase();
  return statusStr === 'resolved' || report.isResolved === true || Boolean(report.resolvedAt) || report.migrationSource === 'ResolvedReports';
};

export default function Weekly_ReportCharts({
  reports: propReports = null,
  pickerType: propPickerType,
  setPickerType: propSetPickerType,
  dateValue: propDateValue,
  setDateValue: propSetDateValue
}) {
  // --- Audit Log Hook ---
  const { logAdminAction } = useAuditLog();

  // --- Local Fallback Date Picker States ---
  const [localPickerType, setLocalPickerType] = useState('range');
  const [localDateValue, setLocalDateValue] = useState([null, null]);

  const pickerType = propPickerType !== undefined ? propPickerType : localPickerType;
  const setPickerType = propSetPickerType || setLocalPickerType;
  const dateValue = propDateValue !== undefined ? propDateValue : localDateValue;
  const setDateValue = propSetDateValue || setLocalDateValue;

  // --- Live Firestore States ---
  const [firestoreReports, setFirestoreReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // 🎯 REAL-TIME LISTENER: Always fetches approved_reports, ApprovedAdminReports, AND ResolvedReports
  useEffect(() => {
    setLoading(true);

    const activeQuery = query(collection(db, 'approved_reports'));
    const adminQuery = query(collection(db, 'ApprovedAdminReports'));
    const resolvedQuery = query(collection(db, 'ResolvedReports'));

    let activeData = [];
    let adminData = [];
    let resolvedData = [];

    const mergeAndSetReports = () => {
      const mergedMap = new Map();

      // Combine any parent-passed propReports with all three live Firestore collections
      if (Array.isArray(propReports)) {
        propReports.forEach(doc => {
          if (doc && doc.id) mergedMap.set(doc.id, doc);
        });
      }

      [...activeData, ...adminData, ...resolvedData].forEach(doc => {
        if (doc && doc.id) mergedMap.set(doc.id, doc);
      });

      setFirestoreReports(Array.from(mergedMap.values()));
      setLoading(false);
      setIsLive(true);
    };

    const unsubscribeActive = onSnapshot(
      activeQuery,
      (snapshot) => {
        activeData = snapshot.docs.map(doc => ({
          id: doc.id,
          source: 'approved',
          ...doc.data(),
          migrationSource: 'approved_reports'
        }));
        mergeAndSetReports();
      },
      (err) => {
        console.error("approved_reports stream error:", err);
        setIsLive(false);
      }
    );

    const unsubscribeAdmin = onSnapshot(
      adminQuery,
      (snapshot) => {
        adminData = snapshot.docs.map(doc => ({
          id: doc.id,
          source: 'admin',
          ...doc.data(),
          migrationSource: 'ApprovedAdminReports'
        }));
        mergeAndSetReports();
      },
      (err) => {
        console.error("ApprovedAdminReports stream error:", err);
        setIsLive(false);
      }
    );

    const unsubscribeResolved = onSnapshot(
      resolvedQuery,
      (snapshot) => {
        resolvedData = snapshot.docs.map(doc => ({
          id: doc.id,
          source: 'resolved',
          ...doc.data(),
          migrationSource: 'ResolvedReports',
          status: 'resolved'
        }));
        mergeAndSetReports();
      },
      (err) => {
        console.error("ResolvedReports stream error:", err);
        setIsLive(false);
      }
    );

    return () => {
      unsubscribeActive();
      unsubscribeAdmin();
      unsubscribeResolved();
    };
  }, [propReports]);

  const handleReset = () => {
    setDateValue(pickerType === 'range' ? [null, null] : pickerType === 'multiple' ? [] : null);
  };

  const filteredReports = useMemo(() => {
    return filterReportsByDate(firestoreReports, dateValue, pickerType);
  }, [firestoreReports, dateValue, pickerType]);

  // Generate chart data matrix grouping active and resolved items together
  const chartData = useMemo(() => {
    const categories = ['fire', 'flood', 'accident', 'others'];
    
    let labels = [];
    let matrix = [];

    if (pickerType === 'single' && dateValue) {
      labels = [format(dateValue, 'MMM dd')];
      matrix = [Array(categories.length).fill(0)];
    } 
    else if (pickerType === 'multiple' && Array.isArray(dateValue) && dateValue.length > 0) {
      const sortedDates = [...dateValue].filter(Boolean).sort((a, b) => a - b);
      labels = sortedDates.map(d => format(d, 'MMM dd'));
      matrix = Array(sortedDates.length).fill(0).map(() => Array(categories.length).fill(0));
    } 
    else if (pickerType === 'range' && dateValue[0] && dateValue[1]) {
      const start = startOfDay(dateValue[0]);
      const end = endOfDay(dateValue[1]);
      const totalDays = differenceInDays(end, start);

      if (totalDays <= 14) {
        const daysInInterval = eachDayOfInterval({ start, end });
        labels = daysInInterval.map(d => format(d, 'MMM dd'));
        matrix = Array(daysInInterval.length).fill(0).map(() => Array(categories.length).fill(0));
      } else {
        labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        matrix = Array(7).fill(0).map(() => Array(categories.length).fill(0));
      }
    } 
    else {
      labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      matrix = Array(7).fill(0).map(() => Array(categories.length).fill(0));
    }

    filteredReports.forEach(report => {
      const reportDate = getReportDate(report);
      if (!reportDate) return;

      let type = (
        report.incidentType || 
        report.type || 
        report.reportTitle || 
        report.hazardType || 
        report.hazard || 
        'others'
      ).toLowerCase();
      
      let catIndex = 3;
      if (type.includes('fire')) catIndex = 0;
      else if (type.includes('flood')) catIndex = 1;
      else if (type.includes('accident')) catIndex = 2;

      if (pickerType === 'single') {
        matrix[0][catIndex] += 1;
      } 
      else if (pickerType === 'multiple' && Array.isArray(dateValue)) {
        const sortedDates = [...dateValue].filter(Boolean).sort((a, b) => a - b);
        const matchIdx = sortedDates.findIndex(d => isSameDay(reportDate, d));
        if (matchIdx !== -1) matrix[matchIdx][catIndex] += 1;
      } 
      else if (pickerType === 'range' && dateValue[0] && dateValue[1]) {
        const start = startOfDay(dateValue[0]);
        const end = endOfDay(dateValue[1]);
        const totalDays = differenceInDays(end, start);

        if (totalDays <= 14) {
          const daysInInterval = eachDayOfInterval({ start, end });
          const dayIdx = daysInInterval.findIndex(d => isSameDay(reportDate, d));
          if (dayIdx !== -1) matrix[dayIdx][catIndex] += 1;
        } else {
          const dayIndex = getDay(reportDate);
          matrix[dayIndex][catIndex] += 1;
        }
      } 
      else {
        const dayIndex = getDay(reportDate);
        matrix[dayIndex][catIndex] += 1;
      }
    });

    return {
      labels,
      datasets: [
        { label: 'Fire', data: matrix.map(r => r[0]), backgroundColor: 'rgba(239, 68, 68, 0.85)', borderColor: 'rgb(239, 68, 68)', borderWidth: 1 },
        { label: 'Flood', data: matrix.map(r => r[1]), backgroundColor: 'rgba(59, 130, 246, 0.85)', borderColor: 'rgb(59, 130, 246)', borderWidth: 1 },
        { label: 'Accident', data: matrix.map(r => r[2]), backgroundColor: 'rgba(245, 158, 11, 0.85)', borderColor: 'rgb(245, 158, 11)', borderWidth: 1 },
        { label: 'Others', data: matrix.map(r => r[3]), backgroundColor: 'rgba(100, 116, 139, 0.85)', borderColor: 'rgb(100, 116, 139)', borderWidth: 1 },
      ],
    };
  }, [filteredReports, dateValue, pickerType]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11, family: "'Montserrat', sans-serif", weight: 'bold' }, color: '#64748b', padding: 20 } },
      tooltip: { mode: 'index', intersect: false, bodyFont: { family: "'Montserrat', sans-serif" }, titleFont: { family: "'Montserrat', sans-serif" } }
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11, family: "'Montserrat', sans-serif" }, color: '#64748b' } },
      y: { stacked: true, grid: { color: 'rgba(226, 232, 240, 0.6)' }, ticks: { font: { size: 11, family: "'Montserrat', sans-serif" }, color: '#64748b', precision: 0 } }
    }
  };

  const getDropdownLabel = () => {
    if (pickerType === 'single' && dateValue) return format(dateValue, 'PP');
    if (pickerType === 'multiple' && Array.isArray(dateValue) && dateValue.length > 0) return `${dateValue.length} dates selected`;
    if (pickerType === 'range' && dateValue[0]) {
      return `${format(dateValue[0], 'MMM d')} - ${dateValue[1] ? format(dateValue[1], 'MMM d') : 'Selecting...'}`;
    }
    return 'Filter Date';
  };

  // 📊 Excel Sheet Downloader
  const handleExportExcel = async () => {
    if (!filteredReports || filteredReports.length === 0) {
      toast.error("Export Failed", { description: "No data rows found matching current scope to download." });
      return;
    }

    try {
      const formattedTimestamp = getExportTimestamp();
      const activeReports = filteredReports.filter(r => !isResolvedReport(r));
      const resolvedReports = filteredReports.filter(r => isResolvedReport(r));

      let overallCounter = 1;

      const formatReportRow = (report) => {
        const vrid = report.vrid || `VRID${String(overallCounter++).padStart(7, '0')}`;
        const title = String(report.reportTitle || report.citizen || 'Untitled Alert');
        const type = String(report.incidentType || report.type || 'N/A').toUpperCase();
        const severity = String(report.verifiedSeverity || report.severity || 'Medium').toUpperCase();
        const hazard = String(report.hazardType || report.hazard || 'None Specified');
        
        let locationAddress = 'Coordinates Transmitted';
        if (typeof report.location === 'string') {
          locationAddress = report.location;
        } else if (report.location?.address) {
          locationAddress = report.location.address;
        } else if (report.location?.latitude || report.location?.longitude) {
          locationAddress = `${report.location.latitude}, ${report.location.longitude}`;
        }

        const agencies = parseAgencies(report);
        const dateStr = formatDate(report);

        return [vrid, title, type, severity, hazard, String(locationAddress), agencies, dateStr];
      };

      const tableHeaders = [
        'Report ID', 'Report Title', 'Incident Type', 'Severity Level', 'Hazard Type', 'Location Address', 'Agencies Involved', 'Timestamp'
      ];

      const excelRows = [];
      let activeHeaderRowIndex = -1;
      let resolvedHeaderRowIndex = -1;

      excelRows.push(["INCIDENT MANAGEMENT SYSTEM SUMMARY RECORDS LOGS", "", "", "", "", "", "", ""]);
      excelRows.push(["Combined Registry Sheet | Created On " + formattedTimestamp, "", "", "", "", "", "", ""]);
      excelRows.push(["", "", "", "", "", "", "", ""]);

      excelRows.push(["SECTION 1: ACTIVE & UNRESOLVED REPORTS", "", "", "", "", "", "", ""]);
      activeHeaderRowIndex = excelRows.length; 
      excelRows.push(tableHeaders);

      if (activeReports.length > 0) {
        activeReports.forEach(report => excelRows.push(formatReportRow(report)));
      } else {
        excelRows.push(["No Active Reports Found in Selected Timeframe", "", "", "", "", "", "", ""]);
      }

      excelRows.push(["", "", "", "", "", "", "", ""]);
      excelRows.push(["", "", "", "", "", "", "", ""]);
      
      excelRows.push(["SECTION 2: HISTORICAL RESOLVED REPORTS LOG", "", "", "", "", "", "", ""]);
      resolvedHeaderRowIndex = excelRows.length; 
      excelRows.push(tableHeaders);

      if (resolvedReports.length > 0) {
        resolvedReports.forEach(report => excelRows.push(formatReportRow(report)));
      } else {
        excelRows.push(["No Resolved Logs Found in Selected Timeframe", "", "", "", "", "", "", ""]);
      }

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(excelRows);
      const totalColumns = 8; 

      if (activeHeaderRowIndex !== -1) {
        for (let col = 0; col < totalColumns; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: activeHeaderRowIndex, c: col });
          if (worksheet[cellAddress]) {
            worksheet[cellAddress].s = {
              fill: { patternType: 'solid', fgColor: { rgb: "1D4ED8" } }, 
              font: { name: 'Arial', sz: 10, bold: true, color: { rgb: "FFFFFF" } }
            };
          }
        }
      }

      if (resolvedHeaderRowIndex !== -1) {
        for (let col = 0; col < totalColumns; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: resolvedHeaderRowIndex, c: col });
          if (worksheet[cellAddress]) {
            worksheet[cellAddress].s = {
              fill: { patternType: 'solid', fgColor: { rgb: "10B981" } }, 
              font: { name: 'Arial', sz: 10, bold: true, color: { rgb: "FFFFFF" } }
            };
          }
        }
      }

      worksheet['!cols'] = [
        { wch: 18 }, { wch: 32 }, { wch: 18 }, { wch: 15 }, { wch: 22 }, { wch: 50 }, { wch: 32 }, { wch: 24 } 
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, "Combined Logs Registry");
      XLSX.writeFile(workbook, `Incident_Summary_Export_${Date.now()}.xlsx`);

      // 📝 Log Audit Action for Excel Export
      await logAdminAction('EXPORT_FILTERED_REPORTS', 'EXPORT_XLSX', {
        format: 'XLSX',
        totalRows: filteredReports.length,
        activeCount: activeReports.length,
        resolvedCount: resolvedReports.length,
        filterType: pickerType,
        sourceComponent: 'Weekly_ReportCharts'
      });

      toast.success("Excel Sheet Created Successfully");
    } catch (error) {
      console.error(error);
      toast.error("Export Error", { description: "Failed to compile spreadsheet format columns." });
    }
  };

  // 📄 PDF Document Downloader
  const handleExportPDF = async () => {
    if (!filteredReports || filteredReports.length === 0) {
      toast.error("Export Failed", { description: "No data rows found matching current scope to download." });
      return;
    }

    setIsExporting(true);

    try {
      const doc = new jsPDF('l', 'mm', 'a4');
      const formattedTimestamp = getExportTimestamp();

      const activeReports = filteredReports.filter(r => !isResolvedReport(r));
      const resolvedReports = filteredReports.filter(r => isResolvedReport(r));

      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.text("INCIDENT MANAGEMENT SYSTEM SUMMARY RECORDS LOGS", 14, 15);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text(`Combined Registry Sheet | Created On ${formattedTimestamp}`, 14, 21);

      const tableHeaders = [
        ['Report ID', 'Report Title', 'Incident Type', 'Severity', 'Hazard Type', 'Location Address', 'Agencies Involved', 'Timestamp']
      ];

      let overallCounter = 1;

      const formatTableRows = (list) => list.map(report => [
        report.vrid || `VRID${String(overallCounter++).padStart(7, '0')}`,
        report.reportTitle || report.citizen || 'Untitled Alert',
        (report.incidentType || report.type || 'N/A').toUpperCase(),
        (report.verifiedSeverity || report.severity || 'Medium').toUpperCase(),
        report.hazardType || report.hazard || 'None Specified',
        typeof report.location === 'string' ? report.location : report.location?.address || 'Coordinates Transmitted',
        parseAgencies(report),
        formatDate(report)
      ]);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(29, 78, 216); 
      doc.text("Section 1: Active & Unresolved Reports", 14, 29);

      autoTable(doc, {
        startY: 32,
        head: tableHeaders,
        body: activeReports.length > 0 
          ? formatTableRows(activeReports) 
          : [['-', 'No Active Reports Found in Selected Timeframe', '-', '-', '-', '-', '-', '-']],
        theme: 'striped',
        headStyles: { fillColor: [29, 78, 216], fontSize: 9, fontStyle: 'bold' },
        styles: { fontSize: 8, overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: 22 }, 5: { cellWidth: 50 }, 6: { cellWidth: 35 } }
      });

      const nextY = (doc).lastAutoTable?.finalY ? (doc).lastAutoTable.finalY + 12 : 100;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(16, 185, 129); 
      doc.text("Section 2: Historical Resolved Reports Log", 14, nextY);

      autoTable(doc, {
        startY: nextY + 3,
        head: tableHeaders,
        body: resolvedReports.length > 0 
          ? formatTableRows(resolvedReports) 
          : [['-', 'No Resolved Logs Found in Selected Timeframe', '-', '-', '-', '-', '-', '-']],
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129], fontSize: 9, fontStyle: 'bold' },
        styles: { fontSize: 8, overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: 22 }, 5: { cellWidth: 50 }, 6: { cellWidth: 35 } }
      });

      doc.save(`Incident_Summary_Snapshot_${Date.now()}.pdf`);

      // 📝 Log Audit Action for PDF Export
      await logAdminAction('EXPORT_FILTERED_REPORTS', 'EXPORT_PDF', {
        format: 'PDF',
        totalRows: filteredReports.length,
        activeCount: activeReports.length,
        resolvedCount: resolvedReports.length,
        filterType: pickerType,
        sourceComponent: 'Weekly_ReportCharts'
      });

      toast.success("PDF Report Created Successfully");
    } catch (error) {
      console.error(error);
      toast.error("Export Error", { description: "PDF generation failed during compilation." });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200/80 p-4 sm:p-5 lg:p-6 shadow-sm dark:bg-slate-900 dark:border-slate-800 flex flex-col justify-between min-h-[480px] h-full">
      {/* Card Header: 2-Tier Stacked Layout for 100% Visibility with Zero Overlap */}
      <div className="flex flex-col gap-3 mb-4 z-20">
        
        {/* Row 1: Title Block */}
        <div className="flex flex-col gap-0.5 w-full">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 tracking-wide uppercase whitespace-nowrap">
              Weekly Report Charts
            </h3>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border shrink-0 ${
                isLive
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              <Wifi className={`h-2.5 w-2.5 ${isLive ? 'animate-pulse text-emerald-500' : 'text-slate-400'}`} />
              {isLive ? 'LIVE' : 'SYNC'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Combined active vs resolved metrics visualization.
          </p>
        </div>

        {/* Row 2: Toolbar Controls - Full Dedicated Row, Never Overlapping Title */}
        <div className="flex flex-wrap items-center gap-2 w-full">
          
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                size="sm" 
                disabled={isExporting || filteredReports.length === 0 || loading}
                className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm border-0 cursor-pointer rounded-lg px-2.5 sm:px-3"
              >
                {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                <span>Export</span>
              </Button>
            </PopoverTrigger>
            
            <PopoverContent align="end" className="w-56 p-2 flex flex-col gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-md z-[9999]">
              <Button
                onClick={() => {
                  toast.info("Downloading started", { description: "Compiling spreadsheet cells layout..." });
                  handleExportExcel();
                }}
                variant="ghost"
                className="w-full justify-start gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-600 dark:hover:text-emerald-400 font-medium text-xs h-9 cursor-pointer rounded-md"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
                Export as Excel
              </Button>

              <Button
                onClick={() => {
                  toast.info("Downloading started", { description: "Compiling document layout lines..." });
                  handleExportPDF();
                }}
                variant="ghost"
                className="w-full justify-start gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 dark:hover:text-rose-400 font-medium text-xs h-9 cursor-pointer rounded-md"
              >
                <FileText className="h-4 w-4 text-rose-600 dark:text-rose-500" />
                Export as PDF
              </Button>
            </PopoverContent>
          </Popover>

          <select 
            className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-slate-700 dark:text-slate-200 font-medium h-8 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
            value={pickerType}
            onChange={(e) => {
              const type = e.target.value;
              setPickerType(type);
              setDateValue(type === 'range' ? [null, null] : type === 'multiple' ? [] : null);
            }}
          >
            <option value="range">Range</option>
            <option value="multiple">Multiple Dates</option>
            <option value="single">Single Date</option>
          </select>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer px-2.5">
                <CalendarIcon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                <span className="truncate max-w-[95px] sm:max-w-[130px]">{getDropdownLabel()}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            
            <DropdownMenuContent 
              align="end" 
              sideOffset={5}
              className="p-3 bg-white dark:bg-slate-900 shadow-xl rounded-lg border border-slate-200 dark:border-slate-800 z-[9999] min-w-fit w-auto"
            >
              <div className="p-1 
                [&_[data-selected]]:!bg-blue-600 [&_[data-selected]]:!text-white
                [&_[data-in-range]]:!bg-blue-50 dark:[&_[data-in-range]]:!bg-blue-950/40
                [&_[data-in-range]]:!text-blue-600 dark:[&_[data-in-range]]:!text-blue-400"
              >
                <DatePicker 
                  type={pickerType} 
                  value={dateValue} 
                  onChange={(val) => {
                    if (pickerType === 'range') setDateValue(val || [null, null]);
                    else if (pickerType === 'multiple') setDateValue(val || []);
                    else setDateValue(val);
                  }} 
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center justify-center cursor-pointer shrink-0" 
            onClick={handleReset}
            title="Refresh Data"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Render chart area canvas */}
      <div className="relative w-full flex-1 min-h-[280px] z-10">
        {loading ? (
          <div className="w-full h-full flex items-center justify-center gap-2 text-slate-400 text-sm font-medium">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <span>Streaming Incidents...</span>
          </div>
        ) : (
          <Bar data={chartData} options={options} />
        )}
      </div>
    </div>
  );
}