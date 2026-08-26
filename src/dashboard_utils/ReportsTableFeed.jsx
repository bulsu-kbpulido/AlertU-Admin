import React, { useMemo, useEffect, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableHeader, TableRow, TableCell } from "@/components/ui/table";
import { Pagination } from '@mantine/core';
import { MapPin, Inbox, Clock, Hash, AlertTriangle, Flame, Waves, Car, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseISO, format } from 'date-fns';

// Simplified category mapping without general
const typeDesignMap = {
  fire: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200/60 dark:border-rose-800/50',
    icon: Flame,
    label: 'fire'
  },
  flood: {
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-200/60 dark:border-sky-800/50',
    icon: Waves,
    label: 'flood'
  },
  accident: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200/60 dark:border-amber-800/50',
    icon: Car,
    label: 'accident'
  },
  others: {
    bg: 'bg-slate-100 dark:bg-slate-800/60',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-700',
    icon: HelpCircle,
    label: 'others'
  }
};

const severityDesignMap = {
  high: { 
    bg: 'bg-rose-50 dark:bg-rose-950/40', 
    text: 'text-rose-700 dark:text-rose-300', 
    dot: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]',
    border: 'border-rose-200/80 dark:border-rose-800/60'
  },
  medium: { 
    bg: 'bg-amber-50 dark:bg-amber-950/40', 
    text: 'text-amber-700 dark:text-amber-300', 
    dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    border: 'border-amber-200/80 dark:border-amber-800/60'
  },
  low: { 
    bg: 'bg-emerald-50 dark:bg-emerald-950/40', 
    text: 'text-emerald-700 dark:text-emerald-300', 
    dot: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
    border: 'border-emerald-200/80 dark:border-emerald-800/60'
  }
};

// Universal Date Parser Helper
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

// Formats timestamp into simple date & time string
const formatDateTime = (report) => {
  const parsedDate = getReportDate(report);
  if (parsedDate) {
    return format(parsedDate, 'MMM d, yyyy • h:mm a');
  }
  if (report?.time) return String(report.time);
  if (report?.date) return String(report.date);
  return 'N/A';
};

// Helper to format/generate Verified Report ID (VRID)
const formatVRID = (report) => {
  if (!report) return 'VRID0000000';
  
  if (report.verifiedReportId) return String(report.verifiedReportId);
  if (report.vrid) return String(report.vrid);
  
  // Extract trailing digits from document ID if available
  const idStr = String(report.id || report.reportId || '');
  const cleanNum = idStr.replace(/\D/g, '');
  
  if (cleanNum.length > 0) {
    return `VRID${cleanNum.slice(-7).padStart(7, '0')}`;
  }

  // Fallback hash derived from ID string
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = (hash << 5) - hash + idStr.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash).toString();
  return `VRID${positiveHash.slice(0, 7).padStart(7, '0')}`;
};

// Helper to determine if a report is considered resolved regardless of source
const isReportResolved = (report) => {
  if (!report) return false;
  const statusStr = String(report.status || report.verifiedStatus || '').toLowerCase();
  return statusStr === 'resolved' || statusStr === 'archived' || Boolean(report.resolvedAt);
};

export default function ReportsTableFeed({
  activeTab, 
  setActiveTab,
  metrics,
  filteredReports = [], 
  setSelectedReport
}) {
  // Managed local state for pagination (locked at 2 rows per page)
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 2,
  });

  // Dynamic badge counts calculated from the date-filtered feed
  const activeCount = useMemo(() => {
    return filteredReports.filter(report => !isReportResolved(report)).length;
  }, [filteredReports]);

  const resolvedCount = useMemo(() => {
    return filteredReports.filter(report => isReportResolved(report)).length;
  }, [filteredReports]);

  // Isolate active tab records cleanly
  const contextualReports = useMemo(() => {
    return filteredReports.filter(report => {
      if (activeTab === 'resolved') {
        return isReportResolved(report);
      } else {
        return !isReportResolved(report);
      }
    });
  }, [filteredReports, activeTab]);

  const columns = useMemo(() => {
    return [
      {
        id: 'vrid',
        header: 'VRID',
        cell: ({ row }) => {
          const rep = row.original;
          const vridStr = formatVRID(rep);
          return (
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60">
              <Hash className="h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0" />
              <span className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200 tracking-tight">
                {vridStr}
              </span>
            </div>
          );
        }
      },
      {
        id: 'incidentTitle',
        header: 'Incident Details',
        cell: ({ row }) => {
          const rep = row.original;
          const title = rep.reportTitle || rep.hazard || rep.hazardType || rep.incidentType || 'Untitled Incident';
          return (
            <div className="py-0.5">
              <span className="font-semibold text-slate-900 dark:text-slate-100 block truncate max-w-[180px] text-xs tracking-tight" title={title}>
                {title}
              </span>
            </div>
          );
        }
      },
      {
        id: 'incidentType',
        header: 'Type',
        accessorFn: (row) => {
          const raw = (row.incidentType || row.hazardType || 'others').toLowerCase();
          if (raw.includes('fire')) return 'fire';
          if (raw.includes('flood')) return 'flood';
          if (raw.includes('accident')) return 'accident';
          return 'others';
        },
        cell: ({ getValue }) => {
          const value = getValue();
          const design = typeDesignMap[value] || typeDesignMap.others;
          const IconComponent = design.icon;

          return (
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium tracking-tight border ${design.bg} ${design.text} ${design.border}`}>
              <IconComponent className="h-3.5 w-3.5 shrink-0 opacity-80" />
              <span className="capitalize">{design.label}</span>
            </div>
          );
        }
      },
      {
        id: 'severity',
        header: 'Severity',
        accessorFn: (row) => {
          const raw = (row.verifiedSeverity || row.severity || 'medium').toLowerCase();
          if (raw.includes('high') || raw.includes('critical')) return 'high';
          if (raw.includes('low')) return 'low';
          return 'medium';
        },
        cell: ({ getValue }) => {
          const value = getValue();
          const design = severityDesignMap[value] || severityDesignMap.medium;

          return (
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-tight border ${design.bg} ${design.text} ${design.border}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${design.dot}`} />
              <span className="capitalize">{value}</span>
            </div>
          );
        }
      },
      {
        id: 'dateTime',
        header: 'Date & Time',
        cell: ({ row }) => {
          const rep = row.original;
          const dateTimeStr = formatDateTime(rep);
          return (
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 text-xs font-normal whitespace-nowrap">
              <Clock className="text-slate-400 dark:text-slate-500 shrink-0 h-3.5 w-3.5" />
              <span>{dateTimeStr}</span>
            </div>
          );
        }
      },
      {
        id: 'location',
        header: 'Location Address',
        cell: ({ row }) => {
          const rep = row.original;
          const addressStr = typeof rep.location === 'string' 
            ? rep.location 
            : rep.location?.address || rep.address || 'Location data unavailable';
            
          return (
            <div className="flex items-center gap-1.5 max-w-[210px]">
              <MapPin className="text-slate-400 dark:text-slate-500 shrink-0 h-3.5 w-3.5" />
              <span className="truncate text-slate-600 dark:text-slate-400 text-xs font-normal" title={addressStr}>
                {addressStr}
              </span>
            </div>
          );
        }
      },
      {
        id: 'citizenDetails',
        header: () => <div className="text-right pr-4">Contact Profile</div>,
        cell: ({ row }) => {
          const rep = row.original;
          const citizenName = 
            rep.submitterName || 
            (typeof rep.submitter === 'string' ? rep.submitter : rep.submitter?.name || rep.submitter?.fullName) ||
            rep.reporter || rep.user?.name || (rep.source === 'admin' ? 'Admin Verified' : 'Anonymous');
            
          const contactPhone = 
            rep.submitterPhone || rep.submitterPhoneNumber || rep.submitter?.phone || 'Not Provided';

          return (
            <div className="text-right max-w-[160px] ml-auto pr-4">
              <p className="font-semibold text-slate-800 dark:text-slate-200 truncate text-xs">{citizenName}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">
                {activeTab === 'active' ? 'Active Reporter' : `Phone: ${contactPhone}`}
              </p>
            </div>
          );
        }
      }
    ];
  }, [activeTab]);

  // Initialize table with onPaginationChange handler
  const table = useReactTable({
    data: contextualReports,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    state: {
      pagination,
    },
  });

  // Reset to Page 0 whenever filtered data or tabs change
  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [filteredReports, activeTab]);

  const totalReports = contextualReports.length;
  const { pageIndex, pageSize } = pagination;
  const startIndex = pageIndex * pageSize;
  const visibleCount = table.getRowModel().rows.length;
  const totalPages = table.getPageCount();

  return (
    <Card className="border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm rounded-xl overflow-hidden font-sans w-full">
      <CardHeader className="py-3 px-4 sm:px-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-900/30">
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0 min-w-0">
          <CardTitle className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50 uppercase truncate">
            Incident Reports Feed
          </CardTitle>
          <CardDescription className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 hidden sm:block truncate">
            Real-time feed filtered by active criteria and tab context
          </CardDescription>
        </div>
        
        <Tabs 
          value={activeTab} 
          onValueChange={(v) => { 
            setActiveTab(v); 
            setSelectedReport?.(null); 
            setPagination((prev) => ({ ...prev, pageIndex: 0 })); 
          }}
          className="shrink-0"
        >
          <TabsList className="h-8 p-0.5 bg-slate-200/60 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center gap-0.5">
            <TabsTrigger 
              value="active" 
              className="text-[11px] font-medium px-3 py-1 rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>Active Incidents</span>
              <span className="bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold px-1.5 py-0.2 rounded-full text-[10px]">
                {activeCount}
              </span>
            </TabsTrigger>
            
            <TabsTrigger 
              value="resolved" 
              className="text-[11px] font-medium px-3 py-1 rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>Resolved Log</span>
              <span className="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold px-1.5 py-0.2 rounded-full text-[10px]">
                {resolvedCount}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      
      <CardContent className="p-0 pt-0 w-full overflow-x-auto
        [&::-webkit-scrollbar]:h-[6px] 
        [&::-webkit-scrollbar-track]:bg-transparent 
        [&::-webkit-scrollbar-thumb]:bg-slate-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-800 [&::-webkit-scrollbar-thumb]:rounded-full"
      >
        <Table className="w-full text-left table-auto border-collapse min-w-[750px]">
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id} className="bg-slate-100/60 dark:bg-slate-900/60 border-b border-slate-200/80 dark:border-slate-800 hover:bg-transparent">
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="px-5 py-2.5 text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider whitespace-nowrap">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="text-xs divide-y divide-slate-100 dark:divide-slate-800/80">
            {visibleCount === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
                    <Inbox className="h-6 w-6 stroke-[1.5] text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-xs text-slate-500 dark:text-slate-400">No incident records found matching active selection</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              <AnimatePresence mode="wait">
                {table.getRowModel().rows.map(row => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.16, ease: 'easeInOut' }}
                    onClick={() => setSelectedReport?.(row.original)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40 cursor-pointer border-b border-slate-100 dark:border-slate-800/60 transition-colors duration-150"
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id} className="px-5 py-3.5 align-middle whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </motion.tr>
                ))}
              </AnimatePresence>
            )}
          </TableBody>
        </Table>

        {totalReports > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200/80 dark:border-slate-800 px-4 sm:px-5 py-3 bg-slate-50/50 dark:bg-slate-950 w-full">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Showing <span className="font-semibold text-slate-800 dark:text-slate-200">{startIndex + 1}</span> – <span className="font-semibold text-slate-800 dark:text-slate-200">{startIndex + visibleCount}</span> of <span className="font-semibold text-slate-800 dark:text-slate-200">{totalReports}</span> entries
            </span>

            <Pagination 
              value={pageIndex + 1} 
              onChange={(page) => table.setPageIndex(page - 1)} 
              total={totalPages} 
              size="sm"
              radius="md"
              withEdges={false}
              styles={{
                control: {
                  border: '1px solid #cbd5e1',
                  fontSize: '11px',
                  fontWeight: 600,
                }
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}