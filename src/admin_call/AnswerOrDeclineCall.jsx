import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRingtone } from '../useRingtone';
import { socket, emitCallEnded } from '../socket';
import { auth } from '../firebase'; // Adjust path if needed
import useAuditLog from '../useAuditLog'; // Adjust path if needed

// Lucide React Icons
import { 
  PhoneCall, 
  PhoneOff, 
  Phone, 
  ShieldAlert, 
  Radio, 
  Hash, 
  User 
} from 'lucide-react';

export default function AnswerOrDeclineCall({
  callData,
  onAnswer,
  onDecline,
  audioUrl = '/ringtone.mp3',
}) {
  const { startRingtone, stopRingtone } = useRingtone(audioUrl);
  const currentUser = auth.currentUser;

  // Initialize Audit Log Hook
  const { logMovement } = useAuditLog({
    adminId: currentUser?.uid || 'ADMIN-UNKNOWN',
    adminName: currentUser?.displayName || currentUser?.email || 'System Admin',
  });
  
  const onDeclineRef = useRef(onDecline);
  const actionHandledRef = useRef(false);
  const auditLogTimerRef = useRef(null);

  useEffect(() => {
    onDeclineRef.current = onDecline;
  }, [onDecline]);

  // Keep the UI action immediate and defer the non-critical audit request.
  const scheduleAuditLog = (action, targetId, details) => {
    // Do not cancel this timer during unmount: accepting/declining may
    // immediately unmount this modal, but the audit entry must still run.
    auditLogTimerRef.current = window.setTimeout(async () => {
      try {
        await logMovement(action, targetId, details);
      } catch (err) {
        console.error(`Audit log error for ${action}:`, err);
      }
    }, 250);
  };

  useEffect(() => {
    if (!callData) return;

    startRingtone();

    // Generic call termination listener
    const handleCallEndedSignal = (data) => {
      if (!data?.channelName || data.channelName === callData.channelName) {
        stopRingtone();
        if (onDeclineRef.current) onDeclineRef.current();
      }
    };

    // Account deactivation / Emergency alert cancel listener
    const handleEmergencyAlert = (data) => {
      if (
        data?.channelName === callData.channelName ||
        (data?.citizenId && data?.citizenId === callData.citizenId)
      ) {
        stopRingtone();
        if (onDeclineRef.current) onDeclineRef.current();
      }
    };

    // Socket Event Listeners
    socket.on('call_ended', handleCallEndedSignal);
    socket.on('admin:emergency_alert', handleEmergencyAlert);
    socket.on('citizen_deactivated', handleEmergencyAlert);

    return () => {
      stopRingtone();
      socket.off('call_ended', handleCallEndedSignal);
      socket.off('admin:emergency_alert', handleEmergencyAlert);
      socket.off('citizen_deactivated', handleEmergencyAlert);
    };
  }, [callData, startRingtone, stopRingtone]);

  if (!callData) return null;

  const { channelName, callerName, citizenId, citizenName } = callData;
  const resolvedCitizenName = callerName || citizenName || 'Emergency Citizen';
  const resolvedCitizenId = citizenId || channelName || 'UNKNOWN_CITIZEN';

  const handleAnswer = () => {
    // Ignore duplicate clicks while the modal is being dismissed.
    if (actionHandledRef.current) return;
    actionHandledRef.current = true;

    stopRingtone();

    // Open the call immediately. Do not await audit logging here.
    if (onAnswer) {
      onAnswer({
        ...callData,
        citizenId: resolvedCitizenId,
        citizenName: resolvedCitizenName,
      });
    }

    scheduleAuditLog('ANSWER_EMERGENCY_CALL', resolvedCitizenId, {
      citizenName: resolvedCitizenName,
      channelName,
      answeredAt: new Date().toISOString(),
    });
  };

  const handleDecline = () => {
    // Ignore duplicate clicks while the modal is being dismissed.
    if (actionHandledRef.current) return;
    actionHandledRef.current = true;

    stopRingtone();

    // End and close the call immediately. Do not await audit logging here.
    if (channelName) {
      emitCallEnded('admins', channelName);
    }

    if (onDecline) onDecline();

    scheduleAuditLog('DECLINE_EMERGENCY_CALL', resolvedCitizenId, {
      citizenName: resolvedCitizenName,
      channelName,
      declinedAt: new Date().toISOString(),
    });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 backdrop-blur-sm text-slate-800 font-sans antialiased overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 15 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        >
          {/* Header Bar */}
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-red-50 border border-red-200 text-red-600">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-600 block">
                  Emergency Alert
                </span>
                <h3 className="text-sm font-bold text-slate-900">
                  Incoming Call Notification
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-semibold animate-pulse">
              <Radio className="w-3.5 h-3.5 text-red-600" />
              <span>Live Alert</span>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">
            
            {/* Pulsing Emergency Caller Icon */}
            <div className="relative flex items-center justify-center my-3">
              <span className="absolute inline-flex h-24 w-24 rounded-full bg-red-500/20 animate-ping" />
              <span className="absolute inline-flex h-32 w-32 rounded-full bg-red-500/10 animate-pulse" />
              
              <div className="relative z-10 w-20 h-20 bg-gradient-to-tr from-rose-600 to-red-500 rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/30 text-white">
                <PhoneCall className="w-10 h-10 animate-bounce" />
              </div>
            </div>

            {/* Caller Information */}
            <div className="mt-4 max-w-full">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-medium mb-2">
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span>Citizen Dispatch</span>
              </div>
              
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight truncate px-2">
                {resolvedCitizenName}
              </h2>

              <div className="flex items-center justify-center gap-1.5 mt-2 text-xs font-mono font-medium text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg w-fit mx-auto">
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                <span>Channel: {channelName}</span>
              </div>
            </div>

            {/* Quick Informational Note */}
            <p className="text-xs text-slate-500 mt-5 max-w-sm">
              An emergency call requires immediate response. Answer to join the secure channel or end the request.
            </p>
          </div>

          {/* Action Control Buttons */}
          <div className="px-6 py-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4">
            
            {/* End Call / Decline Button */}
            <button
              onClick={handleDecline}
              type="button"
              className="flex-1 py-3 px-4 rounded-xl bg-white hover:bg-rose-50 border border-rose-200 hover:border-rose-300 text-rose-600 font-bold text-sm shadow-sm transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 group"
            >
              <PhoneOff className="w-4 h-4 text-rose-600 group-hover:scale-110 transition-transform" />
              <span>End Call</span>
            </button>

            {/* Answer Call Button */}
            <button
              onClick={handleAnswer}
              type="button"
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition-all duration-200 active:scale-95 flex items-center justify-center gap-2"
            >
              <Phone className="w-4 h-4 text-white animate-pulse" />
              <span>Answer Call</span>
            </button>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
