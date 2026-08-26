import React from 'react';
import Active_Reports from './Active_Reports';
import Pending_Reports from './Pending_Reports';
import Resolved_Reports from './Resolved_Reports';
import Archived_Reports from './Archived_Reports';
import DashAction_Buttons from './DashAction_Buttons';

// 1. 🎯 ADD 'reports' TO YOUR DESTRUCTURED PROPS HERE
export default function MetricsGrid({ metrics, onRefresh, isLoading, reports = [] }) {
  
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5 sm:gap-4 lg:gap-4 2xl:gap-5 items-stretch">
      {/* Dynamic Active Incident Metric Card Node */}
      <Active_Reports />

      {/* Dynamic Pending Triage Pipeline Card Node */}
      <Pending_Reports />

      {/* Dynamic Resolved Historical Archives Card Node */}
      <Resolved_Reports variant="grid-card" />

      {/* Dynamic Combined Archival Manifest Total Summary Card Node */}
      <Archived_Reports variant="grid-card" />

      {/* Dashboard Quick Actions Card Node */}
      <DashAction_Buttons 
        onRefresh={onRefresh} 
        isLoading={isLoading} 
        // 2. 🎯 PASS IT DIRECTLY INTO YOUR BUTTONS COMPONENT
        reports={reports} 
      />
    </div>
  );
}