import React, { useMemo } from 'react';
import Baranggay_ChartsWrapper from '@/dashboard_botUtils/Baranggay_ChartsWrapper';

export default function Dashboard_BottomSection({ 
  reports = [], 
  filteredReports = null,
  ...restProps 
}) {
  // Pure active dataset: strictly exclude 'archived' or 'resolved' reports
  const activeReports = useMemo(() => {
    // 1. Determine base source (use filtered reports if available, else fallback to full reports)
    const baseSource = (Array.isArray(filteredReports) && filteredReports.length > 0)
      ? filteredReports
      : (Array.isArray(reports) ? reports : []);

    // 2. HARD FILTER: Exclude archived and resolved statuses completely
    return baseSource.filter((report) => {
      if (!report) return false;
      const status = String(report.status || '').toLowerCase();
      
      // Keep only truly active/pending items
      return status !== 'archived' && status !== 'resolved';
    });
  }, [reports, filteredReports]);

  return (
    <section className="w-full">
      <Baranggay_ChartsWrapper 
        reports={activeReports} 
        {...restProps}
      />
    </section>
  );
}