import React from 'react';

export default function Top_Baranggay_Statistics({ filteredReports = [] }) {
  // Aggregate report frequencies by location/barangay
  const barangayCounts = filteredReports.reduce((acc, report) => {
    const barangay = report.location?.trim() || 'Unassigned / Unknown';
    acc[barangay] = (acc[barangay] || 0) + 1;
    return acc;
  }, {});

  // Transform into a sorted array (highest counts first)
  const sortedBarangays = Object.entries(barangayCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5); // Pick the top 5 hotspots

  // Find the highest count to compute relative percentage widths for the progress bars
  const maxCount = sortedBarangays[0]?.count || 1;

  return (
    <div className="w-full h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl overflow-hidden font-['Montserrat',sans-serif] flex flex-col justify-between">
      <div>
        {/* Header matching ReportsTableFeed style */}
        <div className="p-3 pb-2 border-b bg-white dark:bg-slate-900 flex items-center justify-between h-[53px]">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Incident Hotspots
          </h3>
          <span className="text-[9px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md uppercase tracking-wider font-bold">
            Top Barangay
          </span>
        </div>

        {/* Content Area */}
        <div className="p-4">
          {sortedBarangays.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-[10px] font-mono text-slate-400 dark:text-slate-600 animate-pulse">
              Awaiting streaming analytical data...
            </div>
          ) : (
            <div className="space-y-4">
              {sortedBarangays.map((bg, idx) => {
                const percentage = (bg.count / maxCount) * 100;
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[180px]">
                        {bg.name}
                      </span>
                      <span className="font-mono font-bold text-slate-900 dark:text-indigo-400 bg-slate-50 dark:bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-800/40">
                        {bg.count} {bg.count === 1 ? 'case' : 'cases'}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer matching ReportsTableFeed concept */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/20 flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span>Active Scope Feed</span>
        <span className="font-bold text-slate-500 dark:text-slate-400">Total: {filteredReports.length}</span>
      </div>
    </div>
  );
}