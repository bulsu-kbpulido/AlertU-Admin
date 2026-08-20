import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { FiSearch, FiSliders, FiCheck, FiRotateCcw } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AGENCIES } from '../create_utilities/SetAgencies'; 

const INCIDENT_STYLE_MAP = {
  fire: { bg: 'bg-red-500/10 dark:bg-red-500/15', text: 'text-red-600 dark:text-red-400', border: 'border-red-200 dark:border-red-900/50' },
  flood: { bg: 'bg-blue-500/10 dark:bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-900/50' },
  accident: { bg: 'bg-purple-500/10 dark:bg-purple-500/15', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-900/50' },
  others: { bg: 'bg-orange-500/10 dark:bg-orange-500/15', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-900/50' }
};

const HAZARD_STYLE_MAP = {
  none: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-200 dark:border-slate-700' },
  electrical: { bg: 'bg-amber-500/10 dark:bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-900/50' },
  chemical: { bg: 'bg-purple-500/10 dark:bg-purple-500/15', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-900/50' },
  others: { bg: 'bg-slate-500/10 dark:bg-slate-500/15', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-200 dark:border-slate-800' }
};

const SEVERITY_STYLE_MAP = {
  high: { bg: 'bg-red-700 text-white border-transparent shadow-sm', fallback: 'hover:border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/5' },
  medium: { bg: 'bg-orange-500 text-white border-transparent shadow-sm', fallback: 'hover:border-orange-500/40 text-orange-600 dark:text-orange-400 bg-orange-500/5' },
  low: { bg: 'bg-emerald-600 text-white border-transparent shadow-sm', fallback: 'hover:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/10' }
};

export default function Dashboard_Searchbar({ 
  searchTerminalQuery, 
  setSearchTerminalQuery, 
  filterSeverity, 
  setFilterSeverity,
  filterIncidentType = 'all',
  setFilterIncidentType,
  filterHazardType = 'all',
  setFilterHazardType,
  filterAgency = [], 
  setFilterAgency
}) {
  const [open, setOpen] = useState(false);

  const activeFiltersCount = 
    (filterSeverity !== 'all' ? 1 : 0) + 
    (filterIncidentType !== 'all' ? 1 : 0) + 
    (filterHazardType !== 'all' ? 1 : 0) + 
    (filterAgency.length > 0 ? 1 : 0);

  const handleResetFilters = () => {
    setFilterSeverity('all');
    setFilterIncidentType('all');
    setFilterHazardType('all');
    setFilterAgency([]);
  };

  const handleToggleAgencyFilter = (agencyId) => {
    if (filterAgency.includes(agencyId)) {
      setFilterAgency(filterAgency.filter(id => id !== agencyId));
    } else {
      if (filterAgency.length >= 5) return;
      setFilterAgency([...filterAgency, agencyId]);
    }
  };

  return (
    <div className="relative w-full font-sans">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-2 h-[56px] flex items-center justify-between shadow-md gap-3">
        
        <div className="relative flex-1 h-full flex items-center">
          <FiSearch className="absolute left-3.5 text-slate-400 dark:text-slate-500 text-base" />
          <input
            type="text"
            value={searchTerminalQuery}
            onChange={(e) => setSearchTerminalQuery(e.target.value)}
            placeholder="Search location, incident type, or community alert..."
            className="w-full h-full pl-10 pr-4 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all duration-200"
          />
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center h-[40px] px-4 gap-2 bg-blue-900 hover:bg-blue-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 font-semibold text-xs uppercase tracking-wider rounded-xl shadow-sm select-none relative transition-colors cursor-pointer border-0 shrink-0"
            >
              <FiSliders className="text-sm shrink-0" />
              <span className="hidden sm:inline">Filters</span>
              
              {activeFiltersCount > 0 && (
                <span className="flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white shadow-sm scale-90">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          
          <PopoverContent className="w-[330px] p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl pointer-events-auto" align="end" sideOffset={8}>
            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -4 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      Filter Reports
                    </span>
                    {activeFiltersCount > 0 && (
                      <Button 
                        variant="ghost"
                        onClick={handleResetFilters}
                        className="h-7 text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-red-500 flex items-center gap-1 px-2 rounded-lg transition-colors"
                      >
                        <FiRotateCcw className="text-[10px]" />
                        Reset All
                      </Button>
                    )}
                  </div>

                  {/* Incident Classification */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      Incident Type
                    </label>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setFilterIncidentType('all')}
                        className={`text-xs font-semibold px-3 py-1 rounded-lg border transition-all cursor-pointer ${
                          filterIncidentType === 'all'
                            ? 'bg-blue-900 text-white dark:bg-slate-100 dark:text-slate-950 border-transparent shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-850 text-slate-600 dark:text-slate-400 hover:border-slate-200'
                        }`}
                      >
                        All
                      </button>
                      {Object.keys(INCIDENT_STYLE_MAP).map((type) => {
                        const isSelected = filterIncidentType === type;
                        const style = INCIDENT_STYLE_MAP[type];
                        return (
                          <button
                            type="button"
                            key={type}
                            onClick={() => setFilterIncidentType(type)}
                            className={`text-xs font-semibold px-3 py-1 rounded-lg border capitalize transition-all cursor-pointer ${
                              isSelected
                                ? `${style.bg} ${style.text} ${style.border} font-bold shadow-sm`
                                : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-850 text-slate-600 dark:text-slate-400 hover:border-slate-200'
                            }`}
                          >
                            {type}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Hazard Classification */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      Hazard Classification
                    </label>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setFilterHazardType('all')}
                        className={`text-xs font-semibold px-3 py-1 rounded-lg border transition-all cursor-pointer ${
                          filterHazardType === 'all'
                            ? 'bg-blue-900 text-white dark:bg-slate-100 dark:text-slate-950 border-transparent shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-850 text-slate-600 dark:text-slate-400 hover:border-slate-200'
                        }`}
                      >
                        All
                      </button>
                      {Object.keys(HAZARD_STYLE_MAP).map((hazard) => {
                        const isSelected = filterHazardType === hazard;
                        const style = HAZARD_STYLE_MAP[hazard];
                        return (
                          <button
                            type="button"
                            key={hazard}
                            onClick={() => setFilterHazardType(hazard)}
                            className={`text-xs font-semibold px-3 py-1 rounded-lg border capitalize transition-all cursor-pointer ${
                              isSelected
                                ? `${style.bg} ${style.text} ${style.border} font-bold shadow-sm`
                                : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-850 text-slate-600 dark:text-slate-400 hover:border-slate-200'
                            }`}
                          >
                            {hazard}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Severity Priority */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      Severity Level
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      <button
                        type="button"
                        onClick={() => setFilterSeverity('all')}
                        className={`text-xs font-semibold py-1 rounded-lg border text-center transition-all cursor-pointer ${
                          filterSeverity === 'all'
                            ? 'bg-blue-900 text-white dark:bg-slate-100 dark:text-slate-950 border-transparent shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-850 text-slate-600 dark:text-slate-400 hover:border-slate-200'
                        }`}
                      >
                        All
                      </button>
                      {Object.keys(SEVERITY_STYLE_MAP).map((level) => {
                        const isSelected = filterSeverity === level;
                        const style = SEVERITY_STYLE_MAP[level];
                        return (
                          <button
                            type="button"
                            key={level}
                            onClick={() => setFilterSeverity(level)}
                            className={`text-xs font-semibold py-1 rounded-lg border text-center capitalize transition-all cursor-pointer ${
                              isSelected
                                ? style.bg
                                : `bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800/80 ${style.fallback}`
                            }`}
                          >
                            {level}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Dispatched Operational Agencies */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        Assigned Responders
                      </label>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md">
                        {filterAgency.length}/5 max
                      </span>
                    </div>
                    <div className="space-y-1 max-h-[150px] overflow-y-auto pr-1 
                      [&::-webkit-scrollbar]:w-[4px] 
                      [&::-webkit-scrollbar-thumb]:bg-slate-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-800 [&::-webkit-scrollbar-thumb]:rounded-full"
                    >
                      <div
                        onClick={() => setFilterAgency([])}
                        className={`w-full flex items-center justify-between p-2 rounded-xl text-xs font-semibold cursor-pointer border select-none transition-colors ${
                          filterAgency.length === 0
                            ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/40 text-blue-600 dark:text-blue-400'
                            : 'bg-slate-50 dark:bg-slate-950 border-transparent hover:bg-slate-100/60 dark:hover:bg-slate-900/40 text-slate-700 dark:text-slate-400'
                        }`}
                      >
                        <span>All Responders</span>
                        {filterAgency.length === 0 && <FiCheck className="text-blue-600 dark:text-blue-400 stroke-[3]" />}
                      </div>
                      
                      {AGENCIES.map((agency) => {
                        const isSelected = filterAgency.includes(agency.id);
                        return (
                          <div
                            key={agency.id}
                            onClick={() => handleToggleAgencyFilter(agency.id)}
                            className={`w-full flex items-center justify-between p-2 rounded-xl text-xs font-semibold cursor-pointer border select-none transition-all ${
                              isSelected
                                ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white shadow-sm font-bold'
                                : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{agency.icon}</span>
                              <span className="truncate max-w-[200px]">{agency.name}</span>
                            </div>
                            {isSelected && <FiCheck className="text-blue-600 dark:text-blue-400 stroke-[3]" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </motion.div>
              )}
            </AnimatePresence>
          </PopoverContent>
        </Popover>

      </div>
    </div>
  );
}