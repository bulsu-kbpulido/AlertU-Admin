import { create } from 'zustand';
import { db } from './firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const PHILIPPINE_TIMEZONE = 'Asia/Manila';

// Helper to extract timestamp millis
const getEpochMillis = (raw) => {
  if (!raw) return 0;
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (typeof raw.toDate === 'function') return raw.toDate().getTime();
  if (typeof raw === 'object' && raw.seconds) return raw.seconds * 1000;
  const parsed = new Date(raw).getTime();
  return isNaN(parsed) ? 0 : parsed;
};

// Icon resolver for incident markers
export const resolveIconFromType = (typeStr) => {
  if (!typeStr) return 'warnicon.png';
  const clean = String(typeStr).toLowerCase().trim();
  if (clean.includes('fire')) return 'fireicon.png';
  if (clean.includes('flood') || clean.includes('water')) return 'floodicon.png';
  if (clean.includes('acc') || clean.includes('car') || clean.includes('crash')) return 'accicon.png';
  if (clean.includes('quake') || clean.includes('earthquake')) return 'quakeicon.png';
  return 'warnicon.png';
};

// Check if report is resolved, rejected, archived, or duplicate (NOT active)
export const isNonActiveReport = (report) => {
  if (!report) return true;

  const status = String(report.status || '').toLowerCase().trim();

  // Current active status takes precedence over legacy resolution metadata.
  if (
    status === 'verified' ||
    status === 'approved' ||
    status === 'active' ||
    status === 'pending'
  ) {
    return false;
  }

  const source = String(report.source || '').toLowerCase().trim();

  return (
    status === 'resolved' ||
    status === 'rejected' ||
    status === 'archived' ||
    status === 'duplicate' ||
    source === 'resolved' ||
    source === 'rejected' ||
    source === 'archived' ||
    report.isResolved === true ||
    report.isDuplicate === true ||
    Boolean(report._isResolvedFeedItem)
  );
};

// Normalization function to produce uniform report model
const normalizeReport = (docId, data, source) => {
  const rawTime = data.timestamp || data.submittedAt || data.createdAt || data.verifiedAt || data.reportTimestamp;
  const rawTimeMillis = getEpochMillis(rawTime);
  let formattedTime = 'Just now';
  if (rawTimeMillis > 0) {
    formattedTime = dayjs(rawTimeMillis).tz(PHILIPPINE_TIMEZONE).format('hh:mm A');
  }

  const lat = data.location?.latitude ?? data.latitude ?? data.coords?.[1] ?? data.radius?.centerLat ?? null;
  const lng = data.location?.longitude ?? data.longitude ?? data.coords?.[0] ?? data.radius?.centerLng ?? null;
  const address = data.address || data.location?.address || (typeof data.location === 'string' ? data.location : 'Location specified');
  const type = data.incidentType || data.hazardType || data.hazard || data.type || 'General Emergency';

  return {
    id: docId,
    reportID: data.reportID || data.reportId || docId,
    reportId: data.reportId || data.reportID || docId,
    verifiedReportId: data.verifiedReportId || data.verifiedreportID || null,
    incidentType: type,
    severity: data.verifiedSeverity || data.severity || 'Medium',
    hazard: data.hazard || data.hazardType || 'None Specified',
    status: data.status || 'active',
    address,
    location: typeof data.location === 'object' && data.location ? data.location : { address, latitude: lat, longitude: lng },
    latitude: lat !== null ? Number(lat) : null,
    longitude: lng !== null ? Number(lng) : null,
    submitterName: data.submitterName || data.citizenName || 'Citizen',
    submitterPhone: data.submitterPhone || data.phone || 'N/A',
    submitterEmail: data.submitterEmail || data.email || 'N/A',
    time: formattedTime,
    rawTimeMillis,
    source,
    selectedMarkerIcon: data.selectedMarkerIcon || resolveIconFromType(type),
    radius: data.radius || null,
    polyline: data.polyline || [],
    routeCoords: data.routeCoords || [],
    notes: data.notes || '',
    adminNotes: data.adminNotes || '',
    selectedAgencies: data.selectedAgencies || data.assignedAgencies || [],
    isSensitive: Boolean(data.isSensitive),
    mediaUrl: data.mediaUrl || data.media?.url || null,
    rawData: data,
  };
};

export const useActiveReportsStore = create((set, get) => {
  let subCount = 0;
  let unsubReports = null;
  let unsubApproved = null;

  let reportsMap = new Map();
  let approvedMap = new Map();

  const recomputeActive = () => {
    const combined = new Map();

    // 1. Raw incoming reports (pending/ongoing)
    reportsMap.forEach((rep, id) => {
      if (!isNonActiveReport(rep)) {
        combined.set(rep.reportID || id, rep);
      }
    });

    // 2. Approved reports (highest precedence for verified data)
    approvedMap.forEach((rep, id) => {
      if (!isNonActiveReport(rep)) {
        combined.set(rep.reportID || id, rep);
      }
    });

    const activeList = Array.from(combined.values()).sort(
      (a, b) => (b.rawTimeMillis || 0) - (a.rawTimeMillis || 0)
    );

    set({ activeReports: activeList, isLoading: false });
  };

  const startListening = () => {
    if (unsubReports || unsubApproved) return;

    // 1. Stream collection 'reports'
    unsubReports = onSnapshot(collection(db, 'reports'), (snapshot) => {
      const nextMap = new Map();
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        nextMap.set(doc.id, normalizeReport(doc.id, data, 'reports'));
      });
      reportsMap = nextMap;
      recomputeActive();
    }, (err) => console.error("ActiveReportsStore: reports stream error:", err));

    // 2. Stream collection 'approved_reports'
    unsubApproved = onSnapshot(collection(db, 'approved_reports'), (snapshot) => {
      const nextMap = new Map();
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        nextMap.set(doc.id, normalizeReport(doc.id, data, 'approved'));
      });
      approvedMap = nextMap;
      recomputeActive();
    }, (err) => console.error("ActiveReportsStore: approved_reports stream error:", err));
  };

  const stopListening = () => {
    if (unsubReports) { unsubReports(); unsubReports = null; }
    if (unsubApproved) { unsubApproved(); unsubApproved = null; }
  };

  return {
    activeReports: [],
    isLoading: true,
    subscribe: () => {
      subCount++;
      if (subCount === 1) {
        startListening();
      }
      return () => {
        subCount = Math.max(0, subCount - 1);
        if (subCount === 0) {
          stopListening();
        }
      };
    },
  };
});
