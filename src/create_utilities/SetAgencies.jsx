import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Check, 
  AlertTriangle, 
  Shield, 
  CheckCircle2 
} from 'lucide-react';

// Shadcn UI Button component
import { Button } from "@/components/ui/button";

export const AGENCIES = [
  { 
    id: "RHU", 
    name: "Rural Health Unit", 
    icon: "🏥", 
    color: "border-emerald-300 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300" 
  },
  { 
    id: "BFP", 
    name: "Bureau of Fire Protection", 
    icon: "🚒", 
    color: "border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300" 
  },
  { 
    id: "PNP",
    name: "Philippine National Police",
    icon: "👮",
    color: "border-blue-300 dark:border-blue-800/80 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300", 
  },
  { 
    id: "MDRRMO", 
    name: "Municipal Disaster Risk Reduction and Management Office", 
    icon: "🚑", 
    color: "border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300" 
  },
  { 
    id: "Barangay", 
    name: "Barangay Officials", 
    icon: "🏘️", 
    color: "border-yellow-300 dark:border-yellow-800/80 bg-yellow-50 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300" 
  }
];

export default function SetAgenciesModal({ isOpen, onClose, selectedAgencies = [], onSave }) {
  // Local working list initialized from current report state
  const [localSelection, setLocalSelection] = useState([]);
  const [warning, setWarning] = useState('');

  useEffect(() => {
    if (isOpen) {
      setLocalSelection(selectedAgencies);
      setWarning('');
    }
  }, [isOpen, selectedAgencies]);

  if (!isOpen) return null;

  const handleToggleAgency = (agency) => {
    setWarning('');
    
    const isAlreadySelected = localSelection.some((item) => item.id === agency.id);

    if (isAlreadySelected) {
      // Remove if tapped again
      setLocalSelection(localSelection.filter((item) => item.id !== agency.id));
    } else {
      // Enforce 5 item maximum threshold
      if (localSelection.length >= 5) {
        setWarning('Maximum dispatch threshold reached. You can only attach up to 5 responder agencies.');
        return;
      }
      setLocalSelection([...localSelection, agency]);
    }
  };

  const handleConfirmSave = () => {
    onSave(localSelection);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3 sm:p-4 font-[Roboto,sans-serif]">
          
          {/* Motion Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
          />

          {/* Motion Modal Dialog Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-lg shadow-xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 z-10"
          >
            
            {/* Header Layout */}
            <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/70 dark:bg-slate-900/70">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Dispatch Responder Agencies
                </h3>
              </div>
              <button 
                type="button"
                onClick={onClose} 
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Picker Workspace Area */}
            <div className="p-3.5 space-y-3 max-h-[60vh] overflow-y-auto">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-normal leading-relaxed">
                Select the emergency responder channels to assign to this incident deployment plan. (Max 5)
              </p>

              {/* Selected Agency Chips Overview */}
              {localSelection.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                    Active Selection ({localSelection.length})
                  </span>

                  <div className="flex flex-wrap gap-1.5">
                    <AnimatePresence>
                      {localSelection.map((agency) => (
                        <motion.button
                          key={agency.id}
                          layout
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.85 }}
                          transition={{ duration: 0.15 }}
                          type="button"
                          onClick={() => handleToggleAgency(agency)}
                          className={`px-2 py-1 rounded border text-[10px] font-bold flex items-center gap-1.5 shadow-2xs transition-all hover:opacity-80 ${agency.color}`}
                        >
                          <span>{agency.icon}</span>
                          <span>{agency.id}</span>
                          <X className="h-3 w-3 shrink-0 ml-0.5" />
                        </motion.button>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Agency List */}
              <div className="grid grid-cols-1 gap-1.5 pt-1">
                {AGENCIES.map((agency) => {
                  const isSelected = localSelection.some((item) => item.id === agency.id);
                  
                  return (
                    <button
                      key={agency.id}
                      type="button"
                      onClick={() => handleToggleAgency(agency)}
                      className={`w-full text-left p-2.5 rounded-md border flex items-center justify-between transition-all duration-150 ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-1 ring-blue-500/30'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/40 hover:bg-slate-100/80 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`text-base p-1.5 rounded border ${agency.color} shrink-0`}>
                          {agency.icon}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {agency.name}
                          </p>
                          <p className="text-[10px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
                            {agency.id}
                          </p>
                        </div>
                      </div>

                      <div className={`w-4 h-4 rounded-full flex items-center justify-center transition-all shrink-0 ml-2 ${
                        isSelected 
                          ? 'bg-blue-600 text-white scale-100' 
                          : 'border border-slate-300 dark:border-slate-600 scale-90'
                      }`}>
                        {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Threshold Validation Guard */}
              <AnimatePresence>
                {warning && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 rounded-md flex gap-2 items-start"
                  >
                    <AlertTriangle className="text-amber-600 dark:text-amber-400 h-4 w-4 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-800 dark:text-amber-300 font-semibold leading-tight">
                      {warning}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer Actions */}
            <div className="px-3.5 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                Selected: <span className="text-blue-600 dark:text-blue-400 font-bold">{localSelection.length}</span> / 5
              </span>

              <div className="flex items-center gap-2">
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={onClose} 
                  className="text-[11px] font-bold uppercase tracking-wider h-8 px-3"
                >
                  Cancel
                </Button>
                
                <Button
                  type="button"
                  onClick={handleConfirmSave}
                  disabled={localSelection.length === 0}
                  className={`text-[11px] font-bold uppercase tracking-wider h-8 px-3 shadow-xs ${
                    localSelection.length === 0
                      ? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white"
                  }`}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  <span>Apply Selection</span>
                </Button>
              </div>
            </div>

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}