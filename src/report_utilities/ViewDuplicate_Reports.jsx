import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getAuth } from 'firebase/auth';
import { FcGoogle } from "react-icons/fc";
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import { fromLonLat } from 'ol/proj';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import OSM from 'ol/source/OSM';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Style, Icon } from 'ol/style';

// Modern Icons
import { 
  FiMaximize2, 
  FiAlertTriangle, 
  FiX, 
  FiZoomIn,
  FiMapPin,
  FiFileText,
  FiShield,
  FiVolume2,
  FiCompass,
  FiClock,
  FiEye,
  FiEyeOff,
  FiUser,
  FiMail,
  FiPhone,
  FiTag,
  FiCheckCircle,
  FiXCircle
} from 'react-icons/fi';

// MagicUI BorderBeam Component
import { BorderBeam } from "@/components/ui/border-beam";

// 🚀 Flexible Base URL
const API_BASE_URL = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || 
  (typeof process !== 'undefined' && process.env?.REACT_APP_API_URL) || 
  '/api';

/**
 * Converts Timestamps, JS Dates, or strings into readable format.
 */
const formatFirestoreTimestamp = (timestamp) => {
  if (!timestamp) return 'Date and time unavailable';

  try {
    if (typeof timestamp === 'object' && typeof timestamp.toDate === 'function') {
      return timestamp.toDate().toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    }

    if (typeof timestamp === 'object' && (timestamp.seconds !== undefined || timestamp._seconds !== undefined)) {
      const secs = timestamp.seconds ?? timestamp._seconds;
      return new Date(secs * 1000).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    }

    if (typeof timestamp === 'string' || timestamp instanceof Date || typeof timestamp === 'number') {
      const parsed = new Date(timestamp);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });
      }
    }
  } catch (err) {
    console.warn('Error formatting timestamp:', err);
  }

  return 'Date and time unavailable';
};

export default function ViewDuplicate_Reports({
  isOpen = true,
  onClose,
  report,
  onVerify,
  onReject
}) {
  const mapRef = useRef(null);
  mapRef.current = null;
  const mapInstance = useRef(null);
  
  // 🎯 Sensitivity Blur State
  const [isSensitive, setIsSensitive] = useState(Boolean(report?.isSensitive));
  
  // 🎯 Media Fullscreen State
  const [fullScreenMedia, setFullScreenMedia] = useState(null);

  // Sync sensitivity state if report changes
  useEffect(() => {
    if (report) {
      setIsSensitive(Boolean(report.isSensitive));
    }
  }, [report]);

  // Action Logging
  const logAdminAction = async (action, metadata = {}) => {
    try {
      let token = null;
      try {
        const auth = getAuth();
        if (auth?.currentUser) {
          token = await auth.currentUser.getIdToken();
        }
      } catch (e) {
        token = localStorage.getItem('authToken') || localStorage.getItem('token');
      }

      const reportIdentifier = report?.reportId || report?.reportID || report?.id || 'Unknown_Report';

      await axios.post(
        `${API_BASE_URL}/admin-actions/log`,
        {
          action,
          target: reportIdentifier,
          adminName: 'System Admin',
          adminId: 'admin_123',
          metadata,
          targetRoom: 'super_admins',
        },
        { 
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          withCredentials: true 
        }
      );
    } catch (err) {
      console.warn(`⚠️ Action log warning (${action}):`, err.response?.data?.message || err.message);
    }
  };

  const handleClose = () => {
    const reportIdentifier = report?.reportId || report?.reportID || report?.id;
    if (reportIdentifier) {
      logAdminAction('CLOSE_VIEW_MODAL', { reportId: reportIdentifier }).catch(() => {});
    }
    onClose();
  };

  useEffect(() => {
    const reportIdentifier = report?.reportId || report?.reportID || report?.id;
    if (isOpen && reportIdentifier) {
      logAdminAction('OPEN_VIEW_MODAL', { reportId: reportIdentifier });
    }
  }, [isOpen, report?.id, report?.reportId, report?.reportID]);

  if (!isOpen || !report) return null;

  // Formatting & Safe Field Extracts
  const formattedReportId = 
    report?.reportId || 
    report?.reportID || 
    report?.customId || 
    report?.formattedId ||
    (report?.id && !isNaN(report.id) ? `RID${String(report.id).padStart(8, '0')}` : report?.id || 'UNASSIGNED');

  const reportTimestamp = formatFirestoreTimestamp(
    report?.createdAt || report?.timestamp || report?.submittedAt || report?.verifiedAt
  );

  const displayTitle = report.reportTitle || report.verifiedIncidentType || report.incidentType || report.hazard || 'Emergency Incident';
  const rawSeverity = (report.verifiedSeverity || report.severity || 'Medium').toLowerCase();
  const rawStatus = (report.status || 'Pending').toLowerCase();

  // Submitter Profile
  const reporterName = 
    report?.submitterName || 
    report?.userName || 
    report?.reporterName || 
    report?.fullName || 
    report?.user?.displayName || 
    report?.user?.name || 
    report?.reporter?.name ||
    'Anonymous Reporter';

  const reporterEmail = 
    report?.submitterEmail || 
    report?.userEmail || 
    report?.reporterEmail || 
    report?.email || 
    report?.user?.email || 
    'No email provided';

  const reporterPhone = 
    report?.submitterPhone || 
    report?.userPhone || 
    report?.reporterPhone || 
    report?.phone || 
    report?.phoneNumber || 
    report?.user?.phoneNumber || 
    report?.reporter?.phone ||
    'No phone number provided';

  const description = report.description || report.incidentDetails || report.notes || 'No description provided by the reporter.';
  const adminNotes = report.adminNotes || report.verificationRemarks || null;

  const currentReportLat = report?.location?.latitude ?? report?.latitude ?? report?.correctedLatitude ?? 0;
  const currentReportLng = report?.location?.longitude ?? report?.longitude ?? report?.correctedLongitude ?? 0;
  const currentAddress = report?.correctedAddress || report?.location?.address || report?.address || 'Location details not provided';

  const liveGoogleMapsLink = `https://www.google.com/maps/search/?api=1&query=${currentReportLat},${currentReportLng}`;
  
  // Media Attachments
  const mediaUrl = report?.mediaUrl || report?.imageUrl || (report?.media && report.media[0]) || (report?.attachments && report.attachments[0]) || null;
  const activeAudioUrl = report?.voicenoteUrl || report?.voiceNoteUrl || report?.audioUrl;
  const hasValidAudio = Boolean(activeAudioUrl && activeAudioUrl !== "No voicenote attachments." && activeAudioUrl !== "");

  // OpenLayers Map Initialization (Read-Only)
  useEffect(() => {
    if (isOpen && mapRef.current && currentReportLat && currentReportLng) {
      if (mapInstance.current) {
        mapInstance.current.setTarget(null);
        mapInstance.current = null;
      }

      const coordinates = fromLonLat([parseFloat(currentReportLng), parseFloat(currentReportLat)]);
      const markerFeature = new Feature({ geometry: new Point(coordinates) });

      markerFeature.setStyle(
        new Style({
          image: new Icon({
            anchor: [0.5, 1],
            src: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', 
            scale: 0.06,
          }),
        })
      );

      const vectorSource = new VectorSource({ features: [markerFeature] });
      const vectorLayer = new VectorLayer({ source: vectorSource });

      const map = new Map({
        target: mapRef.current,
        layers: [new TileLayer({ source: new OSM() }), vectorLayer],
        view: new View({ center: coordinates, zoom: 15 }),
      });

      mapInstance.current = map;

      const resizeObserver = new ResizeObserver(() => {
        if (mapInstance.current) mapInstance.current.updateSize();
      });
      resizeObserver.observe(mapRef.current);

      return () => {
        resizeObserver.disconnect();
        if (mapInstance.current) {
          mapInstance.current.setTarget(null);
          mapInstance.current = null;
        }
      };
    }
  }, [isOpen, currentReportLat, currentReportLng]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-sm text-slate-800 font-sans antialiased overflow-y-auto">
      
      {/* Outer Modal Container */}
      <div className="relative w-full max-w-6xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        
        {/* MagicUI BorderBeam Integration */}
        <BorderBeam size={250} duration={12} delay={9} colorFrom="#3b82f6" colorTo="#6366f1" />

        {/* Modal Header */}
        <header className="px-6 py-4 border-b border-slate-200 bg-slate-50/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 shrink-0">
              <FiShield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  Incident Record Overview
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${
                  rawStatus === 'verified' || rawStatus === 'dispatched'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : rawStatus === 'rejected'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  <FiTag className="w-3 h-3 mr-1" />
                  {rawStatus}
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight mt-0.5 flex items-center gap-2">
                Report #{formattedReportId}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-4 justify-between sm:justify-end">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium bg-white px-3 py-1.5 rounded-lg border border-slate-200">
              <FiClock className="text-slate-400 w-3.5 h-3.5" />
              <span>{reportTimestamp}</span>
            </div>
            
            <button 
              onClick={handleClose} 
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-all shadow-sm active:scale-95 z-10"
              aria-label="Close dialog"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
          
          {/* Main Grid: Evidence & Location */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Media Evidence Column */}
            <div className="space-y-3 flex flex-col">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <FiFileText className="text-blue-600 w-4 h-4" /> Media Attachments
                </h4>
              </div>

              {/* Visual Media Showcase */}
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex flex-col justify-between">
                {mediaUrl ? (
                  <div className="relative rounded-xl overflow-hidden bg-slate-950 flex flex-col justify-between h-56 group">
                    {mediaUrl.toLowerCase().includes('.mp4') ? (
                      <div className="relative h-full w-full bg-black">
                        <video 
                          src={mediaUrl} 
                          className="w-full h-full object-cover"
                          controls
                          playsInline
                        />
                        <button 
                          onClick={() => setFullScreenMedia({ url: mediaUrl, type: 'video' })}
                          className="absolute top-2.5 right-2.5 z-10 p-2 bg-black/60 hover:bg-black/90 text-white rounded-lg backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all shadow-md active:scale-95"
                          title="Expand Video"
                        >
                          <FiMaximize2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative h-full w-full bg-black overflow-hidden">
                        <img 
                          src={mediaUrl} 
                          alt="Evidence" 
                          className={`w-full h-full object-cover transition-all duration-300 ${isSensitive ? 'blur-md scale-105' : 'blur-0'}`}
                        />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center backdrop-blur-[2px]">
                          <button 
                            onClick={() => setFullScreenMedia({ url: mediaUrl, type: 'image' })}
                            className="px-3.5 py-2 bg-white text-slate-900 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg hover:bg-slate-100 transition-all active:scale-95"
                          >
                            <FiZoomIn className="w-4 h-4 text-blue-600" /> View Full Image
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-center text-xs text-slate-400 font-medium h-56 bg-slate-50">
                    <FiFileText className="w-8 h-8 text-slate-300 mb-2" />
                    <span>No image or video submitted</span>
                  </div>
                )}

                {/* Sensitive Media Toggle Control */}
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl">
                  <div className="flex items-center gap-2">
                    {isSensitive ? <FiEyeOff className="text-rose-500 w-4 h-4" /> : <FiEye className="text-slate-500 w-4 h-4" />}
                    <span className="text-xs font-semibold text-slate-700">Sensitive Content Blur</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isSensitive}
                    onClick={() => setIsSensitive(!isSensitive)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                      isSensitive ? 'bg-rose-500' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        isSensitive ? 'translate-x-4.5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Audio Stream Player */}
              {hasValidAudio && (
                <div className="bg-white border border-slate-200 p-4 rounded-2xl space-y-2 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <FiVolume2 className="text-blue-600 w-4 h-4" />
                    <span>Voice Note Attachment</span>
                  </div>
                  <audio src={activeAudioUrl} controls className="w-full h-9 accent-blue-600" />
                </div>
              )}
            </div>

            {/* Geographical Location Column */}
            <div className="space-y-3 flex flex-col">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <FiMapPin className="text-blue-600 w-4 h-4" /> Incident Location
                </h4>
                <div className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 flex items-center gap-1.5">
                  <FiCompass className="text-slate-400 w-3.5 h-3.5" />
                  <span>Read-Only View</span>
                </div>
              </div>

              <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex flex-col justify-between space-y-3">
                <div className="text-xs bg-slate-50 p-3 rounded-xl border border-slate-100 text-slate-700 flex items-start gap-2">
                  <FiMapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <span className="font-medium text-slate-800 break-words">{currentAddress}</span>
                </div>

                <div className="relative rounded-xl overflow-hidden border border-slate-200 h-56">
                  <div ref={mapRef} className="w-full h-full bg-slate-100" />
                  <a 
                    href={liveGoogleMapsLink} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="absolute bottom-3 right-3 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-md backdrop-blur-md transition-all active:scale-95"
                  >
                    <FcGoogle className="text-base" /> <span>Open in Google Maps</span>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Incident Description & Parameters Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Left: Reported Information & Submitter Profile */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                Reported Details & Description
              </h4>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-500 block">Incident Category / Title:</span>
                <div className="text-xs font-bold text-slate-900 bg-amber-50 text-amber-800 border border-amber-200 px-3 py-2 rounded-xl inline-flex items-center gap-2">
                  <FiAlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>{displayTitle}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-500 block">Incident Overview:</span>
                <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 p-3 rounded-xl leading-relaxed whitespace-pre-line">
                  {description}
                </div>
              </div>

              {/* Submitter / Citizen Details Card */}
              <div className="space-y-2 pt-1 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Reporter Information
                </span>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                  <div className="flex items-center gap-2.5 text-xs text-slate-800 font-semibold">
                    <FiUser className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="truncate">{reporterName}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-600 font-medium">
                    <FiMail className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">{reporterEmail}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-600 font-medium">
                    <FiPhone className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">{reporterPhone}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Read-Only Verification Summary & Admin Remarks */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                Assessment Summary
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Verified Severity Display */}
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    Severity Priority
                  </span>
                  <div className={`px-3 py-2 rounded-xl text-xs font-bold capitalize border inline-flex items-center gap-1.5 w-full ${
                    rawSeverity === 'high' || rawSeverity === 'critical'
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : rawSeverity === 'medium'
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-blue-50 border-blue-200 text-blue-700'
                  }`}>
                    <FiAlertTriangle className="w-3.5 h-3.5" />
                    <span>{rawSeverity} Priority</span>
                  </div>
                </div>

                {/* Status Display */}
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    Incident Status
                  </span>
                  <div className={`px-3 py-2 rounded-xl text-xs font-bold capitalize border inline-flex items-center gap-1.5 w-full ${
                    rawStatus === 'verified' || rawStatus === 'dispatched'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : rawStatus === 'rejected'
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : 'bg-slate-100 border-slate-200 text-slate-700'
                  }`}>
                    <FiTag className="w-3.5 h-3.5" />
                    <span>{rawStatus}</span>
                  </div>
                </div>
              </div>

              {/* Admin Remarks Read-Only Box */}
              <div className="space-y-1.5 pt-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Verification Remarks / Dispatch Notes
                </span>
                <div className="w-full h-28 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-medium text-slate-800 leading-relaxed overflow-y-auto">
                  {adminNotes ? adminNotes : <span className="text-slate-400 italic">No admin notes recorded for this report.</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Action Footer */}
        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600 font-medium">
            <FiShield className="text-blue-600 w-4 h-4" />
            <span>Viewing Record Mode</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button 
              onClick={handleClose} 
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-all shadow-sm active:scale-95"
            >
              Close Details
            </button>

            {onReject && (
              <button 
                onClick={() => {
                  handleClose();
                  onReject(report.id || report.reportId);
                }} 
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95"
              >
                <FiXCircle className="w-4 h-4" />
                <span>Reject</span>
              </button>
            )}

            {onVerify && (
              <button 
                onClick={() => {
                  handleClose();
                  onVerify(report);
                }} 
                className="px-5 py-2 text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95"
              >
                <FiCheckCircle className="w-4 h-4" />
                <span>Proceed to Verify</span>
              </button>
            )}
          </div>
        </footer>

        {/* Fullscreen Media Overlay */}
        {fullScreenMedia && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200">
            <button 
              onClick={() => setFullScreenMedia(null)}
              className="absolute top-6 right-6 z-[1001] w-10 h-10 bg-white/10 hover:bg-rose-600 text-white rounded-xl flex items-center justify-center transition-all shadow-lg active:scale-95"
              aria-label="Close fullscreen view"
            >
              <FiX className="text-2xl" />
            </button>
            <div className="w-full max-w-5xl max-h-[90vh] flex items-center justify-center">
              {fullScreenMedia.type === 'video' ? (
                <video src={fullScreenMedia.url} controls autoPlay className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl bg-black" />
              ) : (
                <img src={fullScreenMedia.url} alt="Fullscreen Evidence" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain bg-black" />
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}