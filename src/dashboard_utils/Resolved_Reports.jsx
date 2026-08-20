import React, { useState, useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { io } from 'socket.io-client';
import { CheckCircle2, Loader2, Wifi } from 'lucide-react';

// Live Render backend base URL
const SOCKET_SERVER_URL = 'https://alertu-server.onrender.com';
const API_BASE_URL = `${SOCKET_SERVER_URL}/api`;

// --- Shadcn UI Card Components ---
const Card = ({ className = '', ...props }) => (
  <div
    className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-950 dark:text-slate-50 shadow-sm transition-all duration-200 hover:shadow-md ${className}`}
    {...props}
  />
);

const CardContent = ({ className = '', ...props }) => (
  <div className={`p-4 ${className}`} {...props} />
);

// --- Magic UI Number Ticker Component ---
const NumberTicker = ({ value = 0, className = '' }) => {
  const spring = useSpring(0, { mass: 0.8, stiffness: 75, damping: 15 });
  const display = useTransform(spring, (current) => Math.round(current).toLocaleString());

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return <motion.span className={className}>{display}</motion.span>;
};

export default function Resolved_Reports() {
  const [resolvedCount, setResolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);

  const fetchResolvedCount = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/reports?view=resolved`);
      const json = await response.json();
      if (json.success) {
        setResolvedCount(json.data?.length || 0);
      }
    } catch (err) {
      console.error("Failed to sync resolved reports:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial Fetch & Polling Fallback
    fetchResolvedCount();
    const interval = setInterval(fetchResolvedCount, 30000);

    // Socket.IO Realtime Listener Setup with Render backend
    const socket = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      setIsLive(true);
    });

    socket.on('disconnect', () => {
      setIsLive(false);
    });

    // Real-time events listener
    const handleReportChange = () => {
      fetchResolvedCount();
    };

    socket.on('report_resolved', handleReportChange);
    socket.on('report_updated', handleReportChange);
    socket.on('report_archived', handleReportChange);
    socket.on('report_deleted', handleReportChange);

    return () => {
      clearInterval(interval);
      socket.off('report_resolved', handleReportChange);
      socket.off('report_updated', handleReportChange);
      socket.off('report_archived', handleReportChange);
      socket.off('report_deleted', handleReportChange);
      socket.disconnect();
    };
  }, []);

  return (
    <Card className="h-full w-full font-['Roboto',sans-serif] overflow-hidden">
      <CardContent className="h-full flex items-center justify-between">
        
        {/* Left Column: Label, Big Number, & Sub-label */}
        <div className="min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Resolved Reports
            </p>
            {/* Live Connection Badge */}
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${
                isLive
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              <Wifi className={`h-2.5 w-2.5 ${isLive ? 'animate-pulse text-emerald-500' : 'text-slate-400'}`} />
              {isLive ? 'LIVE' : 'SYNC'}
            </span>
          </div>

          <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight my-1.5 leading-none">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 text-slate-400 text-sm font-normal py-1">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                <span>Loading...</span>
              </span>
            ) : (
              <NumberTicker value={resolvedCount} />
            )}
          </h3>

          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 truncate">
            Completed incidents
          </p>
        </div>

        {/* Right Side Icon */}
        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0 ml-4 border border-emerald-100 dark:border-emerald-900/40">
          <CheckCircle2 className="h-6 w-6" />
        </div>

      </CardContent>
    </Card>
  );
}