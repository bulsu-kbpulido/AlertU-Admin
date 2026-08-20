import React, { useState, useEffect, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {CheckCircle2, Calendar as CalendarIcon, ChevronDown, RefreshCw } from 'lucide-react';
import { db } from '@/firebase'; // Adjust import path if needed
import { collection, onSnapshot } from 'firebase/firestore';
import { 
  parseISO, 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval,
  format
} from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

// Mantine MonthPicker Engine
import { MonthPicker } from '@mantine/dates';
import '@mantine/dates/styles.css';

/**
 * Animated Number Ticker Component for smooth transitions
 */
function NumberTicker({ value, className = "" }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`inline-block ${className}`}
    >
      {value}
    </motion.span>
  );
}

/**
 * Extract Barangay directly from the raw address/location string in the doc
 */
function extractBarangayFromText(report) {
  if (!report) return 'Unknown Location';

  const explicitBrgy = report.barangay || report.brgy || report.barangayName;
  if (explicitBrgy && typeof explicitBrgy === 'string' && explicitBrgy.trim()) {
    return cleanBarangayName(explicitBrgy);
  }

  let rawText = '';
  if (typeof report.location === 'string') {
    rawText = report.location;
  } else if (report.location && typeof report.location === 'object') {
    rawText = report.location.address || report.location.barangay || report.location.name || '';
  } else if (typeof report.address === 'string') {
    rawText = report.address;
  }

  if (!rawText || !rawText.trim()) {
    return 'Unknown Location';
  }

  return parseAddressToBarangay(rawText);
}

function parseAddressToBarangay(text) {
  if (!text) return 'Unknown Location';
  let str = text.trim();
  // Clean off prefixed incident descriptors if present
  str = str.replace(/^(fire|accident|flood|incident|medical|crime)\s+(at|in|near)\s+/i, '');
  str = str.replace(/\s+/g, ' ').trim();
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

function cleanBarangayName(str) {
  if (!str) return 'Unknown Location';
  return str.trim().replace(/\s+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

const parseReportDate = (report) => {
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

export default function BaranggayRanking_Charts({
  monthlyDateValue = null
}) {
  // Initialize state using monthlyDateValue prop if provided, else fallback to current date
  const [selectedMonth, setSelectedMonth] = useState(monthlyDateValue || new Date());
  const [approvedReports, setApprovedReports] = useState([]);
  const [resolvedReports, setResolvedReports] = useState([]);

  // Sync selectedMonth state if parent component updates monthlyDateValue
  useEffect(() => {
    if (monthlyDateValue) {
      setSelectedMonth(monthlyDateValue);
    }
  }, [monthlyDateValue]);

  // Active month used for filtering and labels
  const activeMonth = selectedMonth || new Date();

  // 1. REAL-TIME LISTENERS: approved_reports and ResolvedReports
  useEffect(() => {
    const approvedRef = collection(db, 'approved_reports');
    const unsubscribeApproved = onSnapshot(
      approvedRef,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setApprovedReports(data);
      },
      (error) => console.error("Error fetching approved_reports:", error)
    );

    const resolvedRef = collection(db, 'ResolvedReports');
    const unsubscribeResolved = onSnapshot(
      resolvedRef,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setResolvedReports(data);
      },
      (error) => console.error("Error fetching ResolvedReports:", error)
    );

    return () => {
      unsubscribeApproved();
      unsubscribeResolved();
    };
  }, []);

  // 2. FILTER BY ACTIVE MONTH
  const filteredApproved = useMemo(() => {
    const start = startOfMonth(activeMonth);
    const end = endOfMonth(activeMonth);

    return approvedReports.filter(report => {
      const reportDate = parseReportDate(report);
      if (!reportDate || isNaN(reportDate.getTime())) return false;
      return isWithinInterval(reportDate, { start, end });
    });
  }, [approvedReports, activeMonth]);

  const filteredResolved = useMemo(() => {
    const start = startOfMonth(activeMonth);
    const end = endOfMonth(activeMonth);

    return resolvedReports.filter(report => {
      const reportDate = parseReportDate(report);
      if (!reportDate || isNaN(reportDate.getTime())) return false;
      return isWithinInterval(reportDate, { start, end });
    });
  }, [resolvedReports, activeMonth]);

  // 3. AGGREGATE BY BARANGAY
  const rankings = useMemo(() => {
    const brgyMap = {};

    // Count approved reports as total per barangay
    filteredApproved.forEach(report => {
      const locationKey = extractBarangayFromText(report);
      if (!brgyMap[locationKey]) {
        brgyMap[locationKey] = { total: 0, resolved: 0 };
      }
      brgyMap[locationKey].total += 1;
    });

    // Count resolved reports per barangay
    filteredResolved.forEach(report => {
      const locationKey = extractBarangayFromText(report);
      if (!brgyMap[locationKey]) {
        brgyMap[locationKey] = { total: 0, resolved: 0 };
      }
      brgyMap[locationKey].resolved += 1;
    });

    return Object.keys(brgyMap)
      .map(name => {
        const total = brgyMap[name].total;
        const resolved = brgyMap[name].resolved;
        return { name, total, resolved };
      })
      .sort((a, b) => b.total - a.total || b.resolved - a.resolved)
      .map((item, index) => ({ rank: index + 1, ...item }))
      .slice(0, 4);
  }, [filteredApproved, filteredResolved]);

  const handleReset = () => {
    setSelectedMonth(new Date());
  };

  const getDropdownLabel = () => {
    return format(activeMonth, 'MMMM yyyy');
  };

  const getRankBadge = (rank) => {
    switch (rank) {
      case 1:
        return 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-400/60 shadow-sm';
      case 2:
        return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600 shadow-sm';
      case 3:
        return 'bg-orange-500/20 text-amber-900 dark:text-orange-300 border-orange-500/50 shadow-sm';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
    }
  };

  return (
    <div className="w-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col justify-between transition-all duration-300">
      
      {/* HEADER */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-200 uppercase">
              Most Affected Baranggays Based on Months
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time tally of approved & resolved incident reports
          </p>
        </div>

        {/* CONTROLS */}
        <div className="flex items-center gap-2">
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
              <div className="p-1 transition-none [&_[data-selected]]:!bg-blue-600 [&_[data-selected]]:!text-white">
                <MonthPicker 
                  value={selectedMonth} 
                  onChange={(val) => {
                    if (val) {
                      setSelectedMonth(val);
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

      {/* TABLE */}
      <div className="relative w-full overflow-hidden rounded-lg border border-slate-100 dark:border-slate-800/80">
        <Table>
          <TableHeader className="bg-slate-50/80 dark:bg-slate-800/50">
            <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-800">
              <TableHead className="w-[85px] font-semibold text-slate-600 dark:text-slate-300">Rate</TableHead>
              <TableHead className="font-semibold text-slate-600 dark:text-slate-300">Barangay / Location</TableHead>
              <TableHead className="text-right font-semibold text-slate-600 dark:text-slate-300">Total Approved</TableHead>
              <TableHead className="text-right font-semibold text-slate-600 dark:text-slate-300 pr-4">Resolved</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rankings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-6 text-xs text-slate-400">
                  No records found for the selected month.
                </TableCell>
              </TableRow>
            ) : (
              <AnimatePresence mode="popLayout">
                {rankings.map((row) => (
                  <motion.tr
                    key={row.name}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors border-slate-100 dark:border-slate-800/60 h-12"
                  >
                    <TableCell className="font-medium py-2.5">
                      <Badge variant="outline" className={`font-bold px-2 py-0.5 text-xs ${getRankBadge(row.rank)}`}>
                        #{row.rank}
                      </Badge>
                    </TableCell>

                    <TableCell className="font-semibold text-slate-800 dark:text-slate-200 text-xs sm:text-sm py-2.5">
                      {row.name}
                    </TableCell>

                    <TableCell className="text-right font-bold text-blue-600 dark:text-blue-400 text-xs sm:text-sm py-2.5">
                      <NumberTicker value={row.total} />
                    </TableCell>

                    <TableCell className="text-right pr-4 font-bold text-emerald-600 dark:text-emerald-400 text-xs sm:text-sm py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 hidden sm:inline" />
                        <NumberTicker value={row.resolved} />
                      </div>
                    </TableCell>
                  </motion.tr>
                ))}
              </AnimatePresence>
            )}
          </TableBody>
        </Table>
      </div>

      {/* FOOTER */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium">
          Live sync with approved_reports and ResolvedReports
        </span>
        <span className="font-medium">
          Barangay Statistics
        </span>
      </div>
    </div>
  );
}