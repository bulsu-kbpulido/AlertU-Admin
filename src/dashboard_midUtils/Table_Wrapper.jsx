import React from 'react';
import ReportsTableFeed from '../dashboard_utils/ReportsTableFeed';

export default function Table_Wrapper({
  activeTab,
  setActiveTab,
  metrics,
  filteredReports, // Receives the combined set from Dashboard_MidSection
  setSelectedReport
}) {
  return (
    <div className="w-full">
      <ReportsTableFeed 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        metrics={metrics}
        filteredReports={filteredReports}
        setSelectedReport={setSelectedReport}
      />
    </div>
  );
}