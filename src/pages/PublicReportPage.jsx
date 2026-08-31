import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
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

import { 
  MapPin, 
  Clock, 
  AlertTriangle, 
  ExternalLink, 
  Play, 
  Volume2, 
  Calendar, 
  Tag,
  Shield,
  CornerDownRight,
  PhoneCall,
  MessageSquare,
  User,
  Mail,
  Phone,
  Building2,
  FileText
} from 'lucide-react';

import { DashRing } from "@/components/dash-ring";

const ICON_COLOR_MAP = {
  'fireicon.png': '#ef4444',
  'floodicon.png': '#3b82f6',
  'accicon.png': '#a855f7',
  'caricon.png': '#a855f7',
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

const getIncidentBadgeStyle = (incidentType) => {
  const normalized = (incidentType || '').trim().toLowerCase();
  if (normalized.includes('fire')) return 'bg-red-600 text-white border-red-700';
  if (normalized.includes('flood')) return 'bg-blue-600 text-white border-blue-700';
  if (normalized.includes('accident')) return 'bg-purple-600 text-white border-purple-700';
  return 'bg-orange-600 text-white border-orange-700';
};

export default function PublicReportPage() {
  const { id } = useParams();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const mapRef = useRef(null);
  const pulseOverlayRef = useRef(null);
  const mapInstance = useRef(null);
  const [mapPulseColor, setMapPulseColor] = useState('#3b82f6');

  useEffect(() => {
    const fetchSharedTelemetry = async () => {
      if (!id) {
        setError('Missing link validation parameters.');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/links/verify/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'This link is invalid or expired.');
        }

        setReport(result.report);
      } catch (err) {
        setError(err.message || 'Unable to load the shared report.');
      } finally {
        setLoading(false);
      }
    };

    fetchSharedTelemetry();
  }, [id]);

  useEffect(() => {
    if (loading || error || !report || !mapRef.current) return;

    const { radius, polyline, location, selectedMarkerIcon, incidentType } = report;
    const centerLat = Number(radius?.centerLat || location?.latitude || report.latitude || 0);
    const centerLng = Number(radius?.centerLng || location?.longitude || report.longitude || 0);
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
      line.setStyle(new Style({ stroke: new Stroke({ color: activeColor, width: 5, lineCap: 'round' }) }));
      geometrySource.addFeature(line);
      targetMeters = lineGeometry.getCoordinateAt(0.50);
    } else if (polyline && Array.isArray(polyline) && polyline.length >= 2) {
      const lineCoords = polyline.map(pt => fromLonLat([Number(pt.lng), Number(pt.lat)]));
      const lineGeometry = new LineString(lineCoords);
      const line = new Feature({ geometry: lineGeometry });
      line.setStyle(new Style({ stroke: new Stroke({ color: activeColor, width: 5, lineCap: 'round' }) }));
      geometrySource.addFeature(line);
      targetMeters = lineGeometry.getCoordinateAt(0.50);
    }

    const marker = new Feature({ geometry: new Point(targetMeters) });
    marker.setStyle(new Style({
      image: new Icon({
        anchor: [0.5, 1.0],
        src: `/${iconFile}`,
        scale: 1.0,
      }),
      zIndex: 100 
    }));
    geometrySource.addFeature(marker);

    const vectorLayer = new VectorLayer({ source: geometrySource, zIndex: 10 });
    
    const pulseOverlay = new Overlay({
      element: pulseOverlayRef.current,
      positioning: 'bottom-center',
      stopEvent: false
    });
    pulseOverlay.setPosition(targetMeters);
    
    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        vectorLayer
      ],
      overlays: [pulseOverlay],
      view: new View({ center: targetMeters, zoom: 15.5 })
    });
    mapInstance.current = map;

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
  }, [loading, error, report]);

  const dateTimeMemo = useMemo(() => {
    if (!report) return { date: 'N/A', time: 'N/A' };

    const rawTimestamp =
      report.timestamp ||
      report.reportTimestamp ||
      report.createdAt ||
      report.dateTime ||
      report.date;

    if (!rawTimestamp) return { date: 'N/A', time: 'N/A' };

    let parsedDate = null;

    if (typeof rawTimestamp.toDate === 'function') {
      parsedDate = rawTimestamp.toDate();
    } else if (typeof rawTimestamp === 'object' && rawTimestamp !== null) {
      const secs = rawTimestamp.seconds ?? rawTimestamp._seconds;
      if (typeof secs === 'number') {
        parsedDate = new Date(secs * 1000);
      }
    } else if (typeof rawTimestamp === 'number' || typeof rawTimestamp === 'string') {
      parsedDate = new Date(rawTimestamp);
    }

    if (!parsedDate || isNaN(parsedDate.getTime())) {
      return { date: 'N/A', time: 'N/A' };
    }

    const date = parsedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const time = parsedDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    return { date, time };
  }, [report]);

  // Modern Glassmorphism & Smooth Transition Loading State
  if (loading) {
    return (
      <div className="relative w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 font-['Roboto',sans-serif] overflow-hidden select-none">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.15, 0.25, 0.15] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600 rounded-full blur-[128px] pointer-events-none"
        />
        <motion.div 
          animate={{ scale: [1.2, 1, 1.2], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-600 rounded-full blur-[128px] pointer-events-none"
        />

        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 flex flex-col items-center gap-6 p-8 sm:p-10 rounded-3xl bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-2xl shadow-blue-950/20 max-w-xs text-center"
        >
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-md animate-pulse" />
            <DashRing className="h-10 w-10 text-blue-400 relative z-10 shrink-0" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold tracking-wide text-slate-200">
              Loading report
            </h3>
            <p className="text-[12px] text-slate-500 font-normal">
              Fetching incident details...
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6 font-['Roboto',sans-serif]">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
          <div className="inline-flex p-3 bg-red-500/10 text-red-500 rounded-full mb-4">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">{error}</p>
          <div className="text-xs text-slate-500 bg-slate-950/50 py-2.5 px-4 rounded-lg border border-slate-800/60 font-mono">
            SECURE_HANDSHAKE_FAILURE
          </div>
        </div>
      </div>
    );
  }

  const resolvedMediaUrl = report.mediaUrl || report.media?.url || null;
  const resolvedMediaType = report.mediaType || report.media?.type || '';
  const resolvedAudioUrl = report.audioUrl || report.voicenoteUrl || report.voiceNoteUrl || report.audio?.url || null;
  
  const finalLat = Number(report.location?.latitude || report.latitude || 0);
  const finalLng = Number(report.location?.longitude || report.longitude || 0);
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${finalLat},${finalLng}`;
  const displayId = report.verifiedReportId || report.verifiedreportID || report.id || '';

  // Submitter information resolution
  const submitterName = report.submitterName || report.userName || report.reporterName || report.user?.name || null;
  const submitterEmail = report.submitterEmail || report.userEmail || report.reporterEmail || report.user?.email || null;
  const submitterPhone = report.submitterPhone || report.userPhone || report.phoneNumber || report.contactNumber || report.user?.phone || null;

  // Agencies list resolution
  const agenciesList = Array.isArray(report.selectedAgencies) 
    ? report.selectedAgencies 
    : Array.isArray(report.agencies) 
    ? report.agencies 
    : typeof report.agencies === 'string' 
    ? [report.agencies] 
    : [];

  // Notes resolution (checks Firestore 'notes' field and fallback aliases)
  const citizenNotesText = report.notes || report.citizenNotes || report.citizenComment || report.citizenRemarks || null;
  const adminNotesText = report.adminNotes || report.officialAdvisory || report.remarks || null;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      className="min-h-screen w-full bg-slate-50 text-slate-900 font-['Roboto',sans-serif] flex flex-col"
    >
      
      {/* Centered Map Marker Pulse System */}
      <div className="hidden">
        <div ref={pulseOverlayRef} className="relative flex items-center justify-center pointer-events-none">
          <motion.div
            animate={{ scale: [0.4, 2.0], opacity: [0.6, 0] }}
            transition={{ duration: 2.0, repeat: Infinity, ease: "easeOut" }}
            className="absolute rounded-full w-20 h-20"
            style={{ backgroundColor: hexToRgba(mapPulseColor, 0.4) }}
          />
        </div>
      </div>

      {/* HEADER BAR */}
      <header className="sticky top-0 z-50 w-full bg-white border-b border-slate-200 shadow-xs backdrop-blur-md bg-opacity-95">
        <div className="max-w-7xl mx-auto px-4 h-20 sm:h-24 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src="/logo1.png" alt="Logo" className="h-10 sm:h-12 w-auto object-contain shrink-0" />
            <img src="/AlertU.png" alt="AlertU" className="h-12 sm:h-16 w-auto object-contain shrink-0" />
            <div className="h-8 w-px bg-slate-200 hidden sm:block" />
            <span className="text-sm font-bold uppercase tracking-wider text-slate-400 hidden sm:block">Public Portal</span>
          </div>
          {displayId && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold border border-blue-100">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono text-[11px] truncate max-w-[120px] sm:max-w-none">ID: {displayId}</span>
            </div>
          )}
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 sm:py-8 space-y-6">
        
        {/* TITLE HEADER CARD */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-5 sm:p-6 lg:p-8 relative">
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-blue-600" />
          
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center flex-wrap gap-2">
                {report.incidentType && (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider border shadow-xs ${getIncidentBadgeStyle(report.incidentType)}`}>
                    <Tag className="h-3 w-3 opacity-90" />
                    <span>{report.incidentType}</span>
                  </span>
                )}
                {report.severity && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 uppercase">
                    {report.severity} Severity
                  </span>
                )}
              </div>
              
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
                {report.reportTitle || report.incidentType || 'Incident Report'}
              </h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-blue-500" />
                  {dateTimeMemo.date}
                </span>
                <span className="h-3 w-px bg-slate-300 hidden sm:block" />
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  {dateTimeMemo.time}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* RESPONSIVE LAYOUT MATRIX: Column Left (Details) vs Column Right (Media & Map) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* COLUMN LEFT (5 Cols on Desktop) - Detailed Text Metadata */}
          <div className="col-span-1 lg:col-span-5 space-y-6 flex flex-col order-2 lg:order-1">
            
            {/* INCIDENT LOCATION CARD */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
              <h3 className="text-xs font-bold tracking-wider text-blue-600 uppercase flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" /> 
                <span>Incident Location</span>
              </h3>
              
              <div className="space-y-3">
                <p className="text-base font-semibold text-slate-900 leading-snug">
                  {report.location?.address || report.address || 'Address information unverified'}
                </p>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <code className="text-xs font-mono text-slate-600 block">
                    Coordinates: {finalLat.toFixed(6)}, {finalLng.toFixed(6)}
                  </code>
                </div>

                <a 
                  href={googleMapsUrl} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 shadow-xs transition-all cursor-pointer"
                >
                  <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                  <span>Open Google Maps Navigation</span>
                </a>
              </div>
            </div>

            {/* HAZARD FACTOR */}
            {report.hazard && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg shrink-0">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Hazard Factor</span>
                  <span className="text-sm font-bold text-slate-900">{report.hazard}</span>
                </div>
              </div>
            )}

            {/* SUBMITTER INFORMATION CARD */}
            {(submitterName || submitterEmail || submitterPhone) && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-3">
                <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                  <User className="h-4 w-4 text-slate-500" />
                  <span>Reported By</span>
                </h3>
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-2.5">
                  {submitterName && (
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{submitterName}</span>
                    </div>
                  )}
                  {submitterEmail && (
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                      <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{submitterEmail}</span>
                    </div>
                  )}
                  {submitterPhone && (
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                      <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{submitterPhone}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AGENCIES INVOLVED */}
            {agenciesList.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-3">
                <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-blue-500" />
                  <span>Responding Agencies</span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {agenciesList.map((agency, index) => {
                    const agencyName = typeof agency === 'object' && agency !== null
                      ? (agency.name || agency.label || agency.title || agency.id || JSON.stringify(agency))
                      : String(agency);

                    const agencyKey = typeof agency === 'object' && agency !== null && agency.id 
                      ? agency.id 
                      : index;

                    return (
                      <span 
                        key={agencyKey}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-200"
                      >
                        <Building2 className="h-3 w-3 text-slate-400" />
                        {agencyName}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* OFFICIAL ADVISORY (ADMIN NOTES) */}
            {adminNotesText && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-3">
                <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-500" />
                  <span>Official Advisory</span>
                </h3>
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                  <p className="text-sm text-slate-700 leading-relaxed font-medium whitespace-pre-line">
                    {adminNotesText}
                  </p>
                </div>
              </div>
            )}

            {/* CITIZEN NOTES (ALWAYS VISIBLE) */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-3">
              <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-slate-500" />
                <span>Citizen Notes</span>
              </h3>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                {citizenNotesText ? (
                  <p className="text-sm text-slate-700 leading-relaxed font-medium whitespace-pre-line">
                    {citizenNotesText}
                  </p>
                ) : (
                  <p className="text-xs font-medium text-slate-400 italic">
                    No citizen notes provided for this report.
                  </p>
                )}
              </div>
            </div>

          </div>

          {/* COLUMN RIGHT (7 Cols on Desktop) - Map Canvas & Media Assets */}
          <div className="col-span-1 lg:col-span-7 space-y-6 order-1 lg:order-2">
            
            {/* GEOSPATIAL MAP CANVAS */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-80 sm:h-[420px] relative">
              <div ref={mapRef} className="w-full h-full bg-slate-100 block" />
            </div>

            {/* EVIDENCE MEDIA */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="relative w-full h-72 sm:h-[380px] bg-slate-950 flex items-center justify-center overflow-hidden">
                {resolvedMediaUrl ? (
                  resolvedMediaType.toLowerCase().includes('video') || resolvedMediaUrl.toLowerCase().includes('.mp4') ? (
                    <video src={resolvedMediaUrl} controls className="w-full h-full object-contain" />
                  ) : (
                    <img src={resolvedMediaUrl} alt="Primary Scene Evidence" className="w-full h-full object-contain" />
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-500 space-y-2 text-center p-6">
                    <AlertTriangle className="h-8 w-8 text-slate-600 stroke-1" />
                    <p className="text-xs font-medium tracking-wide">No Primary Visual Media File Uploaded</p>
                  </div>
                )}
                
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950/95 via-slate-950/40 to-transparent p-5 pt-12 flex flex-col gap-0.5 z-10">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                    <Play className="h-3.5 w-3.5 fill-current text-blue-400" />
                    <span>Primary Evidentiary Capture</span>
                  </h4>
                  <p className="text-[11px] text-slate-300">Logged via verified source channel</p>
                </div>
              </div>
            </div>

            {/* AUDIO DISPATCH LOGS */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-3">
              <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-purple-500" /> 
                <span>Incident Audio Dispatch Logs</span>
              </h3>
              
              {resolvedAudioUrl ? (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex items-center justify-between gap-4">
                  <audio 
                    src={resolvedAudioUrl} 
                    controls 
                    className="w-full h-8 accent-blue-600" 
                  />
                </div>
              ) : (
                <div className="bg-slate-50 py-4 px-4 text-center rounded-lg border border-dashed border-slate-200">
                  <p className="text-xs font-medium text-slate-400 italic">
                    Audio recording track is not available for this incident log.
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>
      </main>

      {/* FOOTER CONTROLS */}
      <footer className="mt-auto bg-slate-900 border-t border-slate-800 py-10 px-4 sm:px-6 text-slate-400 text-xs">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 pb-8 border-b border-slate-800">
          <div className="space-y-3">
            <h4 className="text-sm font-bold tracking-wider text-slate-200 uppercase">MDRRMO Operations</h4>
            <p className="text-slate-400 leading-relaxed max-w-sm">
              Disaster risk tracking and telemetry portal channel. Access and information updates are licensed for public emergency usage only.
            </p>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-emerald-950/40 text-emerald-400 font-bold border border-emerald-900/40 text-[10px] tracking-wider uppercase">
              <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping" />
              Gateway Status: Online
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-bold tracking-wider text-slate-200 uppercase">Emergency Service Hotlines</h4>
            <div className="space-y-1 font-mono text-slate-300">
              <p className="flex items-center gap-2 text-sm font-bold text-red-400"><PhoneCall className="h-3.5 w-3.5" /> 911 (Emergency Response)</p>
              <p className="pl-5 text-slate-400">(044) 797-1412</p>
              <p className="pl-5 text-slate-400">(044) 248-7101</p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-bold tracking-wider text-slate-200 uppercase">System Information Links</h4>
            <div className="grid grid-cols-2 gap-2 text-slate-400 font-medium">
              <span className="hover:text-white transition-colors cursor-pointer flex items-center gap-1"><CornerDownRight className="h-3 w-3 text-slate-600" /> Incident Portal</span>
              <span className="hover:text-white transition-colors cursor-pointer flex items-center gap-1"><CornerDownRight className="h-3 w-3 text-slate-600" /> Agency Info</span>
              <span className="hover:text-white transition-colors cursor-pointer flex items-center gap-1"><CornerDownRight className="h-3 w-3 text-slate-600" /> Privacy Registry</span>
              <span className="hover:text-white transition-colors cursor-pointer flex items-center gap-1"><CornerDownRight className="h-3 w-3 text-slate-600" /> Contact Support</span>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-6 text-center text-slate-500 text-[11px] tracking-wide">
          © 2026 <span className="font-bold text-slate-400">ALERT-U</span> · Disaster Risk and Incident Reporting System. All rights protected.
        </div>
      </footer>

    </motion.div>
  );
}
