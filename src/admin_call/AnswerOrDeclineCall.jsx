import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRingtone } from '../useRingtone';
import { socket, emitCallEnded } from '../socket';
import { auth } from '../firebase';
import useAuditLog from '../useAuditLog';

// Lucide React Icons
import {
  PhoneCall,
  PhoneOff,
  Phone,
  ShieldAlert,
  Radio,
  Hash,
  User,
  Users,
  CheckCircle2,
  Clock
} from 'lucide-react';

export default function AnswerOrDeclineCall({
  callData,
  callsQueue,
  onAnswer,
  onDecline,
  audioUrl = '/ringtone.mp3',
  currentAdminId,
  isCallActive = false,
}) {
  const { startRingtone, stopRingtone } = useRingtone(audioUrl);
  const currentUser = auth.currentUser;
  const resolvedAdminId = currentAdminId || currentUser?.uid || 'ADMIN-UNKNOWN';

  // Normalize incoming queue
  const queue = Array.isArray(callsQueue) && callsQueue.length > 0
    ? callsQueue
    : (callData ? [callData] : []);

  // Selected index for tabbed multi-call navigation
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Clamp index if queue shrinks
  useEffect(() => {
    if (selectedIndex >= queue.length && queue.length > 0) {
      setSelectedIndex(queue.length - 1);
    }
  }, [queue.length, selectedIndex]);

  const activeCall = queue[selectedIndex] || queue[0] || null;

  // Ringtone should only ring if there is at least one UNCLAIMED / RINGING call
  const hasRingingCall = queue.some(c => (!c.status || c.status === 'ringing') && !c.assignedAdminId);

  // Initialize Audit Log Hook
  const { logMovement } = useAuditLog({
    adminId: resolvedAdminId,
    adminName: currentUser?.displayName || currentUser?.email || 'System Admin',
  });

  const onDeclineRef = useRef(onDecline);
  const onAnswerRef = useRef(onAnswer);
  const auditLogTimerRef = useRef(null);

  useEffect(() => {
    onDeclineRef.current = onDecline;
    onAnswerRef.current = onAnswer;
  }, [onDecline, onAnswer]);

  const scheduleAuditLog = (action, targetId, details) => {
    auditLogTimerRef.current = window.setTimeout(async () => {
      try {
        await logMovement(action, targetId, details);
      } catch (err) {
        console.error(`Audit log error for ${action}:`, err);
      }
    }, 250);
  };

  // Ringtone controller based on whether any ringing calls exist
  useEffect(() => {
    if (hasRingingCall) {
      startRingtone();
    } else {
      stopRingtone();
    }

    return () => {
      stopRingtone();
    };
  }, [hasRingingCall, startRingtone, stopRingtone]);

  // Socket listeners for call termination / deactivation
  useEffect(() => {
    if (queue.length === 0) return;

    const handleCallEndedSignal = (data) => {
      const channelName = typeof data === 'string' ? data : data?.channelName;
      if (channelName && onDeclineRef.current) {
        const matching = queue.find(c => c.channelName === channelName);
        if (matching) {
          onDeclineRef.current(matching);
        }
      }
    };

    const handleEmergencyAlert = (data) => {
      const channelName = data?.channelName;
      const citizenId = data?.citizenId;
      if (onDeclineRef.current) {
        const matching = queue.find(c => c.channelName === channelName || (citizenId && c.citizenId === citizenId));
        if (matching) {
          onDeclineRef.current(matching);
        }
      }
    };

    socket.on('call_ended', handleCallEndedSignal);
    socket.on('admin:emergency_alert', handleEmergencyAlert);
    socket.on('citizen_deactivated', handleEmergencyAlert);

    return () => {
      socket.off('call_ended', handleCallEndedSignal);
      socket.off('admin:emergency_alert', handleEmergencyAlert);
      socket.off('citizen_deactivated', handleEmergencyAlert);
    };
  }, [queue]);

  if (!activeCall) return null;

  const { channelName, callerName, citizenId, citizenName, status, assignedAdminId, assignedAdminName } = activeCall;
  const resolvedCitizenName = callerName || citizenName || 'Emergency Citizen';
  const resolvedCitizenId = citizenId || channelName || 'UNKNOWN_CITIZEN';

  // Check if call is already claimed by someone else
  const isClaimedByOther = (status === 'in_call' || Boolean(assignedAdminId)) && assignedAdminId !== resolvedAdminId;
  const isClaimedByMe = (status === 'in_call' || Boolean(assignedAdminId)) && assignedAdminId === resolvedAdminId;
  const claimedDisplayName = assignedAdminName || 'Another Dispatcher';

  const handleAnswerClick = async (targetCall) => {
    const callToAnswer = targetCall || activeCall;
    if (!callToAnswer) return;

    // Stop the ringtone immediately on click — don't wait for the
    // backend/socket round-trip to update queue status (hasRingingCall),
    // which was causing the ringtone to keep playing briefly after answering.
    stopRingtone();

    if (onAnswerRef.current) {
      await onAnswerRef.current({
        ...callToAnswer,
        citizenId: callToAnswer.citizenId || callToAnswer.channelName,
        citizenName: callToAnswer.callerName || callToAnswer.citizenName || 'Emergency Citizen',
      });
    }

    scheduleAuditLog('ANSWER_EMERGENCY_CALL', resolvedCitizenId, {
      citizenName: resolvedCitizenName,
      channelName: callToAnswer.channelName,
      answeredAt: new Date().toISOString(),
    });
  };

  const handleDeclineClick = (targetCall) => {
    const callToDecline = targetCall || activeCall;
    if (!callToDecline) return;

    if (callToDecline.channelName) {
      emitCallEnded('admins', callToDecline.channelName);
    }

    if (onDeclineRef.current) {
      onDeclineRef.current(callToDecline);
    }

    scheduleAuditLog('DECLINE_EMERGENCY_CALL', resolvedCitizenId, {
      citizenName: resolvedCitizenName,
      channelName: callToDecline.channelName,
      declinedAt: new Date().toISOString(),
    });
  };

  // If a call is already active, show a compact non-obstructive queue bar at top-right
  if (isCallActive) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, x: 50, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 50, scale: 0.95 }}
          className="fixed top-20 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-red-500/40 p-4 font-sans antialiased flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-red-400">
                Incoming Call Waiting ({queue.length})
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate text-slate-100">{resolvedCitizenName}</p>
              <p className="text-xs text-slate-400 font-mono truncate">{channelName}</p>
              {isClaimedByOther && (
                <span className="inline-block text-[11px] font-semibold text-amber-400 mt-0.5">
                  Handled by {claimedDisplayName}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => handleDeclineClick(activeCall)}
                className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors"
                title="Dismiss"
              >
                <PhoneOff className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleAnswerClick(activeCall)}
                disabled={isClaimedByOther}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  isClaimedByOther
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/40 active:scale-95'
                }`}
              >
                <Phone className="w-3.5 h-3.5" />
                <span>{isClaimedByOther ? 'Claimed' : 'Answer'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 backdrop-blur-sm text-slate-800 font-sans antialiased overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 15 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col"
        >
          {/* Header Bar */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-600 block">
                  Emergency Alert
                </span>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {queue.length > 1 ? `Incoming Call Queue (${queue.length})` : 'Incoming Call Notification'}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold animate-pulse">
              <Radio className="w-3.5 h-3.5 text-red-600" />
              <span>{hasRingingCall ? 'Live Alert' : 'In Progress'}</span>
            </div>
          </div>

          {/* Queue Tab Bar if multiple calls are pending */}
          {queue.length > 1 && (
            <div className="px-6 pt-3 pb-1 bg-slate-100 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 flex gap-2 overflow-x-auto">
              {queue.map((call, idx) => {
                const callClaimed = (call.status === 'in_call' || Boolean(call.assignedAdminId)) && call.assignedAdminId !== resolvedAdminId;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={call.channelName || idx}
                    type="button"
                    onClick={() => setSelectedIndex(idx)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 text-red-600 shadow-sm border border-slate-200 dark:border-slate-700'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <span>{call.callerName || call.citizenName || `Call #${idx + 1}`}</span>
                    {callClaimed ? (
                      <span className="w-2 h-2 rounded-full bg-amber-500" title="Claimed by dispatcher" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title="Ringing" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Body Content */}
          <div className="p-6 sm:p-8 flex flex-col items-center text-center">

            {/* Status Indicator Icon */}
            <div className="relative flex items-center justify-center my-3">
              {isClaimedByOther ? (
                <div className="relative z-10 w-20 h-20 bg-gradient-to-tr from-amber-500 to-yellow-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30 text-white">
                  <Users className="w-10 h-10" />
                </div>
              ) : (
                <>
                  <span className="absolute inline-flex h-24 w-24 rounded-full bg-red-500/20 animate-ping" />
                  <span className="absolute inline-flex h-32 w-32 rounded-full bg-red-500/10 animate-pulse" />
                  <div className="relative z-10 w-20 h-20 bg-gradient-to-tr from-rose-600 to-red-500 rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/30 text-white">
                    <PhoneCall className="w-10 h-10 animate-bounce" />
                  </div>
                </>
              )}
            </div>

            {/* Caller Information */}
            <div className="mt-4 max-w-full">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-medium mb-2">
                <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>Citizen Dispatch</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight truncate px-2">
                {resolvedCitizenName}
              </h2>

              <div className="flex items-center justify-center gap-1.5 mt-2 text-xs font-mono font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-lg w-fit mx-auto">
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                <span>Channel: {channelName}</span>
              </div>

              {/* Multi-admin Handled By Alert Banner */}
              {isClaimedByOther && (
                <div className="mt-3 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Handled by {claimedDisplayName}</span>
                </div>
              )}
            </div>

            {/* Quick Informational Note */}
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-5 max-w-sm">
              {isClaimedByOther
                ? `This call was claimed by ${claimedDisplayName}. You do not need to answer.`
                : 'An emergency call requires immediate response. Answer to join the secure channel or end the request.'}
            </p>
          </div>

          {/* Action Control Buttons */}
          <div className="px-6 py-5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">

            {/* End Call / Decline Button */}
            <button
              onClick={() => handleDeclineClick(activeCall)}
              type="button"
              className="flex-1 py-3 px-4 rounded-xl bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-800 hover:border-rose-300 dark:hover:border-rose-700 text-rose-600 dark:text-rose-400 font-bold text-sm shadow-sm transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 group"
            >
              <PhoneOff className="w-4 h-4 text-rose-600 group-hover:scale-110 transition-transform" />
              <span>{isClaimedByOther ? 'Dismiss' : 'End Call'}</span>
            </button>

            {/* Answer Call Button */}
            <button
              onClick={() => handleAnswerClick(activeCall)}
              type="button"
              disabled={isClaimedByOther}
              className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm shadow-md transition-all duration-200 flex items-center justify-center gap-2 ${
                isClaimedByOther
                  ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-500 cursor-not-allowed shadow-none'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20 active:scale-95'
              }`}
            >
              <Phone className={`w-4 h-4 ${isClaimedByOther ? 'text-slate-400' : 'text-white animate-pulse'}`} />
              <span>{isClaimedByOther ? `Handled by ${claimedDisplayName}` : 'Answer Call'}</span>
            </button>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
