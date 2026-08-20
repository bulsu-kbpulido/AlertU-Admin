import React, { useRef, useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Users, Activity } from 'lucide-react';
import { socket, joinSocketRoom, leaveSocketRoom } from '../socket';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Helper function to generate trailing hourly labels up to the current hour
const generateHourlyLabels = () => {
  const labels = [];
  const currentHour = new Date().getHours();
  
  // Generate the last 7 hours leading up to right now
  for (let i = 6; i >= 0; i--) {
    const targetHour = (currentHour - i + 24) % 24;
    const ampm = targetHour >= 12 ? 'PM' : 'AM';
    const displayHour = targetHour % 12 === 0 ? 12 : targetHour % 12;
    labels.push(`${displayHour}:00 ${ampm}`);
  }
  return labels;
};

export default function Citizen_Charts({ reports }) {
  const chartRef = useRef(null);
  
  // Real-time metrics
  const [activeUsersCount, setActiveUsersCount] = useState(0);
  const [hourlyLabels, setHourlyLabels] = useState(() => generateHourlyLabels());
  
  // Chart values start clean at 0 for every hour tracking point
  const [hourlyData, setHourlyData] = useState([0, 0, 0, 0, 0, 0, 0]);

  useEffect(() => {
    joinSocketRoom('admins');

    // Hourly tracking window update interval
    const interval = setInterval(() => {
      setHourlyLabels(generateHourlyLabels());
      // Shift data tracking along with the moving hourly window
      setHourlyData(prev => [...prev.slice(1), 0]);
    }, 60 * 60 * 1000); // Check and rotate grid windows every hour

    const handleCitizenStatusUpdate = (payload) => {
      if (payload.isActive === true) {
        // 1. Increment total overall real-time user metric instantly
        setActiveUsersCount((prev) => prev + 1);

        // 2. Increment the value of the most recent hourly index block
        setHourlyData((prevData) => {
          const updatedData = [...prevData];
          if (updatedData.length > 0) {
            updatedData[updatedData.length - 1] = updatedData[updatedData.length - 1] + 1;
          }
          return updatedData;
        });
      } else if (payload.isActive === false || payload.isDisabled === true) {
        setActiveUsersCount((prev) => Math.max(0, prev - 1));
      }
    };

    socket.on('citizen_status_updated', handleCitizenStatusUpdate);
    socket.on('citizen_updated', handleCitizenStatusUpdate);
    socket.on('citizen_deleted', () => setActiveUsersCount((prev) => Math.max(0, prev - 1)));
    socket.on('citizen_archived', () => setActiveUsersCount((prev) => Math.max(0, prev - 1)));

    return () => {
      clearInterval(interval);
      leaveSocketRoom('admins');
      socket.off('citizen_status_updated', handleCitizenStatusUpdate);
      socket.off('citizen_updated', handleCitizenStatusUpdate);
      socket.off('citizen_deleted');
      socket.off('citizen_archived');
    };
  }, []);

  const chartData = {
    labels: hourlyLabels,
    datasets: [
      {
        label: 'Active Citizens',
        data: hourlyData,
        borderColor: '#2563eb',          
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,                    
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#1d4ed8',  
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: '#0f172a',
        titleFont: { size: 12, weight: 'bold' },
        bodyFont: { size: 11 },
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: '#64748b' },
      },
      y: {
        grid: { color: 'rgba(226, 232, 240, 0.4)' },
        ticks: { 
          font: { size: 11 }, 
          color: '#64748b',
          precision: 0 // Avoid decimals since it tracks discrete increments (+1)
        },
        beginAtZero: true,
      },
    },
  };

  return (
    <div className="w-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col justify-between h-[420px] transition-all duration-300 overflow-hidden">
      
      {/* HEADER SECTION */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-600 shrink-0" />
            <h3 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-200 uppercase">
              Active Citizens Waveform
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Hourly live tracking window.
          </p>
        </div>

        {/* ACTIVE CITIZENS COUNTER */}
        <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 px-3 py-1.5 rounded-lg shrink-0">
          <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div className="flex flex-col text-right">
            <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 leading-none">
              Total Active
            </span>
            <span className="text-sm font-extrabold text-blue-600 dark:text-blue-400 leading-tight">
              {activeUsersCount}
            </span>
          </div>
        </div>
      </div>

      {/* WAVEFORM CHART CONTAINER */}
      <div className="relative w-full flex-1 min-h-0 my-2">
        <Line ref={chartRef} data={chartData} options={options} />
      </div>

      {/* FOOTER METRICS */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium flex items-center gap-1.5 truncate">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="truncate">Live Telemetry Feed</span>
        </span>
        <span className="font-semibold shrink-0 ml-2 text-slate-600 dark:text-slate-300">
          Hourly Performance
        </span>
      </div>
    </div>
  );
}