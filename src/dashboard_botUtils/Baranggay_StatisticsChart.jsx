import React, { useState, useMemo, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { 
  parseISO, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval, 
  format,
  isSameDay,
  startOfDay,
  endOfDay
} from 'date-fns';

// Firebase Firestore Imports
// Note: Adjust the import path for `db` to match your Firebase config file location
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';

// Icons & UI Foundations
import { Calendar as CalendarIcon, ChevronDown, RefreshCw } from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Mantine Dates Core Components
import { DatePicker, MonthPicker } from '@mantine/dates';
import '@mantine/dates/styles.css'; 

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// Format full address into standard Street & Barangay format
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

// Helper function to extract standard Barangay name from report
const extractBarangay = (report) => {
  if (!report) return 'Unknown Barangay';

  // Direct barangay string if available
  if (report.barangay && typeof report.barangay === 'string') {
    return report.barangay.trim();
  }

  const loc = report.location;
  if (loc && typeof loc === 'object' && loc.barangay) {
    return String(loc.barangay).trim();
  }

  // Extract address string using street and barangay parsing rules
  const locStr = typeof loc === 'string' 
    ? loc 
    : (loc?.address || report.address || report.correctedAddress || '');

  if (!locStr) return 'Unknown Barangay';

  const formattedAddr = formatStreetAndBarangay(locStr);

  // Common Meycauayan Barangays list for intelligent parsing
  const knownBarangays = [
    'Banga', 'Bayugo', 'Calvario', 'Caingin', 'Malhacan', 'Meycauayan',
    'Perez', 'Poblacion', 'Saluysoy', 'San Jose', 'Zamora', 'Pulo', 
    'Iba', 'Camalig', 'Pantok', 'Lawa', 'Tugatog', 'Bahay Pare'
  ];

  for (const brgy of knownBarangays) {
    const regex = new RegExp(`\\b(${brgy}|Brgy\\.?\\s*${brgy})\\b`, 'i');
    if (regex.test(formattedAddr)) {
      return `Brgy. ${brgy}`;
    }
  }

  // Fallback: Pick second segment from Street, Barangay format
  const parts = formattedAddr.split(',').map(p => p.trim());
  if (parts.length > 1) {
    return parts[1].toLowerCase().includes('brgy') ? parts[1] : `Brgy. ${parts[1]}`;
  }

  return 'Brgy. Central';
};

export default function Baranggay_StatisticsChart({ reports = [] }) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [resolvedReports, setResolvedReports] = useState([]);
  const [approvedReports, setApprovedReports] = useState([]);
  
  // View Modes: 'weekly' or 'monthly'
  const [viewMode, setViewMode] = useState('weekly');
  
  // Date Picker States
  const [pickerType, setPickerType] = useState('range');
  const [weeklyDateValue, setWeeklyDateValue] = useState([null, null]);
  const [monthlyDateValue, setMonthlyDateValue] = useState(null);

  // Watch HTML dark mode state
  useEffect(() => {
    const checkTheme = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkTheme();

    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  // Real-time Firestore listeners for approved_reports & ResolvedReports
  useEffect(() => {
    // 1. Listen to approved_reports collection
    const approvedRef = collection(db, 'approved_reports');
    const unsubscribeApproved = onSnapshot(
      approvedRef,
      (snapshot) => {
        const approvedData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setApprovedReports(approvedData);
      },
      (error) => {
        console.error('Error fetching approved_reports from Firestore:', error);
      }
    );

    // 2. Listen to ResolvedReports collection
    const resolvedRef = collection(db, 'ResolvedReports');
    const unsubscribeResolved = onSnapshot(
      resolvedRef,
      (snapshot) => {
        const resolvedData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setResolvedReports(resolvedData);
      },
      (error) => {
        console.error('Error fetching ResolvedReports from Firestore:', error);
      }
    );

    // Cleanup both listeners on unmount
    return () => {
      unsubscribeApproved();
      unsubscribeResolved();
    };
  }, []);

  // Combined Dataset (Active reports prop + Approved + Resolved from Firestore)
  const combinedReports = useMemo(() => {
    return [...reports, ...approvedReports, ...resolvedReports];
  }, [reports, approvedReports, resolvedReports]);

  // Reset Filters
  const handleReset = () => {
    if (viewMode === 'weekly') {
      setWeeklyDateValue(pickerType === 'range' ? [null, null] : pickerType === 'multiple' ? [] : null);
    } else {
      setMonthlyDateValue(null);
    }
  };

  // Filter Combined Reports by Time Range
  const filteredReports = useMemo(() => {
    const now = new Date();

    return combinedReports.filter(report => {
      if (!report) return false;

      const rawTimestamp = 
        report.resolvedAt || 
        report.timestamp || 
        report.verifiedAt || 
        report.reportTimestamp || 
        report.createdAt;

      if (!rawTimestamp) return false;

      try {
        const reportDate = typeof rawTimestamp.toDate === 'function' 
          ? rawTimestamp.toDate() 
          : typeof rawTimestamp === 'string' 
            ? parseISO(rawTimestamp) 
            : new Date(rawTimestamp);

        if (isNaN(reportDate.getTime())) return false;

        // WEEKLY FILTERING LOGIC
        if (viewMode === 'weekly') {
          const defaultStart = startOfDay(startOfWeek(now, { weekStartsOn: 0 }));
          const defaultEnd = endOfDay(endOfWeek(now, { weekStartsOn: 0 }));

          const isCustomActive = 
            (pickerType === 'single' && weeklyDateValue) ||
            (pickerType === 'range' && weeklyDateValue?.[0]) ||
            (pickerType === 'multiple' && Array.isArray(weeklyDateValue) && weeklyDateValue.length > 0);

          if (!isCustomActive) {
            return isWithinInterval(reportDate, { start: defaultStart, end: defaultEnd });
          }

          if (pickerType === 'single' && weeklyDateValue) {
            return isSameDay(reportDate, weeklyDateValue);
          }

          if (pickerType === 'multiple' && Array.isArray(weeklyDateValue)) {
            return weeklyDateValue.some(d => d && isSameDay(reportDate, d));
          }

          if (pickerType === 'range' && weeklyDateValue[0]) {
            const start = startOfDay(weeklyDateValue[0]);
            const end = weeklyDateValue[1] ? endOfDay(weeklyDateValue[1]) : endOfDay(weeklyDateValue[0]);
            return isWithinInterval(reportDate, { start, end });
          }
        } 
        // MONTHLY FILTERING LOGIC
        else {
          const targetMonth = monthlyDateValue || now;
          const start = startOfMonth(targetMonth);
          const end = endOfMonth(targetMonth);
          return isWithinInterval(reportDate, { start, end });
        }
      } catch {
        return false;
      }

      return false;
    });
  }, [combinedReports, viewMode, pickerType, weeklyDateValue, monthlyDateValue]);

  // Aggregate Data by Barangay and Incident Category
  const barangayData = useMemo(() => {
    const brgyMap = {};

    filteredReports.forEach(report => {
      const brgyName = extractBarangay(report);
      const rawType = (report.incidentType || report.type || report.hazard || 'others').toLowerCase();
      
      let type = 'others';
      if (rawType.includes('fire')) type = 'fire';
      else if (rawType.includes('flood')) type = 'flood';
      else if (rawType.includes('accident')) type = 'accident';

      if (!brgyMap[brgyName]) {
        brgyMap[brgyName] = { fire: 0, flood: 0, accident: 0, others: 0, total: 0 };
      }

      brgyMap[brgyName][type] += 1;
      brgyMap[brgyName].total += 1;
    });

    const labels = Object.keys(brgyMap);
    
    // Default fallback barangays if no data present
    if (labels.length === 0) {
      return {
        labels: ['Brgy. San Jose', 'Brgy. Malhacan', 'Brgy. Calvario', 'Brgy. Banga', 'Brgy. Caingin', 'Brgy. Bayugo'],
        fire: [0, 0, 0, 0, 0, 0],
        flood: [0, 0, 0, 0, 0, 0],
        accident: [0, 0, 0, 0, 0, 0],
        others: [0, 0, 0, 0, 0, 0],
        totalLogs: 0
      };
    }

    const fire = labels.map(l => brgyMap[l].fire);
    const flood = labels.map(l => brgyMap[l].flood);
    const accident = labels.map(l => brgyMap[l].accident);
    const others = labels.map(l => brgyMap[l].others);
    const totalLogs = labels.reduce((sum, l) => sum + brgyMap[l].total, 0);

    return { labels, fire, flood, accident, others, totalLogs };
  }, [filteredReports]);

  // Stacked Chart Config
  const chartData = {
    labels: barangayData.labels,
    datasets: [
      {
        label: 'Fire',
        data: barangayData.fire,
        backgroundColor: 'rgba(239, 68, 68, 0.85)',
        borderColor: 'rgb(239, 68, 68)',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Flood',
        data: barangayData.flood,
        backgroundColor: 'rgba(59, 130, 246, 0.85)',
        borderColor: 'rgb(59, 130, 246)',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Accident',
        data: barangayData.accident,
        backgroundColor: 'rgba(245, 158, 11, 0.85)',
        borderColor: 'rgb(245, 158, 11)',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Others',
        data: barangayData.others,
        backgroundColor: 'rgba(100, 116, 139, 0.85)',
        borderColor: 'rgb(100, 116, 139)',
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          boxWidth: 10,
          font: { size: 10, weight: '600' },
          color: isDarkMode ? '#cbd5e1' : '#475569', 
          padding: 10
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff', 
        borderColor: isDarkMode ? '#334155' : '#e2e8f0', 
        borderWidth: 1,
        titleColor: isDarkMode ? '#f8fafc' : '#0f172a', 
        bodyColor: isDarkMode ? '#cbd5e1' : '#334155', 
        padding: 8,
        callbacks: {
          footer: (tooltipItems) => {
            let total = 0;
            tooltipItems.forEach((item) => {
              total += item.raw;
            });
            return `Total Incidents: ${total}`;
          },
        }
      }
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: {
          font: { size: 10 },
          color: isDarkMode ? '#94a3b8' : '#64748b' 
        }
      },
      y: {
        stacked: true,
        grid: {
          color: isDarkMode ? '#1e293b' : '#f1f5f9',
          drawBorder: false
        },
        ticks: {
          precision: 0,
          font: { size: 10 },
          color: isDarkMode ? '#94a3b8' : '#64748b'
        }
      }
    }
  };

  // Dropdown Button Label Text
  const getDropdownLabel = () => {
    if (viewMode === 'weekly') {
      if (pickerType === 'single' && weeklyDateValue) return format(weeklyDateValue, 'MMM dd, yyyy');
      if (pickerType === 'multiple' && Array.isArray(weeklyDateValue) && weeklyDateValue.length > 0) return `${weeklyDateValue.length} dates`;
      if (pickerType === 'range' && weeklyDateValue[0]) {
        return `${format(weeklyDateValue[0], 'MMM d')} - ${weeklyDateValue[1] ? format(weeklyDateValue[1], 'MMM d') : 'Selecting...'}`;
      }
      return 'Filter Date';
    } else {
      if (monthlyDateValue) return format(monthlyDateValue, 'MMMM yyyy');
      return format(new Date(), 'MMMM yyyy');
    }
  };

  return (
    <div className="w-full bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[360px] transition-all duration-200">
      
      {/* HEADER CONTROLS BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 z-20">
        <div>
          <h3 className="text-xs font-bold tracking-tight text-slate-900 dark:text-slate-100 uppercase">
            Incidents by Barangay
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Breakdown of emergency reports by area
          </p>
        </div>

        {/* CONTROLS */}
        <div className="flex flex-wrap items-center gap-1.5">
          
          {/* Time View Switcher */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-900 p-0.5 rounded-md border border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setViewMode('weekly')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-all ${
                viewMode === 'weekly'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setViewMode('monthly')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-all ${
                viewMode === 'monthly'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              Monthly
            </button>
          </div>

          {/* Range/Single Selector (Weekly Only) */}
          {viewMode === 'weekly' && (
            <select 
              className="text-[11px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-slate-600 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 h-7 outline-none"
              value={pickerType}
              onChange={(e) => {
                const type = e.target.value;
                setPickerType(type);
                setWeeklyDateValue(type === 'range' ? [null, null] : type === 'multiple' ? [] : null);
              }}
            >
              <option value="range">Range</option>
              <option value="multiple">Multiple</option>
              <option value="single">Single</option>
            </select>
          )}

          {/* Date Picker Dropdown */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 gap-1.5 text-[11px] border-slate-200 dark:border-slate-800">
                <CalendarIcon className="h-3 w-3 text-slate-500" />
                <span className="truncate max-w-[110px]">{getDropdownLabel()}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            
            <DropdownMenuContent 
              align="end" 
              sideOffset={5}
              className="p-2 bg-white dark:bg-slate-900 shadow-xl rounded-lg border border-slate-200 dark:border-slate-800 z-[9999] min-w-fit w-auto overflow-visible"
            >
              <div className="p-0.5 transition-none 
                [&_[data-selected]]:!bg-blue-600 
                [&_[data-selected]]:!text-white
                [&_[data-in-range]]:!bg-blue-50 
                dark:[&_[data-in-range]]:!bg-blue-950/40
                [&_[data-in-range]]:!text-blue-600
                dark:[&_[data-in-range]]:!text-blue-400"
              >
                {viewMode === 'weekly' ? (
                  <DatePicker 
                    type={pickerType} 
                    value={weeklyDateValue} 
                    onChange={(val) => {
                      if (pickerType === 'range') setWeeklyDateValue(val || [null, null]);
                      else if (pickerType === 'multiple') setWeeklyDateValue(val || []);
                      else setWeeklyDateValue(val);
                    }} 
                  />
                ) : (
                  <MonthPicker 
                    value={monthlyDateValue} 
                    onChange={(val) => setMonthlyDateValue(val)} 
                  />
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Reset Button */}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={handleReset}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* CHART CANVAS AREA */}
      <div className="relative flex-1 min-h-[220px] w-full z-10 my-1">
        <Bar options={options} data={chartData} />
      </div>

      {/* FOOTER STATS INFO */}
      <div className="border-t border-slate-100 dark:border-slate-800/80 pt-2 text-center z-10 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          Active Barangays: <strong className="text-slate-800 dark:text-slate-200">{barangayData.labels.length}</strong>
        </span>
        <span>
          Total Incidents: <strong className="text-slate-800 dark:text-slate-200">{barangayData.totalLogs}</strong>
        </span>
      </div>
    </div>
  );
}