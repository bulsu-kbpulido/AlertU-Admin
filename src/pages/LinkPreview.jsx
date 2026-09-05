import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Overlay from 'ol/Overlay';
import { Point, LineString, Circle as CircleGeom } from 'ol/geom';
import { fromLonLat } from 'ol/proj';
import { Style, Stroke, Fill, Icon } from 'ol/style';
import SensitiveMediaWrapper from './SensitiveMediaWrapper';
import { FcGoogle } from "react-icons/fc";
import { motion } from 'framer-motion';

// Modern Lucide Icons
import { 
  MapPin, 
  Clock, 
  X,
  Shield,
  Printer,
  AlertTriangle,
  FileText,
  CheckCircle,
  Building,
  Volume2,
  Tag,
  FolderHeart,
  User,
  Mail,
  Phone,
  MessageSquare
} from 'lucide-react';

// MagicUI BorderBeam Integration
import { BorderBeam } from "@/components/ui/border-beam";

// Reference Dictionary for Dynamic Agency Profiles matching your backend array structure
const AGENCIES = [
  { id: "RHU", name: "Rural Health Unit", icon: "🏥", color: "border-emerald-500 bg-emerald-50 text-emerald-700" },
  { id: "BFP", name: "Bureau of Fire Protection", icon: "🚒", color: "border-red-500 bg-red-50 text-red-700" },
  { id: "PNP", name: "Philippine National Police", icon: "👮", color: "border-blue-500 bg-blue-50 text-blue-700" },
  { id: "MDRRMO", name: "Municipal Disaster Risk Reduction and Management Office", icon: "🚑", color: "border-orange-500 bg-orange-50 text-orange-700" },
  { id: "Barangay", name: "Barangay Officials", icon: "🏘️", color: "border-yellow-500 bg-yellow-50 text-yellow-700" }
];

const ICON_COLOR_MAP = {
  'fireicon.png': '#ef4444',
  'floodicon.png': '#3b82f6',
  'accicon.png': '#eab308',
  'caricon.png': '#eab308',
  'quakeicon.png': '#78350f',
  'warnicon.png': '#f97316'
};

const hexToRgba = (hex, alpha) => {
  const cleanHex = (hex || '#3b82f6').replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'Date and time unavailable';
  try {
    if (typeof timestamp === 'object' && typeof timestamp.toDate === 'function') {
      return timestamp.toDate().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }
    if (typeof timestamp === 'object' && (timestamp.seconds !== undefined || timestamp._seconds !== undefined)) {
      const secs = timestamp.seconds ?? timestamp._seconds;
      return new Date(secs * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }
    if (typeof timestamp === 'string' || timestamp instanceof Date || typeof timestamp === 'number') {
      const parsed = new Date(timestamp);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      }
    }
  } catch (err) {
    console.warn('Error formatting timestamp:', err);
  }
    return 'Date and time unavailable';
};

// Resolve media from all report shapes used by the backend. Signed stream URLs
// often have no file extension, so MIME type must be checked before the URL.
const resolveMediaAsset = (report) => {
  const candidate =
    report?.mediaUrl ||
    report?.imageUrl ||
    (Array.isArray(report?.media) ? report.media[0] : report?.media) ||
    (Array.isArray(report?.attachments) ? report.attachments[0] : report?.attachments) ||
    null;

  const url = typeof candidate === 'string'
    ? candidate
    : candidate?.url || candidate?.downloadURL || candidate?.src || null;

  const type = String(
    (typeof candidate === 'object' && candidate
      ? candidate.type || candidate.mimeType || candidate.contentType
      : null) ||
    report?.mediaType ||
    report?.mimeType ||
    report?.contentType ||
    ''
  ).toLowerCase();

  const cleanUrl = String(url || '').split('?')[0].split('#')[0];
  const isVideo = type.startsWith('video/') ||
    /\.(mp4|webm|ogg|mov|m4v|avi|mpeg|mpg)$/i.test(cleanUrl) ||
    /[\\/]video[\\/](upload|raw)[\\/]/i.test(String(url || ''));
  const isAudio = type.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(cleanUrl);

  return { url, type, isVideo, isAudio };
};

export default function LinkPreview({ isOpen, onClose, report }) {
  const mapRef = useRef(null);
  const pulseOverlayRef = useRef(null);
  const mapInstance = useRef(null);

  const [isRevealed, setIsRevealed] = useState(false);
  const [mapPulseColor, setMapPulseColor] = useState('#3b82f6');

  useEffect(() => {
    if (isOpen) {
      setIsRevealed(false);
    }
  }, [isOpen, report?.id]);

  useEffect(() => {
    if (!isOpen || !report || !mapRef.current) return;

    const { radius, polyline, location, selectedMarkerIcon, incidentType } = report;
    const centerLat = Number(radius?.centerLat || location?.latitude || report.latitude || 14.75);
    const centerLng = Number(radius?.centerLng || location?.longitude || report.longitude || 120.95);
    const centerMeters = fromLonLat([centerLng, centerLat]);

    const geometrySource = new VectorSource();
    const iconFile = selectedMarkerIcon || 
      (incidentType?.toLowerCase() === 'fire' ? 'fireicon.png' : 
       incidentType?.toLowerCase() === 'flood' ? 'floodicon.png' : 
       incidentType?.toLowerCase() === 'accident' ? 'accicon.png' : 'warnicon.png');
    const activeColor = ICON_COLOR_MAP[iconFile] || '#3b82f6';
    setMapPulseColor(activeColor);

    let targetMeters = centerMeters;

    if (radius) {
      const circle = new Feature({ geometry: new CircleGeom(centerMeters, Number(radius.radiusMeters) || 300) });
      circle.setStyle(new Style({
        stroke: new Stroke({ color: activeColor, width: 2.5 }),
        fill: new Fill({ color: hexToRgba(activeColor, 0.12) })
      }));
      geometrySource.addFeature(circle);
    
    } else if (report.routeCoords && report.routeCoords.length > 0) {
      const sortedCoords = [...report.routeCoords].sort((a, b) => a.order - b.order);
      const lineCoords = sortedCoords.map(pt => fromLonLat([Number(pt.lng), Number(pt.lat)]));
      const lineGeometry = new LineString(lineCoords);
    
      const line = new Feature({ geometry: lineGeometry });
      line.setStyle(new Style({
        stroke: new Stroke({ color: activeColor, width: 5, lineCap: 'round' })
      }));
      geometrySource.addFeature(line);
    
      targetMeters = lineGeometry.getCoordinateAt(0.50);
    
    } else if (polyline && Array.isArray(polyline) && polyline.length >= 2) {
      const lineCoords = polyline.map(pt => fromLonLat([Number(pt.lng), Number(pt.lat)]));
      const lineGeometry = new LineString(lineCoords);
    
      const line = new Feature({ geometry: lineGeometry });
      line.setStyle(new Style({
        stroke: new Stroke({ color: activeColor, width: 5, lineCap: 'round' })
      }));
      geometrySource.addFeature(line);
    
      targetMeters = lineGeometry.getCoordinateAt(0.50);
    }

    const marker = new Feature({ geometry: new Point(targetMeters) });
    marker.setStyle(new Style({
      image: new Icon({
        anchor: [0.5, 1.0], 
        src: `/${iconFile}`,
        scale: 1.0,
        rotation: 0, 
        crossOrigin: 'anonymous'
      }),
      zIndex: 100 
    }));
    geometrySource.addFeature(marker);

    const vectorLayer = new VectorLayer({ source: geometrySource, zIndex: 10 });
    
    const pulseOverlay = new Overlay({
      element: pulseOverlayRef.current,
      positioning: 'center-center',
      stopEvent: false
    });
    pulseOverlay.setPosition(targetMeters);

    mapInstance.current = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        vectorLayer
      ],
      overlays: [pulseOverlay],
      view: new View({ center: targetMeters, zoom: 15.5 })
    });

    const resizeObserver = new ResizeObserver(() => {
      mapInstance.current?.updateSize();
    });
    resizeObserver.observe(mapRef.current);

    return () => {
      resizeObserver.disconnect();
      if (mapInstance.current) {
        mapInstance.current.setTarget(null);
        mapInstance.current = null;
      }
    };
  }, [isOpen, report]);

  if (!isOpen || !report) return null;

  // Safe Property Extractions
  const currentLat = report?.location?.latitude ?? report?.latitude ?? 0;
  const currentLng = report?.location?.longitude ?? report?.longitude ?? 0;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${currentLat},${currentLng}`;
  
  // Clean parsing targeting only the verified report data fields
  const rawVrid = report?.verifiedReportID || report?.verifiedreportID || report?.vrid || 'VRID00000000';
  const reportIdentifier = rawVrid.toString().toUpperCase().startsWith('VRID') 
    ? rawVrid.toUpperCase() 
    : `VRID${rawVrid}`;

  // Core content fields
  const reportTitleText = report.reportTitle || 'Untitled Incident Entry';
  const incidentCategory = report.incidentType || 'General Incident';
  const hazardType = report.hazard || 'Not Specified';

  const rawSeverity = (report.severity || 'Medium').toLowerCase();
  const rawStatus = (report.status || 'Pending').toLowerCase();
  
  const currentAddress = report?.location?.address || report?.address || 'Location details unavailable';
  const incidentNotes = report.notes || report.description || report.incidentDetails || 'No additional details provided.';
  
  // Citizen comments extracted from backend payload mapping
  const citizenNotesContent = report.citizenNotes || report.citizenComment || report.citizenRemarks || 'No citizen notes added.';

  // Submitter Credentials Mapping
  const reporterName = report.submitterName || report.reporterName || 'Anonymous Submitter';
  const reporterEmail = report.submitterEmail || report.reporterEmail || 'No email provided';
  const reporterPhone = report.submitterPhone || report.reporterPhone || 'No phone provided';

  // Dynamic Array Parsing matching your backend Firestore schema array: selectedAgencies
  const rawAgenciesList = Array.isArray(report.selectedAgencies) ? report.selectedAgencies : [];

  const matchedAgencies = rawAgenciesList.map(item => {
    const searchId = typeof item === 'object' && item !== null ? (item.id || item.name) : String(item);
    return AGENCIES.find(dict => dict.id.toLowerCase() === searchId.toLowerCase() || dict.name.toLowerCase() === searchId.toLowerCase()) || {
      id: searchId.substring(0, 8),
      name: searchId,
      icon: "🏢",
      color: "border-slate-300 bg-slate-50 text-slate-700"
    };
  });

  const reportDateFormatted = formatTimestamp(report.timestamp || report.createdAt);
  const { url: mediaUrl, type: mediaType, isVideo, isAudio } = resolveMediaAsset(report);
  const activeAudioUrl = isAudio && !isVideo ? mediaUrl : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 xl:p-6 bg-slate-950/80 backdrop-blur-md text-slate-800 dark:text-slate-100 font-sans antialiased overflow-y-auto">
      
      <div className="hidden">
        <div ref={pulseOverlayRef} className="relative flex items-center justify-center pointer-events-none">
          <motion.div
            animate={{ scale: [0.6, 2.5], opacity: [0.6, 0] }}
            transition={{ duration: 2.0, repeat: Infinity, ease: "easeOut" }}
            className="absolute rounded-full w-20 h-20"
            style={{ backgroundColor: hexToRgba(mapPulseColor, 0.4) }}
          />
        </div>
      </div>

      {/* Expanded Modern Workspace - Desktop Optimized */}
      <div className="relative w-full max-w-[95vw] xl:max-w-7xl max-h-[92vh] bg-white dark:bg-slate-950 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
        
        <BorderBeam size={350} duration={14} delay={9} colorFrom="#3b82f6" colorTo="#10b981" />

        {/* Header Layout */}
        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 text-blue-600 dark:text-blue-400 shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  Verified Report Details
                </span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border capitalize ${
                  rawStatus === 'verified' || rawStatus === 'dispatched'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                  <CheckCircle className="w-3 h-3 mr-1 text-emerald-600" />
                  {rawStatus}
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight mt-0.5">
                Case Preview Reference: #{reportIdentifier}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-3 justify-between sm:justify-end">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
              <Clock className="text-slate-400 w-3.5 h-3.5" />
              <span>{reportDateFormatted}</span>
            </div>
            
            <button 
              onClick={onClose} 
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/40 dark:bg-slate-900/60">
          
          {/* Top Panel Map and Media Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Left Media Column */}
            <div className="space-y-2 flex flex-col">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <FileText className="text-blue-600 w-4 h-4" /> Photos & Multimedia Reports
              </h4>

              <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm flex flex-col justify-between min-h-[280px]">
                {mediaUrl && !activeAudioUrl ? (
                  <div className="relative rounded-lg overflow-hidden bg-slate-950 h-56 flex items-center justify-center">
                    <SensitiveMediaWrapper
                      key={`${report.id}-${mediaUrl}`}
                      mediaUrl={mediaUrl}
                      isSensitive={report.isSensitive}
                      topic={report.incidentType || "Incident Scene"}
                    >
                      {isVideo ? (
                        <video
                          src={mediaUrl}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-contain rounded-lg bg-black"
                        >
                          {mediaType && <source src={mediaUrl} type={mediaType} />}
                          Your browser does not support this video format.
                        </video>
                      ) : (
                        <img src={mediaUrl} alt="Incident Evidence" className="w-full h-full object-contain rounded-lg bg-slate-100 dark:bg-slate-950" />
                      )}
                    </SensitiveMediaWrapper>
                  </div>
                ) : (
                  <div className="p-6 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg flex flex-col items-center justify-center text-center text-xs text-slate-400 font-medium h-56 bg-slate-50 dark:bg-slate-800/60">
                    <FileText className="w-8 h-8 text-slate-300 mb-2" />
                    <span>No display images attached to this record</span>
                  </div>
                )}

                {activeAudioUrl && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg flex items-center gap-3">
                    <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg shrink-0">
                      <Volume2 className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 block mb-1">Emergency Dispatch Voice Note</span>
                      <audio src={activeAudioUrl} controls className="w-full h-8 accent-blue-600" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Map Column */}
            <div className="space-y-2 flex flex-col">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <MapPin className="text-blue-600 w-4 h-4" /> Verified Geographic Location
              </h4>

              <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm flex flex-col justify-between space-y-3 min-h-[280px]">
                <div className="text-xs bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                  <span className="font-semibold text-slate-800 dark:text-slate-100 break-words">{currentAddress}</span>
                </div>

                <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 h-56">
                  <div ref={mapRef} className="w-full h-full bg-slate-100 dark:bg-slate-800" />
                  <a 
                    href={googleMapsUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="absolute bottom-3 right-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-md backdrop-blur-md transition-all active:scale-95"
                  >
                    <FcGoogle className="text-base" /> <span>Open Google Maps</span>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Lower Grid Dashboard Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
            
            {/* Column 1: Core Content Categorization & Submitter Profile */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-5">
              
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-1.5">
                  <FolderHeart className="w-4 h-4 text-blue-600" />
                  <span>Categorization Specifications</span>
                </h4>
                
                <div className="space-y-2.5">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">Report Title</span>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-lg truncate flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{reportTitleText}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">Incident Type</span>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-lg truncate flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate capitalize">{incidentCategory}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">Hazard Status</span>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-lg truncate flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate capitalize">{hazardType}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Submitter Info Placement Layout */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-4 h-4 text-slate-700" />
                  <span>Submitter Information</span>
                </h4>

                <div className="space-y-2 text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-3 rounded-xl">
                  <div className="flex items-center gap-2.5">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Reporter Name</span>
                      <span className="font-bold text-slate-900 dark:text-white block">{reporterName}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 pt-1">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <span className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Email Address</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100 block truncate">{reporterEmail}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 pt-1">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Contact Phone</span>
                      <span className="font-bold text-slate-900 dark:text-white block tracking-wide">{reporterPhone}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2: Incident Narrative Logs */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
              <div className="flex-1 flex flex-col">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center justify-between">
                  <span>Incident Details</span>
                  <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border uppercase tracking-wider ${
                    rawSeverity === 'high' || rawSeverity === 'critical'
                      ? 'bg-rose-50 border-rose-100 text-rose-700'
                      : rawSeverity === 'medium'
                      ? 'bg-amber-50 border-amber-100 text-amber-700'
                      : 'bg-blue-50 border-blue-100 text-blue-700'
                  }`}>
                    {rawSeverity} Severity
                  </span>
                </h4>

                <div className="mt-4 flex-1 flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider mb-1.5">Narrative Log</span>
                  <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 p-4 rounded-xl leading-relaxed whitespace-pre-line flex-1 min-h-[220px]">
                    {incidentNotes}
                  </div>
                </div>
              </div>
            </div>

            {/* Column 3: Active Selected Dispatch Channels & Citizen Notes */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
              
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center justify-between">
                  <span>Assigned Emergency Channels</span>
                  <Building className="text-blue-600 w-4 h-4" />
                </h4>

                {matchedAgencies.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 pt-1 max-h-[160px] overflow-y-auto pr-1">
                    {matchedAgencies.map((agency, idx) => (
                      <div 
                        key={idx} 
                        className={`px-3 py-2 rounded-xl border flex items-center gap-3 transition-all text-xs font-bold shadow-sm ${agency.color}`}
                      >
                        <span className="text-lg bg-white/70 px-1.5 py-0.5 rounded border border-black/5">{agency.icon}</span>
                        <div className="min-w-0">
                          <p className="truncate text-slate-900 font-extrabold leading-tight">{agency.id}</p>
                          <p className="text-[9px] opacity-75 truncate font-normal mt-0.5">{agency.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400 font-medium bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                    No responder channels assigned yet
                  </div>
                )}
              </div>

              {/* Exact output rendering for Citizen Notes */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
                  <span>Citizen Notes</span>
                </span>
                <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-medium text-slate-800 leading-relaxed shadow-inner min-h-[96px] max-h-[140px] overflow-y-auto whitespace-pre-line">
                  {citizenNotesContent}
                </div>
              </div>

            </div>

          </div>

        </div>

        {/* Action Panel Footer */}
        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-semibold">
            <Shield className="text-slate-400 w-4 h-4" />
            <span>Read-Only Incident Record View</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">

            <button 
              onClick={onClose} 
              className="px-5 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition-all active:scale-95"
            >
              Close Preview
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
}
