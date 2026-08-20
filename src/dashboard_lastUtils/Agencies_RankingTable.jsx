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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { AlertCircle, Loader2, Calendar as CalendarIcon, ChevronDown, RefreshCw } from 'lucide-react';
import { db } from '@/firebase'; // Adjust path to match your project setup
import { collection, onSnapshot } from 'firebase/firestore';
import { 
  parseISO, 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval,
  format 
} from 'date-fns';

// Mantine Dates Core Engine Components
import { MonthPicker } from '@mantine/dates';
import '@mantine/dates/styles.css';

// 🏢 Shared Agencies Configuration List
export const AGENCIES = [
  { id: "RHU", name: "Rural Health Unit", icon: "🏥" },
  { id: "BFP", name: "Bureau of Fire Protection", icon: "🚒" },
  { id: "PNP", name: "Philippine National Police", icon: "👮" },
  { id: "MDRRMO", name: "MDRRMO", icon: "🚑" },
  { id: "Barangay", name: "Barangay Officials", icon: "🏘️" }
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

export default function Agencies_RankingTable() {
  const [approvedReports, setApprovedReports] = useState([]);
  const [resolvedReports, setResolvedReports] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Single Month Filter State (Defaults to Current Date)
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  // Real-time listener for approved_reports & ResolvedReports
  useEffect(() => {
    setLoading(true);

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
        setLoading(false);
      },
      (error) => {
        console.error("Error listening to approved_reports:", error);
        setLoading(false);
      }
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
        setLoading(false);
      },
      (error) => {
        console.error("Error listening to ResolvedReports:", error);
        setLoading(false);
      }
    );

    return () => {
      unsubscribeApproved();
      unsubscribeResolved();
    };
  }, []);

  // Combined dataset from both collections
  const combinedReports = useMemo(() => {
    return [...approvedReports, ...resolvedReports];
  }, [approvedReports, resolvedReports]);

  // Filter dataset by currently selected month
  const monthlyFilteredReports = useMemo(() => {
    if (!selectedMonth) return [];

    const monthStart = startOfMonth(selectedMonth);
    const monthEnd = endOfMonth(selectedMonth);

    return combinedReports.filter(report => {
      if (!report) return false;

      const reportDate = parseReportDate(report);
      if (!reportDate || isNaN(reportDate.getTime())) return false;

      return isWithinInterval(reportDate, { start: monthStart, end: monthEnd });
    });
  }, [combinedReports, selectedMonth]);

  // Aggregate Agency Monthly Rankings - TOP 4 ONLY
  const rankings = useMemo(() => {
    const agencyMap = {};

    AGENCIES.forEach(agency => {
      agencyMap[agency.id] = { ...agency, total: 0 };
    });

    monthlyFilteredReports.forEach(report => {
      const rawAgencies = report.selectedAgencies || report.assignedAgencies || report.agency || report.assignedAgency;
      
      let agencyList = [];
      if (Array.isArray(rawAgencies)) {
        agencyList = rawAgencies.map(a => typeof a === 'object' ? (a?.id || a?.name || '') : a);
      } else if (typeof rawAgencies === 'string' && rawAgencies.trim() !== '') {
        agencyList = [rawAgencies];
      }

      agencyList.forEach(agencyKey => {
        const matchedAgency = AGENCIES.find(
          a => a.id.toLowerCase() === String(agencyKey).toLowerCase() || a.name.toLowerCase() === String(agencyKey).toLowerCase()
        );

        if (matchedAgency) {
          agencyMap[matchedAgency.id].total += 1;
        }
      });
    });

    return Object.values(agencyMap)
      .sort((a, b) => b.total - a.total)
      .map((item, index) => ({ rank: index + 1, ...item }))
      .slice(0, 4); // Limit to Top 4 Agencies
  }, [monthlyFilteredReports]);

  // Rank Badge Styling
  const getRankBadge = (rank) => {
    switch (rank) {
      case 1:
        return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-400/60 font-bold';
      case 2:
        return 'bg-slate-200/80 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600 font-bold';
      case 3:
        return 'bg-orange-500/10 text-amber-900 dark:text-orange-300 border-orange-500/50 font-bold';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 font-medium';
    }
  };

  return (
    <div className="w-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[320px] transition-all duration-300 overflow-hidden">
      
      {/* HEADER SECTION */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-200 uppercase">
            Most Agencies in this Month
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Monthly agency incident workload distributions.
          </p>
        </div>

        {/* RIGHT CONTROLS: MONTH FILTER & SYNC */}
        <div className="flex items-center gap-2 shrink-0">
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mr-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
            </div>
          )}

          {/* SINGLE MONTH FILTER POPOVER */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2 text-xs border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                <CalendarIcon className="h-3.5 w-3.5 text-slate-500" />
                <span className="font-semibold">{selectedMonth ? format(selectedMonth, 'MMMM yyyy') : 'Select Month'}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </Button>
            </PopoverTrigger>
            
            <PopoverContent 
              align="end" 
              sideOffset={5}
              className="p-3 bg-white dark:bg-slate-900 shadow-xl rounded-lg border border-slate-200 dark:border-slate-800 z-[9999] w-auto"
            >
              <div className="p-1 
                [&_[data-selected]]:!bg-blue-600 
                [&_[data-selected]]:!text-white"
              >
                <MonthPicker 
                  value={selectedMonth} 
                  onChange={(val) => val && setSelectedMonth(val)} 
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* RESET TO CURRENT MONTH */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" 
            onClick={() => setSelectedMonth(new Date())}
            title="Reset to current month"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* FIXED 4-ROW TABLE WRAPPER - COMPACT HEIGHT */}
      <div className="w-full flex-1 my-1.5 overflow-hidden rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
        <Table className="w-full table-fixed">
          <TableHeader className="bg-slate-50/90 dark:bg-slate-800/60">
            <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-800 text-xs">
              <TableHead className="w-[20%] px-3 py-1.5 text-left font-bold text-slate-700 dark:text-slate-300">Rank</TableHead>
              <TableHead className="w-[55%] px-3 py-1.5 text-left font-bold text-slate-700 dark:text-slate-300">Agency</TableHead>
              <TableHead className="w-[25%] px-3 py-1.5 text-right font-bold text-slate-700 dark:text-slate-300 pr-4">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rankings.map((row) => (
              <TableRow 
                key={row.id} 
                className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors border-slate-100 dark:border-slate-800/60 text-xs h-10"
              >
                {/* RANK BADGE */}
                <TableCell className="px-3 py-1 text-left">
                  <Badge variant="outline" className={`px-1.5 py-0.5 text-[11px] ${getRankBadge(row.rank)}`}>
                    #{row.rank}
                  </Badge>
                </TableCell>

                {/* ACRONYM + ICON */}
                <TableCell className="px-3 py-1 font-semibold text-slate-800 dark:text-slate-200 text-left">
                  <div className="flex items-center gap-1.5 truncate" title={row.id}>
                    <span className="text-sm shrink-0">{row.icon}</span>
                    <span className="truncate">{row.id}</span>
                  </div>
                </TableCell>

                {/* TOTAL */}
                <TableCell className="px-3 py-1 text-right font-bold text-blue-600 dark:text-blue-400 pr-4">
                  {row.total}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* FOOTER METRICS */}
      <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium flex items-center gap-1.5 truncate">
          <AlertCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="truncate">Aggregated from Firestore Feed</span>
        </span>
        <span className="font-semibold shrink-0 ml-2 text-slate-600 dark:text-slate-300">
          Agencies
        </span>
      </div>
    </div>
  );
}