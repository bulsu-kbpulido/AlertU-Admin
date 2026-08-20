import React, { useState, useMemo, useEffect } from 'react';
import { Doughnut } from 'react-chartjs-2';
import 'chart.js/auto';
import { 
  parseISO, 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval, 
  format
} from 'date-fns';

// Firestore Connectivity
import { db } from '../firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';

// Audit Log Custom Hook
import { useAuditLog } from '../useAuditLog';

// Icons & UI Foundations
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

// Mantine Dates Core Engine Components
import { MonthPicker } from '@mantine/dates';
import '@mantine/dates/styles.css'; 

// Export Libraries
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
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).replace(' at', '');
};

const isResolvedReport = (report) => {
  if (!report) return false;
  const statusStr = String(report.status || '').toLowerCase();
  return (
    statusStr === 'resolved' || 
    report.isResolved === true || 
    Boolean(report.resolvedAt) || 
    Boolean(report.dateResolved) ||
    report.migrationSource === 'ResolvedReports'
  );
};

export default function Monthly_ReportCharts({ reports: propReports = [] }) {
  // --- Audit Log Custom Hook ---
  const { logAdminAction } = useAuditLog();

  const [selectedMonth, setSelectedMonth] = useState(null);
  const [firestoreReports, setFirestoreReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // 🎯 Real-time Firestore Stream Subscriptions (Approved + Admin + Resolved)
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

      // Parent props merge
      if (Array.isArray(propReports)) {
        propReports.forEach(doc => {
          if (doc && doc.id) mergedMap.set(doc.id, doc);
        });
      }

      // Live streams merge
      [...activeData, ...adminData, ...resolvedData].forEach(doc => {
        if (doc && doc.id) mergedMap.set(doc.id, doc);
      });

      setFirestoreReports(Array.from(mergedMap.values()));
      setLoading(false);
      setIsLive(true);
    };

    const unsubscribeActive = onSnapshot(activeQuery, snapshot => {
      activeData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), migrationSource: 'approved_reports' }));
      mergeAndSetReports();
    }, () => setIsLive(false));

    const unsubscribeAdmin = onSnapshot(adminQuery, snapshot => {
      adminData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), migrationSource: 'ApprovedAdminReports' }));
      mergeAndSetReports();
    }, () => setIsLive(false));

    const unsubscribeResolved = onSnapshot(resolvedQuery, snapshot => {
      resolvedData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), migrationSource: 'ResolvedReports', status: 'resolved' }));
      mergeAndSetReports();
    }, () => setIsLive(false));

    return () => {
      unsubscribeActive();
      unsubscribeAdmin();
      unsubscribeResolved();
    };
  }, [propReports]);

  const handleReset = () => {
    setSelectedMonth(null);
  };

  // Filter combined reports by selected month
  const filteredReports = useMemo(() => {
    const targetMonth = selectedMonth || new Date();
    const start = startOfMonth(targetMonth);
    const end = endOfMonth(targetMonth);

    return firestoreReports.filter(report => {
      const reportDate = getReportDate(report);
      if (!reportDate) return false;
      return isWithinInterval(reportDate, { start, end });
    });
  }, [firestoreReports, selectedMonth]);

  // Aggregate Stats with Green Resolved Highlights
  const categoryCounts = useMemo(() => {
    let fire = 0;
    let flood = 0;
    let accident = 0;
    let others = 0;
    let resolved = 0;

    filteredReports.forEach(report => {
      if (isResolvedReport(report)) {
        resolved++;
      } else {
        const type = (report.incidentType || report.type || 'others').toLowerCase();
        if (type.includes('fire')) fire++;
        else if (type.includes('flood')) flood++;
        else if (type.includes('accident')) accident++;
        else others++;
      }
    });

    const total = fire + flood + accident + others + resolved;

    return { fire, flood, accident, others, resolved, total };
  }, [filteredReports]);

  const chartData = useMemo(() => {
    return {
      labels: ['Fire (Active)', 'Flood (Active)', 'Accident (Active)', 'Others (Active)', 'Resolved Incidents'],
      datasets: [
        {
          data: [
            categoryCounts.fire, 
            categoryCounts.flood, 
            categoryCounts.accident, 
            categoryCounts.others,
            categoryCounts.resolved
          ],
          backgroundColor: [
            'rgba(239, 68, 68, 0.85)',   // Fire Red
            'rgba(59, 130, 246, 0.85)',  // Flood Blue
            'rgba(245, 158, 11, 0.85)',  // Accident Amber
            'rgba(100, 116, 139, 0.85)', // Others Gray
            'rgba(16, 185, 129, 0.90)',  // 🟢 Resolved Emerald Green
          ],
          borderColor: [
            'rgb(239, 68, 68)',
            'rgb(59, 130, 246)',
            'rgb(245, 158, 11)',
            'rgb(100, 116, 139)',
            'rgb(16, 185, 129)',
          ],
          borderWidth: 1,
          cutout: '70%', 
        },
      ],
    };
  }, [categoryCounts]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          boxWidth: 12,
          font: { size: 10, family: "'Montserrat', sans-serif", weight: 'bold' },
          color: '#64748b',
          padding: 12,
        },
      },
      tooltip: {
        bodyFont: { family: "'Montserrat', sans-serif" },
        titleFont: { family: "'Montserrat', sans-serif" },
      },
    },
  };

  const getDropdownLabel = () => {
    if (selectedMonth) return format(selectedMonth, 'MMMM yyyy');
    return format(new Date(), 'MMMM yyyy');
  };

  const hasData = categoryCounts.total > 0;

  // 📊 Export Excel Functionality
  const handleExportExcel = async () => {
    if (filteredReports.length === 0) {
      toast.error("Export Failed", {
        description: "No incident records found for the selected month.",
      });
      return;
    }

    try {
      const formattedTimestamp = getExportTimestamp();
      const monthLabel = format(selectedMonth || new Date(), 'MMMM yyyy');

      const activeReports = filteredReports.filter(r => !isResolvedReport(r));
      const resolvedReports = filteredReports.filter(r => isResolvedReport(r));

      const formatReportRow = (report) => {
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

        return [title, type, severity, hazard, String(locationAddress), agencies, dateStr];
      };

      const tableHeaders = [
        'Report Title', 'Incident Type', 'Severity Level', 'Hazard Type', 'Location Address', 'Agencies Involved', 'Timestamp'
      ];

      const excelRows = [];
      let activeHeaderRowIndex = -1;
      let resolvedHeaderRowIndex = -1;

      excelRows.push([`MONTHLY INCIDENT RISK MANAGEMENT REGISTRY (${monthLabel.toUpperCase()})`, "", "", "", "", "", ""]);
      excelRows.push(["Compiled As of " + formattedTimestamp, "", "", "", "", "", ""]);
      excelRows.push(["", "", "", "", "", "", ""]);

      excelRows.push(["SECTION 1: ACTIVE & UNRESOLVED INCIDENTS", "", "", "", "", "", ""]);
      activeHeaderRowIndex = excelRows.length;
      excelRows.push(tableHeaders);

      if (activeReports.length > 0) {
        activeReports.forEach(report => excelRows.push(formatReportRow(report)));
      } else {
        excelRows.push(["No Active Incidents Recorded in Current Scope", "", "", "", "", "", ""]);
      }

      excelRows.push(["", "", "", "", "", "", ""]);
      excelRows.push(["", "", "", "", "", "", ""]);
      excelRows.push(["SECTION 2: RESOLVED INCIDENTS LOG", "", "", "", "", "", ""]);
      resolvedHeaderRowIndex = excelRows.length;
      excelRows.push(tableHeaders);

      if (resolvedReports.length > 0) {
        resolvedReports.forEach(report => excelRows.push(formatReportRow(report)));
      } else {
        excelRows.push(["No Resolved Incidents Recorded in Current Scope", "", "", "", "", "", ""]);
      }

      excelRows.push(["", "", "", "", "", "", ""]);
      excelRows.push(["", "", "", "", "", "", ""]);
      excelRows.push(["MONTHLY INCIDENTS SUMMARY BREAKDOWN", "", "", "", "", "", ""]);
      excelRows.push(["Incident Category", "Total Count", "", "", "", "", ""]);
      excelRows.push(["Fire Incidents (Active)", categoryCounts.fire, "", "", "", "", ""]);
      excelRows.push(["Flood Incidents (Active)", categoryCounts.flood, "", "", "", "", ""]);
      excelRows.push(["Accident Incidents (Active)", categoryCounts.accident, "", "", "", "", ""]);
      excelRows.push(["Other Incidents (Active)", categoryCounts.others, "", "", "", "", ""]);
      excelRows.push(["Resolved Incidents", categoryCounts.resolved, "", "", "", "", ""]);
      excelRows.push(["TOTAL MONTHLY REPORTS", categoryCounts.total, "", "", "", "", ""]);

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(excelRows);
      const totalColumns = 7;

      if (activeHeaderRowIndex !== -1) {
        for (let col = 0; col < totalColumns; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: activeHeaderRowIndex, c: col });
          if (worksheet[cellAddress]) {
            worksheet[cellAddress].s = {
              fill: { patternType: 'solid', fgColor: { rgb: "1D4ED8" } },
              font: { name: 'Arial', sz: 10, bold: true, color: { rgb: "FFFFFF" } },
              alignment: { vertical: 'center', horizontal: 'left' }
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
              font: { name: 'Arial', sz: 10, bold: true, color: { rgb: "FFFFFF" } },
              alignment: { vertical: 'center', horizontal: 'left' }
            };
          }
        }
      }

      worksheet['!cols'] = [
        { wch: 32 }, { wch: 18 }, { wch: 15 }, { wch: 22 }, 
        { wch: 50 }, { wch: 32 }, { wch: 24 } 
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, "Monthly Registry Logs");
      XLSX.writeFile(workbook, `Monthly_Incident_Report_${monthLabel.replace(/\s+/g, '_')}.xlsx`);

      // 📝 Log Audit Action for Monthly Excel Export
      await logAdminAction('EXPORT_FILTERED_REPORTS', 'EXPORT_XLSX', {
        format: 'XLSX',
        selectedMonth: monthLabel,
        totalRows: filteredReports.length,
        activeCount: activeReports.length,
        resolvedCount: resolvedReports.length,
        sourceComponent: 'Monthly_ReportCharts'
      });

      toast.success("Excel Sheet Generated Successfully");

    } catch (error) {
      console.error("Excel Generation Error:", error);
      toast.error("Export Error", { description: "Failed to generate spreadsheet." });
    }
  };

  // 📄 Export PDF Functionality
  const handleExportPDF = async () => {
    if (filteredReports.length === 0) {
      toast.error("Export Failed", {
        description: "No incident records found for the selected month.",
      });
      return;
    }

    setIsExporting(true);

    try {
      const doc = new jsPDF('l', 'mm', 'a4');
      const formattedTimestamp = getExportTimestamp();
      const monthLabel = format(selectedMonth || new Date(), 'MMMM yyyy');

      const activeReports = filteredReports.filter(r => !isResolvedReport(r));
      const resolvedReports = filteredReports.filter(r => isResolvedReport(r));

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`MONTHLY INCIDENT RISK MANAGEMENT REGISTRY (${monthLabel.toUpperCase()})`, 14, 15);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text(`Compiled As of ${formattedTimestamp}`, 14, 21);

      const tableHeaders = [
        ['Report Title', 'Incident Type', 'Severity', 'Hazard Type', 'Location Address', 'Agencies Involved', 'Timestamp']
      ];

      const formatTableRows = (list) => list.map(report => [
        report.reportTitle || report.citizen || 'Untitled Alert',
        (report.incidentType || 'N/A').toUpperCase(),
        (report.severity || 'Medium').toUpperCase(),
        report.hazard || 'None Specified',
        typeof report.location === 'string' ? report.location : report.location?.address || 'Coordinates Transmitted',
        parseAgencies(report),
        formatDate(report)
      ]);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(29, 78, 216);
      doc.text("Active & Unresolved Incidents", 14, 29);

      autoTable(doc, {
        startY: 32,
        head: tableHeaders,
        body: activeReports.length > 0 
          ? formatTableRows(activeReports) 
          : [['No Active Incidents Recorded', '-', '-', '-', '-', '-', '-']],
        theme: 'striped',
        headStyles: { fillColor: [29, 78, 216], fontSize: 9, fontStyle: 'bold' },
        styles: { fontSize: 8, overflow: 'linebreak' },
        columnStyles: { 4: { cellWidth: 55 }, 5: { cellWidth: 40 } }
      });

      let nextY = (doc).lastAutoTable?.finalY ? (doc).lastAutoTable.finalY + 12 : 100;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(16, 185, 129);
      doc.text("Resolved Incidents Log", 14, nextY);

      autoTable(doc, {
        startY: nextY + 3,
        head: tableHeaders,
        body: resolvedReports.length > 0 
          ? formatTableRows(resolvedReports) 
          : [['No Resolved Incidents Recorded', '-', '-', '-', '-', '-', '-']],
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129], fontSize: 9, fontStyle: 'bold' },
        styles: { fontSize: 8, overflow: 'linebreak' },
        columnStyles: { 4: { cellWidth: 55 }, 5: { cellWidth: 40 } }
      });

      nextY = (doc).lastAutoTable?.finalY ? (doc).lastAutoTable.finalY + 12 : 160;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text("Monthly Summary Breakdown", 14, nextY);

      autoTable(doc, {
        startY: nextY + 3,
        head: [['Incident Category', 'Total Count']],
        body: [
          ['Fire Incidents (Active)', String(categoryCounts.fire)],
          ['Flood Incidents (Active)', String(categoryCounts.flood)],
          ['Accident Incidents (Active)', String(categoryCounts.accident)],
          ['Other Incidents (Active)', String(categoryCounts.others)],
          ['Resolved Incidents', String(categoryCounts.resolved)],
          ['TOTAL MONTHLY REPORTS', String(categoryCounts.total)],
        ],
        theme: 'grid',
        headStyles: { fillColor: [71, 85, 105], fontSize: 9, fontStyle: 'bold' },
        styles: { fontSize: 8 },
        columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 40 } }
      });

      doc.save(`Monthly_Incident_Report_${monthLabel.replace(/\s+/g, '_')}.pdf`);

      // 📝 Log Audit Action for Monthly PDF Export
      await logAdminAction('EXPORT_FILTERED_REPORTS', 'EXPORT_PDF', {
        format: 'PDF',
        selectedMonth: monthLabel,
        totalRows: filteredReports.length,
        activeCount: activeReports.length,
        resolvedCount: resolvedReports.length,
        sourceComponent: 'Monthly_ReportCharts'
      });

      toast.success("PDF Report Generated Successfully");
    } catch (error) {
      console.error(error);
      toast.error("Export Error", { description: "PDF generation failed." });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200/80 p-6 shadow-sm dark:bg-slate-900 dark:border-slate-800 flex flex-col justify-between h-[420px]">
      <div className="flex items-start justify-between mb-2 z-20">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 tracking-wide uppercase">
              Monthly Incidents
            </h3>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${
                isLive
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              <Wifi className={`h-2.5 w-2.5 ${isLive ? 'animate-pulse text-emerald-500' : 'text-slate-400'}`} />
              {isLive ? 'LIVE' : 'SYNC'}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Categorical & resolved distribution for the selected month
          </p>
        </div>

        <div className="flex items-center gap-2">
          
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                size="sm" 
                disabled={isExporting || filteredReports.length === 0 || loading}
                className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm border-0"
              >
                {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export
              </Button>
            </PopoverTrigger>
            
            <PopoverContent align="end" className="w-56 p-2 flex flex-col gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-md z-[9999]">
              <Button
                onClick={() => {
                  toast.info("Downloading started", { description: "Compiling spreadsheet dataset..." });
                  handleExportExcel();
                }}
                variant="ghost"
                className="w-full justify-start gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-600 dark:hover:text-emerald-400 font-medium text-xs h-9"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
                Export as Excel
              </Button>

              <Button
                onClick={() => {
                  toast.info("Downloading started", { description: "Compiling document layout..." });
                  handleExportPDF();
                }}
                variant="ghost"
                className="w-full justify-start gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 dark:hover:text-rose-400 font-medium text-xs h-9"
              >
                <FileText className="h-4 w-4 text-rose-600 dark:text-rose-500" />
                Export as PDF
              </Button>
            </PopoverContent>
          </Popover>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2 text-xs border-slate-200">
                <CalendarIcon className="h-3.5 w-3.5 text-slate-500" />
                <span className="truncate max-w-[120px]">{getDropdownLabel()}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            
            <DropdownMenuContent 
              align="end" 
              sideOffset={5}
              className="p-3 bg-white dark:bg-slate-900 shadow-xl rounded-lg border border-slate-200 dark:border-slate-800 z-[9999] min-w-fit w-auto overflow-visible"
            >
              <div className="p-1 [&_[data-selected]]:!bg-blue-600 [&_[data-selected]]:!text-white">
                <MonthPicker 
                  value={selectedMonth} 
                  onChange={(val) => setSelectedMonth(val)} 
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600" onClick={handleReset}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="relative w-full h-[260px] min-h-[260px] flex items-center justify-center my-auto z-10">
        {loading ? (
          <div className="w-full h-full flex items-center justify-center gap-2 text-slate-400 text-sm font-medium">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <span>Streaming Incidents...</span>
          </div>
        ) : hasData ? (
          <Doughnut data={chartData} options={options} />
        ) : (
          <div className="text-xs text-slate-400 flex flex-col items-center gap-1">
            <span className="font-medium">No records found</span>
            <span>Try selecting another month</span>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 dark:border-slate-800 pt-3 flex justify-between items-center text-xs text-slate-500 font-medium z-10">
        <span>
          Active: <strong className="text-slate-700 dark:text-slate-300">{categoryCounts.total - categoryCounts.resolved}</strong>
        </span>
        <span className="text-emerald-600 font-bold">
          Resolved: {categoryCounts.resolved}
        </span>
        <span>
          Total: <strong className="text-slate-700 dark:text-slate-300">{categoryCounts.total}</strong>
        </span>
      </div>
    </div>
  );
}