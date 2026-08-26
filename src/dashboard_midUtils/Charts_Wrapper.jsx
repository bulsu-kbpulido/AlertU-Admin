import React from 'react';
import Weekly_ReportCharts from './Weekly_ReportCharts';
import Monthly_ReportCharts from './Monthly_ReportCharts';

export default function Charts_Wrapper({ 
  reports = [], 
  metrics,
  weeklyPickerType,
  setWeeklyPickerType,
  weeklyDateValue,
  setWeeklyDateValue
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 w-full items-stretch">
      {/* 7 Columns on Desktop: Weekly Telemetry */}
      <div className="lg:col-span-7 w-full flex flex-col">
        <Weekly_ReportCharts 
          reports={reports} 
          pickerType={weeklyPickerType}
          setPickerType={setWeeklyPickerType}
          dateValue={weeklyDateValue}
          setDateValue={setWeeklyDateValue}
        />
      </div>

      {/* 5 Columns on Desktop: Monthly Incident Breakdown */}
      <div className="lg:col-span-5 w-full flex flex-col">
        <Monthly_ReportCharts reports={reports} />
      </div>
    </div>
  );
}