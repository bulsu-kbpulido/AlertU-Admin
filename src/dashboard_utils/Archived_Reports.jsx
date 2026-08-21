import React, { useState, useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { io } from 'socket.io-client';
import { Archive, Loader2, Wifi } from 'lucide-react';

// Live Railway backend base URL
const SOCKET_SERVER_URL = 'https://alertu-server-production.up.railway.app';
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

export default function Archived_Reports() {
  const [approvedCount, setApprovedCount] = useState(0);
  const [generalCount, setGeneralCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);

  const fetchArchivedCounts = async () => {
    try {
      // Fetch both archived collections in parallel from Railway API
      const [approvedRes, generalRes] = await Promise.all([
        fetch(`${API_BASE_URL}/archived-approved`),
        fetch(`${API_BASE_URL}/reports?view=archived`)
      ]);

      const approvedJson = await approvedRes.json();
      const generalJson = await generalRes.json();

      if (approvedJson.success) {
        setApprovedCount(approvedJson.data?.length || 0);
      }
      if (generalJson.success) {
        setGeneralCount(generalJson.data?.length || 0);
      }
    } catch (err) {
      console.error("Failed to sync archived reports:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial Fetch & Polling Fallback
    fetchArchivedCounts();
    const interval = setInterval(fetchArchivedCounts, 30000);

    // Socket.IO Realtime Listener Setup with Railway backend
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
    const handleArchivedChange = () => {
      fetchArchivedCounts();
    };

    socket.on('report_archived', handleArchivedChange);
    socket.on('report_updated', handleArchivedChange);
    socket.on('report_deleted', handleArchivedChange);

    return () => {
      clearInterval(interval);
      socket.off('report_archived', handleArchivedChange);
      socket.off('report_updated', handleArchivedChange);
      socket.off('report_deleted', handleArchivedChange);
      socket.disconnect();
    };
  }, []);

  const combinedTotal = approvedCount + generalCount;

  return (
    <Card className="h-full w-full font-['Roboto',sans-serif] overflow-hidden">
      <CardContent className="h-full flex items-center justify-between">
        
        {/* Left Column: Label, Big Number, & Sub-label */}
        <div className="min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Archived Reports
            </p>
            {/* Live Connection Badge */}
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${
                isLive
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              <Wifi className={`h-2.5 w-2.5 ${isLive ? 'animate-pulse text-slate-600 dark:text-slate-300' : 'text-slate-400'}`} />
              {isLive ? 'LIVE' : 'SYNC'}
            </span>
          </div>

          <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight my-1.5 leading-none">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 text-slate-400 text-sm font-normal py-1">
                <Loader2 className="h-5 w-5 animate-spin text-slate-600 dark:text-slate-400" />
                <span>Loading...</span>
              </span>
            ) : (
              <NumberTicker value={combinedTotal} />
            )}
          </h3>

          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
            <span className="text-blue-600 dark:text-blue-400">{approvedCount} Appr.</span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span className="text-amber-600 dark:text-amber-400">{generalCount} Gen.</span>
          </p>
        </div>

        {/* Right Side Icon */}
        <div className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl shrink-0 ml-4 border border-slate-200 dark:border-slate-700">
          <Archive className="h-6 w-6" />
        </div>

      </CardContent>
    </Card>
  );
}