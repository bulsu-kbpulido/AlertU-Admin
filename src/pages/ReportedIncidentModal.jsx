import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getAuth } from 'firebase/auth'; // 👈 Needed to resolve 401 Unauthorized
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
  FiChevronDown, 
  FiX, 
  FiZoomIn,
  FiMapPin,
  FiFileText,
  FiShield,
  FiVolume2,
  FiArrowRight,
  FiCompass,
  FiCheckCircle,
  FiClock,
  FiEye,
  FiEyeOff,
  FiUser,
  FiMail,
  FiPhone
} from 'react-icons/fi';

// MagicUI BorderBeam Component
import { BorderBeam } from "@/components/ui/border-beam";
import MapChanger from './Map_Changer';

// 🌐 Dynamic Environment Configuration
const RAW_SERVER_URL = import.meta.env.VITE_API_URL || 'https://alertu-server-production.up.railway.app';
const CLEAN_SERVER_URL = RAW_SERVER_URL.replace(/\/+$/, '');
const API_BASE_URL = CLEAN_SERVER_URL.endsWith('/api')
  ? CLEAN_SERVER_URL
  : `${CLEAN_SERVER_URL}/api`;

/**
 * Converts Firestore Timestamps, JS Dates, or strings into readable format.
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

export default function ReportedIncidentModal({
  isOpen,
  onClose,
  selectedReport,
  setCurrentStep,
  customLocation,     
  setCustomLocation,
  verifiedIncidentType,
  setVerifiedIncidentType,
  verifiedSeverity,
  setVerifiedSeverity,
  adminNotes,
  setAdminNotes,
  isSensitive,
  setIsSensitive,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  
  const [isMapChangerOpen, setIsMapChangerOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState('Fire'); 
  const [customName, setCustomName] = useState('');
  
  // 🎯 Media Fullscreen State
  const [fullScreenMedia, setFullScreenMedia] = useState(null);

  // 📡 Attaches Firebase Bearer Token to resolve 401 Unauthorized
  const logAdminAction = async (action, metadata = {}) => {
    try {
      let token = null;
      try {
        const auth = getAuth();
        if (auth?.currentUser) {
          token = await auth.currentUser.getIdToken();
        }
      } catch (e) {
        // Fallback to local storage if custom auth is used
        token = localStorage.getItem('authToken') || localStorage.getItem('token');
      }

      const reportIdentifier = 
        selectedReport?.reportId || 
        selectedReport?.reportID || 
        selectedReport?.id || 
        'Unknown_Report';

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
    onClose?.();
  };

  useEffect(() => {
    if (isOpen && selectedReport) {
      const initialType = selectedReport?.verifiedIncidentType || selectedReport?.incidentType || selectedReport?.hazard || 'Fire';
      const predefined = ['Fire', 'Flood', 'Accident'];
      
      if (predefined.includes(initialType)) {
        setSelectionMode(initialType);
        setVerifiedIncidentType(initialType);
        setCustomName('');
      } else {
        setSelectionMode('Others');
        setCustomName(initialType);
        setVerifiedIncidentType(initialType);
      }
    }
  }, [isOpen, selectedReport, setVerifiedIncidentType]);

  if (!isOpen || !selectedReport) return null;

  const formattedReportId = 
    selectedReport?.reportId || 
    selectedReport?.reportID || 
    selectedReport?.customId || 
    selectedReport?.formattedId ||
    (selectedReport?.id && !isNaN(selectedReport.id) ? `RID${String(selectedReport.id).padStart(8, '0')}` : selectedReport?.id || 'UNASSIGNED');

  const reportTimestamp = formatFirestoreTimestamp(
    selectedReport?.createdAt || selectedReport?.timestamp || selectedReport?.submittedAt
  );

  const originalHazard = selectedReport?.hazard || selectedReport?.incidentType || 'Not specified';

  const reporterName = 
    selectedReport?.submitterName || 
    selectedReport?.userName || 
    selectedReport?.reporterName || 
    selectedReport?.fullName || 
    selectedReport?.user?.displayName || 
    selectedReport?.user?.name || 
    'Anonymous Reporter';

  const reporterEmail = 
    selectedReport?.submitterEmail || 
    selectedReport?.userEmail || 
    selectedReport?.reporterEmail || 
    selectedReport?.email || 
    selectedReport?.user?.email || 
    'No email provided';

  const reporterPhone = 
    selectedReport?.submitterPhone || 
    selectedReport?.userPhone || 
    selectedReport?.reporterPhone || 
    selectedReport?.phone || 
    selectedReport?.phoneNumber || 
    selectedReport?.user?.phoneNumber || 
    'No phone number provided';

  const currentReportLat = customLocation?.lat ?? (selectedReport?.location?.latitude ?? selectedReport?.latitude ?? 0);
  const currentReportLng = customLocation?.lng ?? (selectedReport?.location?.longitude ?? selectedReport?.longitude ?? 0);
  const currentAddress = customLocation?.address ?? (selectedReport?.location?.address || selectedReport?.address || 'Location details not provided');

  const liveGoogleMapsLink = `https://www.google.com/maps/search/?api=1&query=${currentReportLat},${currentReportLng}`;
  const activeAudioUrl = selectedReport?.voicenoteUrl || selectedReport?.voiceNoteUrl || selectedReport?.audioUrl;
  const hasValidAudio = Boolean(activeAudioUrl && activeAudioUrl !== "No voicenote attachments." && activeAudioUrl !== "");

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

  const handleSelectionChange = (val) => {
    setSelectionMode(val);
    if (val !== 'Others') {
      setVerifiedIncidentType(val);
      setCustomName('');
    } else {
      setVerifiedIncidentType(customName || 'Others');
    }
  };

  const handleCustomNameChange = (val) => {
    setCustomName(val);
    setVerifiedIncidentType(val || 'Others');
  };

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
                  Verification Step 1
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Pending Review
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
                {selectedReport.mediaUrl ? (
                  <div className="relative rounded-xl overflow-hidden bg-slate-950 flex flex-col justify-between h-56 group">
                    {selectedReport.mediaUrl.toLowerCase().includes('.mp4') ? (
                      <div className="relative h-full w-full bg-black">
                        <video 
                          src={selectedReport.mediaUrl} 
                          className="w-full h-full object-cover"
                          controls
                          playsInline
                        />
                        <button 
                          onClick={() => setFullScreenMedia({ url: selectedReport.mediaUrl, type: 'video' })}
                          className="absolute top-2.5 right-2.5 z-10 p-2 bg-black/60 hover:bg-black/90 text-white rounded-lg backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all shadow-md active:scale-95"
                          title="Expand Video"
                        >
                          <FiMaximize2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative h-full w-full bg-black overflow-hidden">
                        <img 
                          src={selectedReport.mediaUrl} 
                          alt="Evidence" 
                          className={`w-full h-full object-cover transition-all duration-300 ${isSensitive ? 'blur-md scale-105' : 'blur-0'}`}
                        />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center backdrop-blur-[2px]">
                          <button 
                            onClick={() => setFullScreenMedia({ url: selectedReport.mediaUrl, type: 'image' })}
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
                <button 
                  onClick={() => setIsMapChangerOpen(true)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 transition-all shadow-sm active:scale-95 flex items-center gap-1.5"
                >
                  <FiCompass className="text-blue-600 w-3.5 h-3.5" />
                  <span>Change Location</span>
                </button>
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

          {/* Citizen Notes & Verification Parameters Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Left: Reported Information & Submitter Profile */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                Reported Information
              </h4>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-500 block">Reported Hazard Category:</span>
                <div className="text-xs font-bold text-slate-900 bg-amber-50 text-amber-800 border border-amber-200 px-3 py-2 rounded-xl inline-flex items-center gap-2">
                  <FiAlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>{originalHazard}</span>
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

            {/* Right: Verification Controls & Admin Remarks */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                Verification Parameters
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Verified Incident Category */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Verified Hazard
                  </label>
                  <div className="relative">
                    <select 
                      value={selectionMode} 
                      onChange={(e) => handleSelectionChange(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 appearance-none font-semibold text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
                    >
                      <option value="Fire">Fire</option>
                      <option value="Flood">Flood</option>
                      <option value="Accident">Accident</option>
                      <option value="Others">Others (Custom)</option>
                    </select>
                    <FiChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none w-4 h-4" />
                  </div>
                </div>

                {/* Verified Severity Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Severity Level
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['Low', 'Medium', 'High'].map((sev) => (
                      <button
                        key={sev}
                        type="button"
                        onClick={() => setVerifiedSeverity(sev)}
                        className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                          verifiedSeverity === sev 
                            ? 'bg-blue-600 border-blue-600 text-white shadow-sm' 
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {selectionMode === 'Others' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Custom Category</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Earthquake, Landslide" 
                    value={customName}
                    onChange={(e) => handleCustomNameChange(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              )}

              {/* Admin Internal Remarks Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Verification Remarks / Dispatch Notes
                </label>
                <textarea 
                  placeholder="Enter notes or instructions for response teams..." 
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  className="w-full h-20 bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Modal Action Footer */}
        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600 font-medium">
            <FiCheckCircle className="text-emerald-600 w-4 h-4" />
            <span>Ready for step 2 spatial mapping</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button 
              onClick={handleClose} 
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-all shadow-sm active:scale-95"
            >
              Cancel
            </button>
            <button 
              onClick={() => {
                logAdminAction('VERIFY_STEP_ADVANCE', { step: 2 });
                setCurrentStep(2);
              }} 
              className="px-5 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition-all flex items-center gap-2 active:scale-95"
            >
              <span>Next: Spatial Mapping</span>
              <FiArrowRight className="w-4 h-4" />
            </button>
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

        {/* Map Location Corrector */}
        <MapChanger 
          isOpen={isMapChangerOpen}
          onClose={() => setIsMapChangerOpen(false)}
          initialLat={currentReportLat}
          initialLng={currentReportLng}
          initialAddress={currentAddress}
          onSave={(updatedTelemetry) => {
            setCustomLocation({
              lat: Number(updatedTelemetry.latitude),
              lng: Number(updatedTelemetry.longitude),
              address: updatedTelemetry.address
            });
          }}
        />
      </div>
    </div>
  );
}
