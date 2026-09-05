import React, { useEffect } from 'react';
import { X, User, Shield, ArrowRight, Layers } from 'lucide-react';
import { useAuditLog } from '../useAuditLog'; // Adjust import path if needed

/**
 * CitizenOrDepartments Modal Component
 * Intercepts the "Generate Link" action to let the admin select the target audience
 * and logs the audit movement (e.g., ADMIN-004 generated link for CITIZEN / DEPARTMENT).
 */
export default function CitizenOrDepartments({ 
  isOpen, 
  onClose, 
  onSelect, 
  report = null, 
  adminId = 'ADMIN-004',
  adminName = 'System Admin' 
}) {
  
  // Initialize Audit Logging Hook
  const { logGenerateSharedLink } = useAuditLog({
    adminId,
    adminName,
  });

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  /**
   * Handles selection, dispatches audit movement log, and notifies parent callback
   */
  const handleSelection = (targetDepartment) => {
    // Open link generation immediately; audit logging runs in the background.
    onSelect(targetDepartment);
    onClose();

    void logGenerateSharedLink(report, {
      target: targetDepartment,
    }).catch((err) => {
      console.error('Failed to log link generation audit movement:', err);
    });
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm font-sans text-slate-800 dark:text-slate-100 antialiased transition-opacity duration-300"
      onClick={onClose}
    >
      {/* Modal Container */}
      <div 
        className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden transform transition-all duration-300 scale-100 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <header className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-800 text-blue-600 dark:text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Share Updates (Generated Link)
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight mt-0.5">
                Select Target Audience
              </h3>
            </div>
          </div>

          <button 
            onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-300 hover:text-slate-600 dark:hover:text-white transition-all shadow-sm active:scale-95"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body Content */}
        <div className="p-6 space-y-4 bg-white dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
            Choose who will receive this dynamic link. It will share updates to the incident reports.
          </p>

          <div className="flex flex-col gap-3">
            
            {/* CITIZEN OPTION */}
            <button
              onClick={() => handleSelection('citizen')}
              className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50/40 dark:hover:bg-blue-950/50 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 group transition-all duration-200 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-lg bg-blue-100/70 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 shadow-sm">
                  <User className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                    Citizen
                  </h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">
                    Generate incident report details for affected residents.
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-300 group-hover:translate-x-1 transition-all" />
            </button>

            {/* DEPARTMENTS OPTION */}
            <button
              onClick={() => handleSelection('department')}
              className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/50 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-500 group transition-all duration-200 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-lg bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-sm">
                  <Shield className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
                    Department
                  </h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">
                    Generate incident report details for active responders.
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-300 group-hover:translate-x-1 transition-all" />
            </button>

          </div>
        </div>

        {/* Footer */}
        <footer className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950/70 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button 
            onClick={onClose} 
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-all shadow-sm active:scale-95"
          >
            Cancel
          </button>
        </footer>

      </div>
    </div>
  );
}
