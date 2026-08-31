import React, { useState, useEffect } from 'react';
import { 
  Edit3, 
  Shield, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  ArrowLeft, 
  Send,
  Building2,
  Flame,
  ShieldAlert,
  Ambulance,
  Home,
  X,
  FileText,
  Loader2
} from 'lucide-react';
import { io } from 'socket.io-client';
import { BorderBeam } from "@/components/ui/border-beam";

// 🌐 Dynamic Environment & Server Configuration
const RAW_SERVER_URL = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SOCKET_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 
  'https://alertu-server.onrender.com';

const CLEAN_SERVER_URL = RAW_SERVER_URL.replace(/\/+$/, '');
// 🔌 Socket.io Base URL (Strips '/api' suffix if present)
const SOCKET_SERVER_URL = CLEAN_SERVER_URL.replace(/\/api$/, '');

let socket;

export const AGENCIES = [
  { id: "RHU", name: "Rural Health Unit", icon: Building2, color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-400" },
  { id: "BFP", name: "Bureau of Fire Protection", icon: Flame, color: "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-400" },
  { id: "PNP", name: "Philippine National Police", icon: ShieldAlert, color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-400" },
  { id: "MDRRMO", name: "Municipal Disaster Risk Reduction", icon: Ambulance, color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-400" },
  { id: "Barangay", name: "Barangay Officials", icon: Home, color: "text-slate-600 bg-slate-100 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300" }
];

export default function ReportTitle({ 
  isOpen, 
  currentStep, 
  reportTitle, 
  setReportTitle, 
  selectedAgencies = [],
  setSelectedAgencies,
  handleFinalSubmit, 
  setCurrentStep,
  setIsVerifyModalOpen,
  selectedReport,
  adminNotes = '',
  setAdminNotes,
  spatialData,
  socketInstance
}) {
  const [warning, setWarning] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localNotes, setLocalNotes] = useState('');

  // Manage notes state smoothly whether controlled or uncontrolled
  const notesValue = adminNotes !== undefined && adminNotes !== '' ? adminNotes : localNotes;
  const handleNotesChange = (e) => {
    const val = e.target.value;
    if (typeof setAdminNotes === 'function') {
      setAdminNotes(val);
    }
    setLocalNotes(val);
  };

  // 🔌 Socket Connection Lifecycle Management
  useEffect(() => {
    if (isOpen) {
      if (!socketInstance) {
        socket = io(SOCKET_SERVER_URL, { transports: ['websocket', 'polling'] });
      } else {
        socket = socketInstance;
      }
    }
    return () => {
      if (socket && !socketInstance) {
        socket.disconnect();
      }
    };
  }, [isOpen, socketInstance]);

  if (!isOpen || currentStep !== 3) return null;

  const activeReport = selectedReport || spatialData || {};

  // Extract ID with exhaustive fallback options to prevent passing '_' or empty string
  const resolvedReportId = 
    activeReport?.id || 
    activeReport?._id || 
    activeReport?.reportID || 
    activeReport?.reportId || 
    activeReport?.customId ||
    selectedReport?.id ||
    selectedReport?.reportID ||
    selectedReport?.reportId ||
    spatialData?.id ||
    spatialData?.reportID ||
    spatialData?.reportId ||
    null;

  // 🔘 Agency Toggle Logic
  const handleToggleAgency = (agency) => {
    setWarning('');
    const existingIndex = selectedAgencies.findIndex((item) => item.id === agency.id);

    if (existingIndex > -1) {
      const updated = selectedAgencies.filter((_, idx) => idx !== existingIndex);
      setSelectedAgencies(updated);
    } else {
      if (selectedAgencies.length >= 5) {
        setWarning('Maximum responder limit reached (up to 5 channels allowed).');
        return;
      }
      setSelectedAgencies([...selectedAgencies, agency]);
    }
  };

  // 🚀 Final Submission Handler inside ReportTitle.jsx
  const handleSubmit = async () => {
    if (!reportTitle.trim() || selectedAgencies.length === 0 || isSubmitting) return;

    // Guard against invalid or missing target document IDs
    if (!resolvedReportId || resolvedReportId === '_') {
      console.error('Submission canceled: Target report ID is missing or invalid.', {
        selectedReport,
        spatialData
      });
      setWarning('Error: Could not identify valid report document. Please reselect the report.');
      return;
    }

    setIsSubmitting(true);
    setWarning('');

    try {
      // 1. Run parent write operation (DB update / PATCH endpoint)
      if (typeof handleFinalSubmit === 'function') {
        await handleFinalSubmit();
      }

      // ⚡ 2. EMIT REALTIME SOCKET EVENT TO FLUTTER CLIENTS
      const socketClient = socketInstance || socket;
      if (socketClient) {
        const payload = {
          action: 'REPORT_VERIFIED', // Exactly matches Flutter's isApprovedAction check
          reportId: resolvedReportId,
          reportID: resolvedReportId,
          title: reportTitle,
          agencies: selectedAgencies.map((a) => a.id),
          eventId: `verified_${resolvedReportId}_${Date.now()}`,
          timestamp: new Date().toISOString()
        };

        // Emit through primary and fallback event types
        socketClient.emit('ADMIN_ACTION_EVENT', payload);
        socketClient.emit('DISPATCH_VERIFIED_INCIDENT', payload);
      }

      // 3. Close Modal
      if (typeof setIsVerifyModalOpen === 'function') {
        setIsVerifyModalOpen(false);
      }
    } catch (err) {
      console.error('Failed to submit final dispatch report:', err);
      setWarning('An error occurred during submission. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    if (typeof setIsVerifyModalOpen === 'function') {
      setIsVerifyModalOpen(false);
    } else if (typeof setCurrentStep === 'function') {
      setCurrentStep(1);
    }
  };

  const isSubmitDisabled = !reportTitle.trim() || selectedAgencies.length === 0 || isSubmitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-sm text-slate-800 dark:text-slate-100 font-sans antialiased overflow-y-auto">
      
      {/* Outer Container */}
      <div className="relative w-full max-w-5xl h-[90vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
        
        <BorderBeam size={250} duration={12} delay={9} colorFrom="#3b82f6" colorTo="#6366f1" />

        {/* Modal Header */}
        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 shrink-0">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  Verification Step 3
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  Final Documentation
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight mt-0.5">
                Save and Finalize Report
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-4 justify-end">
            <button 
              type="button"
              onClick={handleClose} 
              disabled={isSubmitting}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed z-10"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row bg-slate-50/30 dark:bg-slate-950/20">
          
          {/* Left Panel */}
          <div className="flex-1 p-5 lg:p-6 space-y-5 overflow-y-auto border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex flex-col">
            
            {/* Title Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Official Report Title <span className="text-rose-500">*</span>
              </label>
              <input 
                type="text" 
                autoFocus
                disabled={isSubmitting}
                placeholder="e.g., Structural Fire Incident - Barangay Central Zone" 
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm disabled:bg-slate-100 dark:disabled:bg-slate-800"
              />
            </div>

            {/* Operational Notes */}
            <div className="space-y-1.5 flex-1 flex flex-col">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Admin Notes & Instructions
              </label>
              <textarea
                disabled={isSubmitting}
                placeholder="Add special instructions, on-scene safety warnings, or operational details for responders..."
                value={notesValue}
                onChange={handleNotesChange}
                className="w-full flex-1 min-h-[180px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm resize-none disabled:bg-slate-100 dark:disabled:bg-slate-800"
              />
            </div>

          </div>

          {/* Right Panel */}
          <aside className="w-full lg:w-[380px] shrink-0 bg-white dark:bg-slate-900 p-5 lg:p-6 flex flex-col justify-between overflow-y-auto space-y-5">
            
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <label className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Dispatch Agencies <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                  <span className="text-blue-600 dark:text-blue-400 font-extrabold">{selectedAgencies.length}</span> / 5 Selected
                </span>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Select the dispatch agencies that need to be deployed to the incident scene.
              </p>

              {/* Agency List */}
              <div className="space-y-2">
                {AGENCIES.map((agency) => {
                  const IconComponent = agency.icon;
                  const isSelected = selectedAgencies.some((item) => item.id === agency.id);

                  return (
                    <button
                      key={agency.id}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleToggleAgency(agency)}
                      className={`w-full text-left p-3 rounded-xl border flex items-center justify-between transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30 dark:border-blue-500 shadow-sm'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-lg border shrink-0 ${agency.color}`}>
                          <IconComponent className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {agency.name}
                          </p>
                          <p className="text-[10px] font-mono font-semibold text-slate-400 dark:text-slate-500 uppercase">
                            {agency.id}
                          </p>
                        </div>
                      </div>

                      <div className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all shrink-0 ${
                        isSelected 
                          ? 'bg-blue-600 text-white shadow-sm' 
                          : 'border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'
                      }`}>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {warning && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300 font-medium">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{warning}</span>
                </div>
              )}
            </div>

          </aside>
        </div>

        {/* Modal Footer */}
        <footer className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <button 
            type="button"
            disabled={isSubmitting}
            onClick={() => setCurrentStep && setCurrentStep(2)} 
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Map</span>
          </button>

          <button 
            type="button"
            disabled={isSubmitDisabled}
            onClick={handleSubmit}
            className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center gap-2 active:scale-95 ${
              isSubmitDisabled 
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 border border-slate-300 dark:border-slate-800 cursor-not-allowed shadow-none' 
                : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600'
            }`}
          >
            <span>{isSubmitting ? 'Finalizing...' : 'Save & Dispatch'}</span>
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </footer>

      </div>
    </div>
  );
}
