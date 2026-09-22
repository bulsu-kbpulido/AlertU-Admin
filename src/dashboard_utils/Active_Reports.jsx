import React, { useState, useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { io } from 'socket.io-client';
import { Loader2 } from 'lucide-react';

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

export default function Active_Reports() {
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchActiveCount = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/reports?view=approved`);
      const json = await response.json();
      if (json.success) {
        setActiveCount(json.data?.length || 0);
      }
    } catch (err) {
      console.error("Failed to sync active reports:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial Fetch & Polling Fallback
    fetchActiveCount();
    const interval = setInterval(fetchActiveCount, 30000);

    // Socket.IO Realtime Listener Setup with Railway backend
    // (No longer drives a per-card LIVE/SYNC badge — connection status is now
    // shown once, in the Navbar, next to the clock — but the socket itself is
    // still needed here to trigger instant refetches on report events.)
    const socket = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });

    // Real-time events listener
    const handleReportChange = () => {
      fetchActiveCount();
    };

    socket.on('report_updated', handleReportChange);
    socket.on('report_approved', handleReportChange);
    socket.on('report_resolved', handleReportChange);
    socket.on('report_archived', handleReportChange);

    return () => {
      clearInterval(interval);
      socket.off('report_updated', handleReportChange);
      socket.off('report_approved', handleReportChange);
      socket.off('report_resolved', handleReportChange);
      socket.off('report_archived', handleReportChange);
      socket.disconnect();
    };
  }, []);

  return (
    <Card className="h-full w-full font-['Roboto',sans-serif] overflow-hidden">
      <CardContent className="h-full flex items-center justify-between">
        
        {/* Left Column: Label, Big Number, & Sub-label */}
        <div className="min-w-0 flex flex-col justify-center">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Verified Reports
          </p>

          <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight my-1.5 leading-none">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 text-slate-400 text-sm font-normal py-1">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                <span>Loading...</span>
              </span>
            ) : (
              <NumberTicker value={activeCount} />
            )}
          </h3>

          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 truncate">
            Approved, not yet resolved
          </p>
        </div>

      </CardContent>
    </Card>
  );
}
