import React, { useState, useEffect } from 'react';
import { db } from '../firebase'; 
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import MetricsGrid from './MetricsGrid';
import DashboardMap from './DashboardMap';
import ReportDetailsPanel from './ReportDetailsPanel';
import ReportsTableFeed from './ReportsTableFeed';

export default function FirebaseDashboard() {
  const [activeTab, setActiveTab] = useState('pending');
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);

  // Live Firebase Stream
  useEffect(() => {
    const q = query(collection(db, 'reports'), orderBy('timestamp', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const liveData = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        liveData.push({
          id: doc.id,
          citizen: data.citizen || '', 
          phone: data.phone || '',
          type: data.type || 'others',
          label: data.label || '',
          location: data.location || '',
          coords: data.coords || null,
          radius: data.radius || null,
          status: data.status || 'pending',
          isSensitive: data.isSensitive || false,
          time: data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
        });
      });
      setReports(liveData);
      setLoading(false);
    }, (error) => {
      console.error("Firebase stream connection error: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredReports = reports.filter(r => r.status === activeTab);

  const metrics = {
    pending: reports.filter(r => r.status === 'pending').length,
    approved: reports.filter(r => r.status === 'approved').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
  };

  if (loading) {
    return <div className="text-xs font-mono p-6">Listening to live Firestore stream...</div>;
  }

  return (
    <div className="w-full space-y-6 font-sans">
      {/* 1. Metrics Layout */}
      <MetricsGrid metrics={metrics} />

      {/* 2. Operational Map Map View & Context Details Block */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DashboardMap 
            filteredReports={filteredReports} 
            selectedReport={selectedReport} 
          />
        </div>
        <ReportDetailsPanel selectedReport={selectedReport} />
      </div>

      {/* 3. Stream Queues Feed */}
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