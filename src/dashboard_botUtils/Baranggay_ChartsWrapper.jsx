import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';
import Baranggay_StatisticsChart from './Baranggay_StatisticsChart';
import BaranggayRanking_Charts from './BaranggayRanking_Charts';

export default function Baranggay_ChartsWrapper({ reports = [] }) {
  const [resolvedReports, setResolvedReports] = useState([]);
  const [loadingResolved, setLoadingResolved] = useState(true);

  // Shared Time/Filter States across Statistics Chart and Ranking Table
  const [viewMode, setViewMode] = useState('monthly'); // 'monthly' | 'weekly'
  const [pickerType, setPickerType] = useState('range'); // 'range' | 'multiple' | 'single'
  const [weeklyDateValue, setWeeklyDateValue] = useState([null, null]);
  const [monthlyDateValue, setMonthlyDateValue] = useState(new Date());

  // -------------------------------------------------------------
  // 1. STRICT ACTIVE FILTERING
  // Purges any report where status is 'archived', 'trash', or 'deleted'
  // -------------------------------------------------------------
  const cleanActiveReports = useMemo(() => {
    if (!Array.isArray(reports)) return [];
    
    return reports.filter((item) => {
      if (!item) return false;
      const status = String(item.status || item.state || '').trim().toLowerCase();
      const isArchived = item.isArchived === true || item.archived === true;
      
      // Strict exclusion rule
      return !isArchived && status !== 'archived' && status !== 'trash' && status !== 'deleted';
    });
  }, [reports]);

  // -------------------------------------------------------------
  // 2. STRICT RESOLVED FILTERING
  // Ensures resolved feed also excludes anything flagged as archived
  // -------------------------------------------------------------
  const cleanResolvedReports = useMemo(() => {
    if (!Array.isArray(resolvedReports)) return [];

    return resolvedReports.filter((item) => {
      if (!item) return false;
      const status = String(item.status || '').trim().toLowerCase();
      const isArchived = item.isArchived === true || item.archived === true;

      return !isArchived && status !== 'archived' && status !== 'trash' && status !== 'deleted';
    });
  }, [resolvedReports]);

  // Centralized Fetch for Resolved Reports (API First -> Firestore Fallback)
  useEffect(() => {
    let isMounted = true;
    setLoadingResolved(true);

    const fetchResolvedData = async () => {
      try {
        // 1. Try Express API backend first
        const res = await fetch('http://localhost:3000/api/resolved-incidents');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        
        const data = await res.json();
        const rawList = Array.isArray(data) 
          ? data 
          : (data && data.success && Array.isArray(data.data)) 
            ? data.data 
            : [];

        if (rawList.length > 0 && isMounted) {
          const normalized = rawList.map((item, index) => ({
            ...item,
            id: item.id || item._id || item.docId || `resolved-${index}`,
            _isResolvedFeedItem: true,
            collectionSource: 'ResolvedReports',
            status: item.status || 'resolved'
          }));
          setResolvedReports(normalized);
          setLoadingResolved(false);
          return;
        }
      } catch (err) {
        console.warn("API Endpoint unavailable, falling back directly to Firestore 'ResolvedReports':", err.message);
      }

      // 2. Direct Firestore Fallback for 'ResolvedReports' collection
      try {
        const snap = await getDocs(collection(db, 'ResolvedReports'));
        if (isMounted) {
          const docs = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            _isResolvedFeedItem: true,
            collectionSource: 'ResolvedReports',
            status: doc.data().status || 'resolved'
          }));
          setResolvedReports(docs);
        }
      } catch (firestoreErr) {
        console.error("Error reading ResolvedReports directly from Firestore:", firestoreErr);
      } finally {
        if (isMounted) setLoadingResolved(false);
      }
    };

    fetchResolvedData();

    return () => { isMounted = false; };
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* TOP: Interactive Stacked Bar Chart & Main Controls */}
      <div className="w-full">
        <Baranggay_StatisticsChart 
          reports={cleanActiveReports}
          resolvedReports={cleanResolvedReports}
          isLoadingResolved={loadingResolved}
          viewMode={viewMode}
          setViewMode={setViewMode}
          pickerType={pickerType}
          setPickerType={setPickerType}
          weeklyDateValue={weeklyDateValue}
          setWeeklyDateValue={setWeeklyDateValue}
          monthlyDateValue={monthlyDateValue}
          setMonthlyDateValue={setMonthlyDateValue}
        />
      </div>

      {/* BOTTOM: Top Barangay Rankings Table */}
      <div className="w-full">
        <BaranggayRanking_Charts 
          reports={cleanActiveReports}
          resolvedReports={cleanResolvedReports}
          isLoadingResolved={loadingResolved}
          viewMode={viewMode}
          pickerType={pickerType}
          weeklyDateValue={weeklyDateValue}
          monthlyDateValue={monthlyDateValue}
        />
      </div>
    </div>
  );
}