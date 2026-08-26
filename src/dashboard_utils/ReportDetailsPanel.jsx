import React from 'react';
import { Button } from "@/components/ui/button"; 
import { FiLoader, FiBell } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';

const incidentThemeMap = {
  fire: { dot: '#b91c1c', bg: 'rgba(185, 28, 28, 0.08)', text: '#b91c1c' },
  flood: { dot: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)', text: '#2563eb' },
  accident: { dot: '#7c3aed', bg: 'rgba(124, 58, 237, 0.08)', text: '#7c3aed' },
  others: { dot: '#f97316', bg: 'rgba(249, 115, 22, 0.08)', text: '#f97316' }
};

const getIncidentCategory = (typeStr) => {
  if (!typeStr) return 'others';
  const clean = String(typeStr).toLowerCase().trim();
  if (clean.includes('fire')) return 'fire';
  if (clean.includes('flood')) return 'flood';
  if (clean.includes('acc') || clean.includes('car') || clean.includes('crash') || clean.includes('wreck')) return 'accident';
  return 'others';
};

const cleanToStreetAndBarangay = (addressStr) => {
  if (!addressStr || typeof addressStr !== 'string') return 'Location Spotted';
  const tokens = addressStr.split(',').map(t => t.trim());
  const barangayToken = tokens.find(t => t.toLowerCase().includes('brgy') || t.toLowerCase().includes('barangay'));
  
  if (barangayToken) {
    const bIdx = tokens.indexOf(barangayToken);
    const streetToken = bIdx > 0 ? tokens[bIdx - 1] : '';
    return streetToken ? `${streetToken}, ${barangayToken}` : barangayToken;
  }
  return tokens.slice(0, 2).join(', ');
};

function ReportItem({ report, selectedReport, setSelectedReport, onViewClick }) {
  const rawType = report?.incidentType || report?.type || 'Incident';
  const category = getIncidentCategory(rawType);
  const theme = incidentThemeMap[category];
  const isSelected = selectedReport?.id === report.id;

  const rawAddress = typeof report.location === 'string' 
    ? report.location 
    : report.location?.address || '';
    
  const compactAddress = rawAddress ? cleanToStreetAndBarangay(rawAddress) : 'Coordinates Pinpointed';

  return (
    <motion.div 
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 38 }}
      onClick={() => setSelectedReport?.(report)}
      className={`w-full flex items-center justify-between gap-4 p-3.5 rounded-xl border select-none group/item ${
        isSelected 
          ? 'bg-slate-50 dark:bg-slate-800/60 border-slate-300 dark:border-slate-700 shadow-sm' 
          : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800/60 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50/40 dark:hover:bg-slate-800/20'
      }`}
    >
      <div className="flex items-center gap-3.5 flex-1 min-w-0">
        <div className="flex items-center justify-center shrink-0">
          <span 
            className="w-2.5 h-2.5 rounded-full transition-transform group-hover/item:scale-110 duration-200" 
            style={{ backgroundColor: theme.dot, boxShadow: `0 0 8px ${theme.dot}40` }} 
          />
        </div>
        
        <div className="flex-1 min-w-0 flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-0.5 2xl:gap-2">
          <span 
            className="text-xs sm:text-[13px] font-bold uppercase tracking-wider shrink-0 truncate"
            style={{ color: theme.text }}
          >
            {rawType}
          </span>
          <p className="text-xs sm:text-[13px] font-medium text-slate-500 dark:text-slate-400 truncate leading-normal 2xl:text-right flex-1 min-w-0">
            {compactAddress}
          </p>
        </div>
      </div>

      <div className="shrink-0 pl-1">
        <Button
          size="sm"
          className="h-7 text-[11px] font-semibold px-3 bg-blue-900 hover:bg-blue-800 dark:bg-blue-800 dark:hover:bg-blue-700 text-white rounded-lg shadow-sm border-0 transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation(); 
            if (onViewClick) onViewClick(report); 
          }}
        >
          View
        </Button>
      </div>
    </motion.div>
  );
}

export default function ReportDetailsPanel({ 
  reportsList = [], 
  selectedReport, 
  setSelectedReport, 
  loading,
  onViewClick,
  filterAgency = [] 
}) {
  // Syncing filtering logic with the updated Firestore field: selectedAgencies
  const displayReports = React.useMemo(() => {
    if (!filterAgency || filterAgency.length === 0) return reportsList;
    return reportsList.filter(report => {
      const agencies = report.selectedAgencies || [];
      return filterAgency.every(requiredId => agencies.includes(requiredId));
    });
  }, [reportsList, filterAgency]);

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-xl font-sans">
      
      <div className="h-14 px-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 text-slate-800 dark:text-slate-200">
          <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg shrink-0 border border-slate-100 dark:border-slate-700">
            <FiBell className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              Live Maps Feed
            </span>
          </div>
        </div>
      </div>
      
      <motion.div 
        layoutRoot
        className="flex-1 overflow-y-auto min-h-0 w-full bg-slate-50/40 dark:bg-slate-950/10 p-3 space-y-2
          [&::-webkit-scrollbar]:w-[5px] 
          [&::-webkit-scrollbar-track]:bg-transparent 
          [&::-webkit-scrollbar-thumb]:bg-slate-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-800 [&::-webkit-scrollbar-thumb]:rounded-full"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {loading ? (
            <motion.div 
              key="loader"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full flex flex-col justify-center items-center py-16"
            >
              <FiLoader className="w-5 h-5 animate-spin text-slate-400 mb-2" />
              <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Loading incoming alerts...</p>
            </motion.div>
          ) : displayReports.length > 0 ? (
            displayReports.map((report) => (
              <ReportItem 
                key={report.id} 
                report={report} 
                selectedReport={selectedReport} 
                setSelectedReport={setSelectedReport}
                onViewClick={onViewClick}
              />
            ))
          ) : (
            <motion.div 
              key="empty-state"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full flex flex-col justify-center items-center text-center p-6 py-16"
            >
              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 max-w-[200px] leading-relaxed">
                Clear skies! No active community alerts found right now.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}