import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase'; 
import { collection, onSnapshot } from 'firebase/firestore';
import Table_Wrapper from '../dashboard_midUtils/Table_Wrapper';
import Charts_Wrapper from '../dashboard_midUtils/Charts_Wrapper'; 
import { 
  parseISO, 
  isSameDay, 
  isWithinInterval, 
  startOfWeek, 
  endOfWeek,
  startOfDay,
  endOfDay 
} from 'date-fns';

// Utility helper to evaluate if a record falls within the weekly date filter window
function isReportInWeeklyFilter(report, pickerType, dateValue) {
  if (!report) return false;

  const rawTimestamp = 
    report.resolvedAt || 
    report.timestamp || 
    report.verifiedAt || 
    report.reportTimestamp || 
    report.createdAt;

  if (!rawTimestamp) return false;

  try {
    let reportDate;
    if (typeof rawTimestamp.toDate === 'function') {
      reportDate = rawTimestamp.toDate();
    } else if (typeof rawTimestamp === 'string') {
      reportDate = parseISO(rawTimestamp);
    } else {
      reportDate = new Date(rawTimestamp);
    }

    if (isNaN(reportDate.getTime())) return false;

    const isCustomFilterActive = 
      (pickerType === 'single' && dateValue) ||
      (pickerType === 'range' && dateValue?.[0]) ||
      (pickerType === 'multiple' && Array.isArray(dateValue) && dateValue.length > 0);

    // If no custom filter is picked, default to current active week window
    if (!isCustomFilterActive) {
      const now = new Date();
      const start = startOfDay(startOfWeek(now, { weekStartsOn: 0 }));
      const end = endOfDay(endOfWeek(now, { weekStartsOn: 0 }));
      return isWithinInterval(reportDate, { start, end });
    }

    if (pickerType === 'single' && dateValue) {
      return isSameDay(reportDate, dateValue);
    } 

    if (pickerType === 'multiple' && Array.isArray(dateValue)) {
      return dateValue.some(d => d && isSameDay(reportDate, d));
    } 

    if (pickerType === 'range' && dateValue[0]) {
      const start = startOfDay(dateValue[0]);
      // If end date is not yet chosen in the range picker, treat end date as end of start day
      const end = dateValue[1] ? endOfDay(dateValue[1]) : endOfDay(dateValue[0]);
      return isWithinInterval(reportDate, { start, end });
    }

    return true;
  } catch (err) {
    return false;
  }
}

export default function Dashboard_MidSection({
  activeTab,
  setActiveTab,
  metrics,
  filteredReports, // Stream from parent (Active/Incoming)
  setSelectedReport
}) {
  const [resolvedReports, setResolvedReports] = useState([]);

  // 🎯 Elevate state for Weekly Chart Filter sync
  const [weeklyPickerType, setWeeklyPickerType] = useState('range');
  const [weeklyDateValue, setWeeklyDateValue] = useState([null, null]);

  // Stream ResolvedReports locally
  useEffect(() => {
    const unsubResolved = onSnapshot(collection(db, 'ResolvedReports'), (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        source: 'resolved',
        ...doc.data(),
        status: doc.data().status || 'resolved' 
      }));
      setResolvedReports(records);
    }, (err) => {
      console.error("MidSection ResolvedReports stream error:", err);
    });

    return () => unsubResolved();
  }, []);

  // Deduplicate records to prevent duplicate processing
  const combinedMidSectionData = useMemo(() => {
    const uniqueReportsMap = new Map();

    filteredReports.forEach(report => {
      if (report.id) uniqueReportsMap.set(report.id, report);
    });

    resolvedReports.forEach(report => {
      if (report.id) {
        uniqueReportsMap.set(report.id, report);
      }
    });

    return Array.from(uniqueReportsMap.values());
  }, [filteredReports, resolvedReports]);

  // 🎯 Synchronized dataset filtered specifically by weekly chart controls
  const weeklyDateFilteredReports = useMemo(() => {
    return combinedMidSectionData.filter(report => 
      isReportInWeeklyFilter(report, weeklyPickerType, weeklyDateValue)
    );
  }, [combinedMidSectionData, weeklyPickerType, weeklyDateValue]);

  // Recalculate metrics accurately based on unique counts
  const midSectionMetrics = useMemo(() => {
    return {
      ...metrics,
      resolved: resolvedReports.length 
    };
  }, [metrics, resolvedReports]);

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* 1. Charts Layout Container — Accepts state controls */}
      <Charts_Wrapper 
        reports={combinedMidSectionData} 
        metrics={midSectionMetrics}
        weeklyPickerType={weeklyPickerType}
        setWeeklyPickerType={setWeeklyPickerType}
        weeklyDateValue={weeklyDateValue}
        setWeeklyDateValue={setWeeklyDateValue}
      />

      {/* 2. Table Feed Layout Container — Receives date-filtered data */}
      <Table_Wrapper 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        metrics={midSectionMetrics}
        filteredReports={weeklyDateFilteredReports} 
        setSelectedReport={setSelectedReport}
      />
    </div>
  );
}