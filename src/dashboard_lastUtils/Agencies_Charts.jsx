import React, { useMemo, useState, useEffect } from 'react';
import { Bar } from 'react-chartjs-2';
import 'chart.js/auto';
import { 
  parseISO, 
  isWithinInterval, 
  format,
  isSameDay,
  startOfDay,
  endOfDay
} from 'date-fns';

// Icons & UI Foundations
import { 
  Calendar as CalendarIcon, 
  ChevronDown, 
  RefreshCw 
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Firebase Firestore Imports
import { db } from '@/firebase'; 
import { collection, onSnapshot } from 'firebase/firestore';

// Mantine Dates Core Engine Components
import { DatePicker } from '@mantine/dates';
import '@mantine/dates/styles.css'; 

// 🏢 Shared Agencies Configuration Data
export const AGENCIES = [
  { id: "RHU", name: "Rural Health Unit", icon: "🏥", color: "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" },
  { id: "BFP", name: "Bureau of Fire Protection", icon: "🚒", color: "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400" },
  { id: "PNP", name: "Philippine National Police", icon: "👮", color: "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" },
  { id: "MDRRMO", name: "Municipal Disaster Risk Reduction and Management Office", icon: "🚑", color: "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400" },
  { id: "Barangay", name: "Barangay Officials", icon: "🏘️", color: "border-yellow-500 bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400" }
];

// Helper to safely parse report dates from Firestore Timestamps, strings, or JS Dates
const parseReportDate = (report) => {
  if (!report) return null;
  
  const raw = 
    report.resolvedAt || 
    report.timestamp || 
    report.verifiedAt || 
    report.reportTimestamp || 
    report.createdAt || 
    report.created_at || 
    report.date;

  if (!raw) return null;

  try {
    if (typeof raw?.toDate === 'function') return raw.toDate();
    if (raw?.seconds) return new Date(raw.seconds * 1000);
    if (typeof raw === 'string') return parseISO(raw);
    return new Date(raw);
  } catch {
    return null;
  }
};

// 🎯 Daily Date filter helper function
export const filterReportsByDate = (reports = [], dateValue, pickerType) => {
  if (!reports || !Array.isArray(reports)) return [];

  const now = new Date();
  const defaultStart = startOfDay(now);
  const defaultEnd = endOfDay(now);

  const isCustomFilterActive = 
    (pickerType === 'single' && dateValue) ||
    (pickerType === 'range' && dateValue?.[0]) ||
    (pickerType === 'multiple' && Array.isArray(dateValue) && dateValue.length > 0);

  return reports.filter(report => {
    if (!report) return false;

    const reportDate = parseReportDate(report);
    if (!reportDate || isNaN(reportDate.getTime())) return false;

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

export default function Agencies_Charts({ initialDateValue = null }) {
  // State for raw Firestore reports
  const [approvedReports, setApprovedReports] = useState([]);
  const [resolvedReports, setResolvedReports] = useState([]);

  // Date Picker States
  const [pickerType, setPickerType] = useState('range');
  const [dateValue, setDateValue] = useState(initialDateValue || [null, null]);

  // 1. REAL-TIME LISTENERS FOR BOTH COLLECTIONS
  useEffect(() => {
    const approvedRef = collection(db, 'approved_reports');
    const unsubscribeApproved = onSnapshot(
      approvedRef,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          _source: 'approved_reports',
          ...doc.data()
        }));
        setApprovedReports(data);
      },
      (error) => console.error("Error listening to approved_reports:", error)
    );

    const resolvedRef = collection(db, 'ResolvedReports');
    const unsubscribeResolved = onSnapshot(
      resolvedRef,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          _source: 'ResolvedReports',
          ...doc.data()
        }));
        setResolvedReports(data);
      },
      (error) => console.error("Error listening to ResolvedReports:", error)
    );

    return () => {
      unsubscribeApproved();
      unsubscribeResolved();
    };
  }, []);

  // Combine both collections for agency volume calculations
  const combinedReports = useMemo(() => {
    return [...approvedReports, ...resolvedReports];
  }, [approvedReports, resolvedReports]);

  // Reset Date Filters
  const handleReset = () => {
    setDateValue(pickerType === 'range' ? [null, null] : pickerType === 'multiple' ? [] : null);
  };

  // Filter combined reports by date
  const filteredReports = useMemo(() => {
    return filterReportsByDate(combinedReports, dateValue, pickerType);
  }, [combinedReports, dateValue, pickerType]);

  // Map total report counts per agency
  const chartData = useMemo(() => {
    const agencyCounts = {};
    
    // Initialize count for each agency
    AGENCIES.forEach(a => {
      agencyCounts[a.id] = 0;
    });

    filteredReports.forEach(report => {
      const rawAgencies = report.selectedAgencies || report.assignedAgencies || report.agency || report.assignedAgency;
      
      let agencyList = [];
      if (Array.isArray(rawAgencies)) {
        agencyList = rawAgencies.map(a => typeof a === 'object' ? (a?.id || a?.name || 'Unassigned') : a);
      } else if (typeof rawAgencies === 'string' && rawAgencies.trim() !== '') {
        agencyList = [rawAgencies];
      }

      agencyList.forEach(agencyKey => {
        const matchedAgency = AGENCIES.find(
          a => a.id.toLowerCase() === String(agencyKey).toLowerCase() || a.name.toLowerCase() === String(agencyKey).toLowerCase()
        );

        if (matchedAgency) {
          agencyCounts[matchedAgency.id] += 1;
        }
      });
    });

    const labels = AGENCIES.map(a => `${a.icon} ${a.id}`);
    const totals = AGENCIES.map(a => agencyCounts[a.id]);

    return {
      labels,
      datasets: [
        {
          label: 'Total Daily Incidents',
          data: totals,
          backgroundColor: [
            'rgba(16, 185, 129, 0.85)', // RHU - Emerald
            'rgba(239, 68, 68, 0.85)',   // BFP - Red
            'rgba(59, 130, 246, 0.85)',  // PNP - Blue
            'rgba(249, 115, 22, 0.85)',  // MDRRMO - Orange
            'rgba(234, 179, 8, 0.85)'    // Barangay - Yellow
          ],
          borderColor: [
            'rgb(16, 185, 129)',
            'rgb(239, 68, 68)',
            'rgb(59, 130, 246)',
            'rgb(249, 115, 22)',
            'rgb(234, 179, 8)'
          ],
          borderWidth: 1.5,
          borderRadius: 6,
        },
      ],
    };
  }, [filteredReports]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        bodyFont: { family: "'Montserrat', sans-serif" },
        titleFont: { family: "'Montserrat', sans-serif" },
        callbacks: {
          label: (context) => ` Total Reports: ${context.raw}`
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 10, family: "'Montserrat', sans-serif", weight: '600' }, color: '#64748b' }
      },
      y: {
        grid: { color: 'rgba(226, 232, 240, 0.6)' },
        ticks: { font: { size: 10, family: "'Montserrat', sans-serif" }, color: '#64748b', precision: 0 },
        beginAtZero: true
      }
    }
  };

  const getDropdownLabel = () => {
    if (pickerType === 'single' && dateValue) return format(dateValue, 'PP');
    if (pickerType === 'multiple' && Array.isArray(dateValue) && dateValue.length > 0) return `${dateValue.length} dates selected`;
    if (pickerType === 'range' && dateValue[0]) {
      return `${format(dateValue[0], 'MMM d')}${dateValue[1] ? ` - ${format(dateValue[1], 'MMM d')}` : '...'}`;
    }
    return 'Today (Default)';
  };

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm dark:bg-slate-900 dark:border-slate-800 flex flex-col justify-between h-[320px]">
      <div className="flex items-start justify-between mb-2 z-20">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 tracking-wide uppercase">
            Agency Daily Dispatch Volumes
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time daily tally of approved and resolved incidents assigned per agency.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select 
            className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 h-8 outline-none cursor-pointer"
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
              <Button variant="outline" size="sm" className="h-8 gap-2 text-xs border-slate-200 dark:border-slate-800">
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
              <div className="p-1 transition-none 
                [&_[data-selected]]:!bg-blue-600 
                [&_[data-selected]]:!text-white
                [&_[data-in-range]]:!bg-blue-50 
                dark:[&_[data-in-range]]:!bg-blue-950/40
                [&_[data-in-range]]:!text-blue-600
                dark:[&_[data-in-range]]:!text-blue-400"
              >
                <DatePicker 
                  type={pickerType} 
                  value={dateValue} 
                  onChange={(val) => {
                    if (pickerType === 'range') {
                      setDateValue(val || [null, null]);
                    } else if (pickerType === 'multiple') {
                      setDateValue(val || []);
                    } else {
                      setDateValue(val);
                    }
                  }} 
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={handleReset}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="relative w-full flex-1 min-h-0 z-10" style={{ height: '210px' }}>
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}