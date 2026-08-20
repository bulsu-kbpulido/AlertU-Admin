import React, { useEffect, useRef, useState, useCallback } from 'react';
import AgoraRTC from 'agora-rtc-sdk-ng';
import { motion, AnimatePresence } from 'framer-motion';
import { joinSocketRoom, leaveSocketRoom, emitCallEnded, getSocket } from '../socket';

// Lucide React Icons
import { 
  Mic, 
  MicOff, 
  PhoneOff, 
  Minimize2, 
  Maximize2, 
  Clock, 
  ShieldAlert, 
  User, 
  AlertCircle,
  Radio,
  GripHorizontal,
  VideoOff
} from 'lucide-react';

// Enable console logging for development debugging
AgoraRTC.setLogLevel(1);

const CALL_TIME_LIMIT_SECONDS = 120; // 5 Minutes Limit

/**
 * Admin Emergency Call Modal - Fixed 360p Video Resolution
 */
export default function AdminCallModal({ targetRoom, citizenName: initialCitizenName, citizenId: initialCitizenId, adminId, adminName, onClose, backendUrl }) {
  const remoteVideoRef = useRef(null);

  // Core references
  const agoraClientRef = useRef(null);
  const localTracksRef = useRef({ micTrack: null });
  const isInitializingRef = useRef(false);
  
  // Dynamic citizen info state
  const [citizenInfo, setCitizenInfo] = useState({
    citizenId: initialCitizenId || '',
    citizenName: initialCitizenName || 'Unknown Citizen',
  });

  // Sync state if props change dynamically
  useEffect(() => {
    setCitizenInfo({
      citizenId: initialCitizenId || '',
      citizenName: initialCitizenName || 'Unknown Citizen',
    });
  }, [initialCitizenId, initialCitizenName]);

  // Track Call Start Time for Duration calculation
  const callStartTimeRef = useRef(null);

  // State management
  const [remoteUser, setRemoteUser] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isRemoteVideoMuted, setIsRemoteVideoMuted] = useState(false);
  const [callConnected, setCallConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // ⏱️ 5-MINUTE TIMER STATE
  const [timeLeft, setTimeLeft] = useState(CALL_TIME_LIMIT_SECONDS);

  // 🔲 MINIMIZE & DRAG STATES
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });

  // Keep stable reference for onClose callback
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // 💾 RECORD CALL HISTORY TO FIRESTORE
  const saveCallHistory = useCallback(async (endedByReason = 'admin') => {
    const resolvedBackendUrl = backendUrl || import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';
    
    let durationSeconds = 0;
    if (callStartTimeRef.current) {
      durationSeconds = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
    }

    try {
      await fetch(`${resolvedBackendUrl}/api/call-history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelName: targetRoom,
          citizenName: citizenInfo.citizenName || 'Unknown Citizen',
          citizenId: citizenInfo.citizenId || null,
          adminId: adminId || null,
          adminName: adminName || 'Dispatcher',
          duration: durationSeconds,
          endedBy: endedByReason,
          status: durationSeconds > 0 ? 'completed' : 'missed',
          callType: 'emergency_video'
        }),
      });
      console.log('📝 Call history recorded in backend/Firestore successfully.');
    } catch (err) {
      console.error('❌ Failed to save call history to backend:', err);
    }
  }, [backendUrl, targetRoom, citizenInfo, adminId, adminName]);

  // Clean up media tracks and unmount RTC client cleanly
  const leaveCallCleanup = useCallback(async () => {
    try {
      const { micTrack } = localTracksRef.current;
      if (micTrack) {
        micTrack.stop();
        micTrack.close();
      }
      localTracksRef.current = { micTrack: null };

      if (agoraClientRef.current) {
        agoraClientRef.current.removeAllListeners();
        if (
          agoraClientRef.current.connectionState === 'CONNECTED' ||
          agoraClientRef.current.connectionState === 'CONNECTING'
        ) {
          await agoraClientRef.current.leave();
        }
        agoraClientRef.current = null;
      }
    } catch (err) {
      console.error("❌ Error during Agora call cleanup:", err);
    } finally {
      setCallConnected(false);
      setRemoteUser(null);
      setIsRemoteVideoMuted(false);
    }
  }, []);

  // Handle End Call Action & Save Record
  const handleEndCall = useCallback(async (endedByReason = 'admin') => {
    if (targetRoom) {
      emitCallEnded(targetRoom, targetRoom);
      leaveSocketRoom(targetRoom);
    }
    
    // Save history to backend / Firestore endpoint
    await saveCallHistory(endedByReason);
    await leaveCallCleanup();
    
    if (onCloseRef.current) onCloseRef.current();
  }, [targetRoom, leaveCallCleanup, saveCallHistory]);

  // 🔒 Real-time Socket Event Listener (End Call Signals & Emergency Alerts)
  useEffect(() => {
    const socket = getSocket?.();
    if (!socket) return;

    // Listen for citizen ending the call remotely via Socket.IO
    const handleCallEndedSignal = (data) => {
      const incomingChannel = typeof data === 'string' ? data : data?.channelName || data?.targetRoom;
      if (!incomingChannel || incomingChannel === targetRoom) {
        console.log('⏹️ Remote end call signal received via socket. Closing modal...');
        handleEndCall('citizen');
      }
    };

    const handleEmergencyAlert = (data) => {
      if (data?.channelName === targetRoom || (data?.citizenId && data?.citizenId === citizenInfo.citizenId)) {
        console.warn('🚨 Emergency or Account Deactivation Signal Received for current call:', data);
        handleEndCall('account_deactivated');
      }
    };

    socket.on('callEnded', handleCallEndedSignal);
    socket.on('call_ended', handleCallEndedSignal);
    socket.on('admin:emergency_alert', handleEmergencyAlert);
    socket.on('citizen_deactivated', handleEmergencyAlert);

    return () => {
      socket.off('callEnded', handleCallEndedSignal);
      socket.off('call_ended', handleCallEndedSignal);
      socket.off('admin:emergency_alert', handleEmergencyAlert);
      socket.off('citizen_deactivated', handleEmergencyAlert);
    };
  }, [targetRoom, citizenInfo.citizenId, handleEndCall]);

  // ⏱️ 5-MINUTE COUNTDOWN TIMER EFFECT
  useEffect(() => {
    let timerInterval = null;

    if (callConnected) {
      if (!callStartTimeRef.current) {
        callStartTimeRef.current = Date.now(); // Record call start moment
      }

      timerInterval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerInterval);
            console.log("⏱️ Call duration limit reached. Terminating call...");
            handleEndCall('timer_timeout'); // Auto terminate with timeout reason
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setTimeLeft(CALL_TIME_LIMIT_SECONDS); // Reset timer if not connected
    }

    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [callConnected, handleEndCall]);

  // Helper to format remaining seconds into MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Main Call Initialization & Teardown Effect
  useEffect(() => {
    let isMounted = true;

    if (!targetRoom || isInitializingRef.current) return;
    isInitializingRef.current = true;

    joinSocketRoom(targetRoom);
    const resolvedBackendUrl = backendUrl || import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    agoraClientRef.current = client;

    const handleUserPublished = async (user, mediaType) => {
      try {
        await client.subscribe(user, mediaType);
        
        if (mediaType === 'video' && isMounted) {
          // Force high-stream 360p remote stream decoding (Stream type 0 = High stream)
          try {
            await client.setRemoteVideoStreamType(user.uid, 0);
          } catch (e) {
            console.warn("Could not set explicit remote video stream type:", e);
          }

          setRemoteUser(user);
          setIsRemoteVideoMuted(false);
          setCallConnected(true);
        }

        if (mediaType === 'audio') {
          user.audioTrack?.play();
        }
      } catch (subErr) {
        console.error("❌ Subscription error:", subErr);
      }
    };

    const handleUserUnpublished = (user, mediaType) => {
      if (mediaType === 'video' && isMounted) {
        setIsRemoteVideoMuted(true);
      }
    };

    const handleUserLeft = () => {
      if (isMounted) {
        console.log("👤 Citizen disconnected from RTC channel. Ending call...");
        handleEndCall('citizen');
      }
    };

    const initAgoraCall = async () => {
      try {
        if (isMounted) setErrorMessage(null);

        // 1. Fetch Token with citizen parameters
        const tokenUrl = `${resolvedBackendUrl}/api/agora-token?channelName=${encodeURIComponent(targetRoom)}&citizenId=${encodeURIComponent(citizenInfo.citizenId || '')}&callerName=${encodeURIComponent(citizenInfo.citizenName || '')}`;
        const res = await fetch(tokenUrl);
        if (!res.ok) throw new Error(`Token endpoint HTTP error: ${res.status}`);

        const { token, appId } = await res.json();
        if (!token || !appId) throw new Error("Invalid Agora credentials received from server.");

        // 2. Event Listeners
        client.on('user-published', handleUserPublished);
        client.on('user-unpublished', handleUserUnpublished);
        client.on('user-left', handleUserLeft);

        // 3. Join Channel
        await client.join(appId, targetRoom, token, null);

        if (!isMounted) {
          await client.leave();
          return;
        }

        // 4. Create Microphone Track Only (Admin does not publish camera)
        let micTrack = null;
        try {
          micTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: "speech_low_quality" });
        } catch (audioErr) {
          throw new Error("Microphone access denied. Check device permissions.");
        }

        localTracksRef.current = { micTrack };

        // 5. Publish Admin Mic Track
        if (micTrack) {
          await client.publish([micTrack]);
        }

      } catch (err) {
        console.error("❌ Failed to initiate Agora call:", err);
        if (isMounted) {
          setErrorMessage(err.message || "Failed to initialize call.");
        }
      }
    };

    initAgoraCall();

    return () => {
      isMounted = false;
      isInitializingRef.current = false;
      leaveCallCleanup();
      if (targetRoom) leaveSocketRoom(targetRoom);
    };
  }, [targetRoom, backendUrl, citizenInfo, leaveCallCleanup, handleEndCall]);

  // Attach Remote Citizen Video Stream when available
  useEffect(() => {
    if (remoteUser?.videoTrack && remoteVideoRef.current && !isRemoteVideoMuted) {
      remoteUser.videoTrack.play(remoteVideoRef.current);
    }
  }, [remoteUser, isRemoteVideoMuted]);

  // Handle Mute/Unmute Mic Toggle
  const handleToggleMute = async () => {
    const mic = localTracksRef.current.micTrack;
    if (mic) {
      const nextState = !isMuted;
      await mic.setEnabled(!nextState);
      setIsMuted(nextState);
    }
  };

  // 🖱️ SMOOTH DRAGGING LOGIC
  const handleMouseDown = (e) => {
    if (!isMinimized) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !isMinimized) return;

    let newX = e.clientX - dragStartRef.current.x;
    let newY = e.clientY - dragStartRef.current.y;

    const widgetWidth = 340;
    const widgetHeight = 280;
    const maxX = window.innerWidth - widgetWidth - 12;
    const maxY = window.innerHeight - widgetHeight - 12;

    newX = Math.max(12, Math.min(newX, maxX));
    newY = Math.max(12, Math.min(newY, maxY));

    setPosition({ x: newX, y: newY });
  }, [isDragging, isMinimized]);

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove]);

  return (
    <AnimatePresence>
      <div
        className={
          isMinimized
            ? "fixed z-50 touch-none select-none"
            : "fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 backdrop-blur-sm text-slate-800 font-sans antialiased overflow-y-auto"
        }
        style={
          isMinimized
            ? {
                left: `${position.x}px`,
                top: `${position.y}px`,
              }
            : {}
        }
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={isDragging ? { duration: 0 } : { duration: 0.2 }}
          className={`relative bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 ${
            isMinimized 
              ? 'w-[340px] border-2 border-slate-300 shadow-xl' 
              : 'w-full max-w-5xl max-h-[92vh]'
          }`}
        >
          {/* Dedicated Drag Bar Header when Minimized */}
          {isMinimized ? (
            <div
              onMouseDown={handleMouseDown}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200/80 border-b border-slate-200 flex items-center justify-between cursor-grab active:cursor-grabbing transition-colors"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 truncate">
                <GripHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="truncate">{citizenInfo.citizenName || targetRoom}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {callConnected && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white text-[11px] font-mono font-bold text-slate-700 border border-slate-200">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>{formatTime(timeLeft)}</span>
                  </div>
                )}
                <button
                  onClick={() => setIsMinimized(false)}
                  className="p-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition active:scale-95"
                  title="Expand View"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            /* Standard Full Modal Header */
            <header className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/90 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 truncate">
                <div className="p-2 rounded-xl bg-red-50 border border-red-200 text-red-600 shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="truncate">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-600">
                      Emergency Call (360p)
                    </span>
                    {callConnected ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Live Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
                        Connecting...
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight mt-0.5 truncate">
                    {citizenInfo.citizenName || targetRoom}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {callConnected && (
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-bold border transition-colors ${
                      timeLeft <= 60
                        ? 'bg-rose-50 text-rose-600 border-rose-200 animate-pulse'
                        : 'bg-white text-slate-700 border-slate-200 shadow-sm'
                    }`}
                    title="Call Limit Countdown"
                  >
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{formatTime(timeLeft)}</span>
                  </div>
                )}

                <button
                  onClick={() => setIsMinimized(true)}
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition-all shadow-sm active:scale-95"
                  title="Minimize View"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </header>
          )}

          {/* Main Video Viewport (Enforces 360p Aspect Dimensions) */}
          <div className="flex-1 bg-slate-950 relative overflow-hidden flex items-center justify-center">
            <div
              className={`relative w-full aspect-[16/9] transition-all duration-300 ${
                isMinimized ? 'h-40' : 'h-[50vh] sm:h-[60vh] min-h-[380px]'
              }`}
            >
              {/* Remote Citizen Stream */}
              <div
                ref={remoteVideoRef}
                className={`w-full h-full object-cover [&>div]:!w-full [&>div]:!h-full [&>video]:!w-full [&>video]:!h-full [&>video]:!object-cover ${
                  isRemoteVideoMuted ? 'hidden' : 'block'
                }`}
              />

              {/* Citizen Disabled Camera State Overlay */}
              {callConnected && isRemoteVideoMuted && !errorMessage && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900 text-slate-400 p-4 text-center">
                  <VideoOff className="w-10 h-10 text-slate-500 mb-2" />
                  <p className="text-xs font-semibold text-slate-300">Citizen Camera Disabled</p>
                </div>
              )}

              {/* Connecting Overlay */}
              {!callConnected && !errorMessage && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/90 text-white p-2">
                  <div className="w-8 h-8 border-3 border-red-500 border-t-transparent rounded-full animate-spin mb-2" />
                  <p className="text-xs font-semibold text-slate-200">Connecting...</p>
                </div>
              )}

              {/* Error Overlay */}
              {errorMessage && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/95 text-rose-400 p-4 text-center">
                  <AlertCircle className="w-8 h-8 text-rose-500 mb-1" />
                  <p className="text-xs font-bold text-white mb-1">Call Error</p>
                  <button
                    onClick={() => handleEndCall('error')}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-semibold rounded-lg transition border border-slate-700"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Action Control Bar (Footer) */}
          <footer
            className={`bg-slate-50 border-t border-slate-200 flex items-center justify-center ${
              isMinimized ? 'p-2.5' : 'px-6 py-4 sm:justify-between'
            }`}
          >
            {/* Desktop Status Label (Full View) */}
            {!isMinimized && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600 font-medium">
                <User className="text-blue-600 w-4 h-4" />
                <span>Admin: <strong className="text-slate-800">{adminName || 'System Admin'}</strong></span>
              </div>
            )}

            {/* Centered Button Controls */}
            <div className="flex items-center justify-center gap-3 w-full sm:w-auto">
              {/* Mic Toggle Button */}
              <button
                type="button"
                onClick={handleToggleMute}
                className={`inline-flex items-center justify-center font-bold transition-all rounded-xl shadow-sm border active:scale-95 ${
                  isMinimized ? 'w-10 h-10 p-0' : 'px-4 py-2.5 text-xs'
                } ${
                  isMuted
                    ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
                title={isMuted ? "Unmute Mic" : "Mute Mic"}
              >
                {isMuted ? <MicOff className="w-4 h-4 text-rose-600" /> : <Mic className="w-4 h-4 text-slate-600" />}
                {!isMinimized && <span className="ml-2">{isMuted ? 'Unmute' : 'Mute'}</span>}
              </button>

              {/* End Call Button */}
              <button
                type="button"
                onClick={() => handleEndCall('admin')}
                className={`inline-flex items-center justify-center font-bold uppercase tracking-wider text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-md transition-all active:scale-95 ${
                  isMinimized ? 'w-11 h-10 p-0' : 'px-6 py-2.5 text-xs'
                }`}
                title="End Call"
              >
                <PhoneOff className="w-4 h-4" />
                {!isMinimized && <span className="ml-2">End Call</span>}
              </button>
            </div>

            {/* Desktop Security Label (Full View) */}
            {!isMinimized && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                <span>Encrypted RTC Channel</span>
              </div>
            )}
          </footer>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}