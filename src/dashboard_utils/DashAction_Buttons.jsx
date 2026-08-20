import React, { useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { RefreshCw, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

// 🛡️ Import Audit Logging Hook
import { useAuditLog } from '../useAuditLog'; // Adjust path if needed

export default function DashAction_Buttons({ onRefresh, isLoading, reports = [] }) {
  const [isExporting, setIsExporting] = useState(false);
  
  // 🛡️ Initialize Audit Logger
  const { logExportFilteredReports } = useAuditLog();

  const handleRefresh = () => {
    if (typeof onRefresh === 'function') {
      onRefresh();
    }
  };

  const parseAgencies = (agenciesList) => {
    if (!Array.isArray(agenciesList) || agenciesList.length === 0) return 'None Assigned';
    return agenciesList
      .map(agency => typeof agency === 'object' ? (agency?.name || agency?.id || '') : agency)
      .filter(Boolean)
      .join(', ');
  };

  const formatDate = (timestamp, fallbackField) => {
    if (!timestamp && !fallbackField) return 'N/A';
    try {
      if (timestamp && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toLocaleString();
      }
      if (timestamp && typeof timestamp === 'object' && ('seconds' in timestamp || '_seconds' in timestamp)) {
        const secs = timestamp.seconds ?? timestamp._seconds;
        return new Date(secs * 1000).toLocaleString();
      }
      const targetDate = timestamp || fallbackField;
      const parsedDate = new Date(targetDate);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toLocaleString();
      }
    } catch (e) {
      console.error("Error formatting date field:", e);
    }
    return String(timestamp || fallbackField || 'N/A');
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

  // 📊 Excel Sheet Data Matrix Compiler
  const handleExportExcel = async () => {
    if (!reports || reports.length === 0) {
      toast.error("Export Failed", {
        description: "No data found to save.",
      });
      return;
    }

    try {
      const formattedTimestamp = getExportTimestamp();

      const excelRows = [
        ["INCIDENT RISK MANAGEMENT REGISTRY LOGS", "", "", "", "", "", "", ""],
        ["Active Reports Feed | Compiled As of " + formattedTimestamp, "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""], 
        [
          'Report Title', 
          'Verified ID',
          'Incident Type', 
          'Severity Level', 
          'Hazard Type', 
          'Location Address', 
          'Agencies Involved', 
          'Timestamp'
        ]
      ];

      reports.forEach((report) => {
        if (!report) return;

        const title = String(report.reportTitle || report.citizen || 'Untitled Alert');
        const verifiedId = String(report.verifiedReportId || report.verifiedreportID || 'PENDING');
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
        locationAddress = String(locationAddress);

        const agencies = String(parseAgencies(report.selectedAgencies || report.agency || report.assignedAgency));
        const dateStr = String(formatDate(report.timestamp, report.createdAt || report.time));

        excelRows.push([title, verifiedId, type, severity, hazard, locationAddress, agencies, dateStr]);
      });

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(excelRows);

      // 🎨 Apply Style to the Header Row
      const headerRowIndex = 3; 
      const totalColumns = 8; // Columns A through H

      for (let col = 0; col < totalColumns; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
        
        if (worksheet[cellAddress]) {
          worksheet[cellAddress].s = {
            fill: {
              patternType: 'solid',
              fgColor: { rgb: "1D4ED8" }
            },
            font: {
              name: 'Arial',
              sz: 10,
              bold: true,
              color: { rgb: "FFFFFF" }
            },
            alignment: {
              vertical: 'center',
              horizontal: 'left'
            }
          };
        }
      }

      worksheet['!cols'] = [
        { wch: 32 }, // Report Title
        { wch: 16 }, // Verified ID
        { wch: 18 }, // Incident Type
        { wch: 15 }, // Severity Level
        { wch: 22 }, // Hazard Type
        { wch: 50 }, // Location Address
        { wch: 32 }, // Agencies Involved
        { wch: 24 }  // Timestamp
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, "Registry Logs");
      XLSX.writeFile(workbook, `Incident_Export_Logs_${Date.now()}.xlsx`);
      toast.success("Excel file saved successfully");

      // 🛡️ Dispatch Audit Log Action
      await logExportFilteredReports('XLSX', reports.length, {
        sourceComponent: 'DashAction_Buttons.jsx',
        section: 'Control Panel Overview'
      });

    } catch (error) {
      console.error("Excel Generation Error Exception Handle:", error);
      toast.error("Export Error", { description: "Could not create the Excel file." });
    }
  };

  const handleExportPDF = async () => {
    if (!reports || reports.length === 0) {
      toast.error("Export Failed", {
        description: "No data found to save.",
      });
      return;
    }

    setIsExporting(true);

    try {
      const doc = new jsPDF('l', 'mm', 'a4');
      const formattedTimestamp = getExportTimestamp();

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text("INCIDENT RISK MANAGEMENT REGISTRY LOGS", 14, 15);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text(`Active Reports Feed | Compiled As of ${formattedTimestamp}`, 14, 21);

      const tableHeaders = [
        ['Report Title', 'Verified ID', 'Incident Type', 'Severity', 'Hazard Type', 'Location Address', 'Agencies Involved', 'Timestamp']
      ];

      const tableRows = reports.map(report => [
        report.reportTitle || report.citizen || 'Untitled Alert',
        report.verifiedReportId || report.verifiedreportID || 'PENDING',
        (report.incidentType || 'N/A').toUpperCase(),
        (report.severity || 'Medium').toUpperCase(),
        report.hazard || 'None Specified',
        typeof report.location === 'string' ? report.location : report.location?.address || 'Coordinates Transmitted',
        parseAgencies(report.selectedAgencies || report.agency || report.assignedAgency),
        formatDate(report.timestamp, report.createdAt || report.time)
      ]);

      autoTable(doc, {
        startY: 26,
        head: tableHeaders,
        body: tableRows,
        theme: 'striped',
        headStyles: { fillColor: [29, 78, 216], fontSize: 9, fontStyle: 'bold' },
        styles: { fontSize: 8, overflow: 'linebreak' },
        columnStyles: {
          1: { cellWidth: 22 }, // Verified ID
          5: { cellWidth: 48 }, // Location Address
          6: { cellWidth: 35 }  // Agencies Involved
        }
      });

      doc.save(`Active_Reports__Logs_${Date.now()}.pdf`);
      toast.success("PDF file saved successfully");

      // 🛡️ Dispatch Audit Log Action
      await logExportFilteredReports('PDF', reports.length, {
        sourceComponent: 'DashAction_Buttons.jsx',
        section: 'Control Panel Overview'
      });

    } catch (error) {
      console.error(error);
      toast.error("Export Error", { description: "Could not create the PDF file." });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800/60 p-4 flex flex-col justify-between h-full transition-colors duration-200">
      <div className="min-w-0 flex flex-col justify-center">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Control Panel
        </p>
        <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-200 tracking-tight mt-1 mb-2.5 leading-tight">
          Actions
        </h3>
      </div>

      <div className="flex flex-col gap-2 w-full mt-auto">
        <Button
          onClick={handleRefresh}
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? 'Loading...' : 'Refresh Data'}
        </Button>

        <Popover>
          <PopoverTrigger 
            disabled={isLoading || isExporting}
            className="w-full font-semibold border border-slate-200 dark:border-slate-800 flex items-center justify-center gap-2 text-slate-700 dark:text-slate-300 h-10 px-4 py-2 text-sm rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            <Download className="h-4 w-4" />
            {isExporting ? 'Saving...' : 'Export Logs'}
          </PopoverTrigger>
          
          <PopoverContent className="w-64 p-2 flex flex-col gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-md">
            <Button
              onClick={() => {
                toast.info("Downloading started", {
                  description: "Creating Excel file...",
                  icon: <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />,
                });
                handleExportExcel();
              }}
              className="w-full justify-start gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs h-9 shadow-sm"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Save as Excel
            </Button>

            <Button
              onClick={() => {
                toast.info("Downloading started", {
                  description: "Creating PDF file...",
                  icon: <Loader2 className="h-4 w-4 animate-spin text-rose-500" />,
                });
                handleExportPDF();
              }}
              className="w-full justify-start gap-2 bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs h-9 shadow-sm"
            >
              <FileText className="h-4 w-4" />
              Save as PDF
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}