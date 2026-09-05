import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  MessageSquare
} from 'lucide-react';

import { DashRing } from "@/components/dash-ring";

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

const getIncidentBadgeStyle = (incidentType) => {
  const normalized = (incidentType || '').trim().toLowerCase();
  if (normalized.includes('fire')) return 'bg-red-600 text-white border-red-700';
  if (normalized.includes('flood')) return 'bg-blue-600 text-white border-blue-700';
  if (normalized.includes('accident')) return 'bg-yellow-500 text-slate-900 border-yellow-600';
  return 'bg-orange-600 text-white border-orange-700';
};

const getVideoMimeType = (url, declaredType = '') => {
  const type = String(declaredType || '').toLowerCase();
  if (type.startsWith('video/')) return type;

  let pathValue = String(url || '');
  try {
    const parsed = new URL(pathValue, window.location.origin);
    const storagePath = parsed.searchParams.get('storagePath');
    if (storagePath) pathValue += ` ${decodeURIComponent(storagePath)}`;
  } catch (_) {
    // Fall back to the raw URL for malformed or extensionless URLs.
  }

  const extension = pathValue.match(/\.(mp4|m4v|webm|ogg|mov|mpeg|mpg)(?:$|[?#\s])/i)?.[1]?.toLowerCase();
  return {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    mpeg: 'video/mpeg',
    mpg: 'video/mpeg'
  }[extension] || '';
};

const isVideoMedia = (url, declaredType = '') => {
  const value = String(url || '').toLowerCase();
  return String(declaredType || '').toLowerCase().startsWith('video/') ||
    Boolean(getVideoMimeType(url, declaredType)) ||
    /[\\/]video[\\/](upload|raw)[\\/]/i.test(value);
};

export default function PublicReportPage() {
  const { id } = useParams();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const mapRef = useRef(null);
  const pulseOverlayRef = useRef(null);
  const mapInstance = useRef(null);
  const videoRef = useRef(null);
  const [mapPulseColor, setMapPulseColor] = useState('#3b82f6');
  const [isSensitiveRevealed, setIsSensitiveRevealed] = useState(false);
  const [videoHasEnded, setVideoHasEnded] = useState(false);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    setIsSensitiveRevealed(!report?.isSensitive);
    setVideoHasEnded(false);
    setVideoError(false);
  }, [report?.id, report?.mediaUrl, report?.isSensitive]);

  useEffect(() => {
    const fetchSharedTelemetry = async () => {
      if (!id) {
        setError('Missing link validation key.');
        setLoading(false);
        return;
      }

      try {
        // Use the same-origin API path. Vercel rewrites /api/* to Railway
        // in production, and Vite proxies /api/* during development.
        const response = await fetch(
          `/api/links/verify/${encodeURIComponent(id)}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        );

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(
            result.message || 'Access authorization has expired or is invalid.'
          );
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
        
        {/* Soft Animated Background Glows */}
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

        {/* Floating Card Container */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 flex flex-col items-center gap-6 p-8 sm:p-10 rounded-3xl bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 shadow-2xl shadow-blue-950/20 max-w-xs text-center"
        >
          {/* DashRing Icon Container with Glow */}
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
  const mediaIsVideo = isVideoMedia(resolvedMediaUrl, resolvedMediaType);
  const videoMimeType = getVideoMimeType(resolvedMediaUrl, resolvedMediaType);
  const finalLat = Number(report.location?.latitude || report.latitude || 0);
  const finalLng = Number(report.location?.longitude || report.longitude || 0);
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${finalLat},${finalLng}`;
  const displayId = report.verifiedReportId || report.verifiedreportID || report.id || '';

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

        {/* ROW 1: MEDIA & OPENLAYERS MAP */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          
          {/* EVIDENCE MEDIA */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-80 sm:h-[450px]">
            <div className="relative w-full h-full bg-slate-950 flex items-center justify-center overflow-hidden">
              {resolvedMediaUrl ? (
                mediaIsVideo ? (
                  <>
                    {report.isSensitive && !isSensitiveRevealed ? (
                      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-6 text-center text-white">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-300 ring-1 ring-red-400/30">
                          <AlertTriangle className="h-7 w-7" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold tracking-wide">Graphic content warning</h3>
                          <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-300">
                            This video may contain disturbing or graphic content. Tap below to reveal and play it.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsSensitiveRevealed(true);
                            setVideoHasEnded(false);
                            setVideoError(false);
                          }}
                          className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-slate-900 shadow-lg transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-white/70"
                        >
                          Click to reveal video
                        </button>
                      </div>
                    ) : (
                      <>
                        <video
                          key={`${resolvedMediaUrl}-${isSensitiveRevealed}`}
                          ref={videoRef}
                          autoPlay
                          muted
                          playsInline
                          controls
                          preload="metadata"
                          crossOrigin="anonymous"
                          onPlay={() => setVideoHasEnded(false)}
                          onEnded={() => setVideoHasEnded(true)}
                          onError={() => setVideoError(true)}
                          onCanPlay={() => {
                            videoRef.current?.play().catch(() => {
                              // Native controls remain available if autoplay is blocked.
                            });
                          }}
                          className="w-full h-full object-contain"
                        >
                          <source src={resolvedMediaUrl} type={videoMimeType || undefined} />
                          Your browser does not support this video format.
                        </video>

                        {videoHasEnded && !videoError && (
                          <button
                            type="button"
                            onClick={() => {
                              const video = videoRef.current;
                              if (!video) return;
                              setVideoHasEnded(false);
                              video.currentTime = 0;
                              video.play().catch(() => setVideoError(true));
                            }}
                            className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white/95 px-4 py-2 text-xs font-bold text-slate-900 shadow-xl transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-white/70"
                          >
                            Play again
                          </button>
                        )}

                        {videoError && (
                          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-950/90 p-6 text-center text-white">
                            <AlertTriangle className="h-7 w-7 text-amber-300" />
                            <p className="text-xs text-slate-200">This video could not be played in this browser.</p>
                            <a
                              href={resolvedMediaUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-slate-900 hover:bg-slate-200"
                            >
                              Open video
                            </a>
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <img src={resolvedMediaUrl} alt="Primary Scene Evidence" className="w-full h-full object-contain" />
                )
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500 space-y-2 text-center p-6">
                  <AlertTriangle className="h-8 w-8 text-slate-600 stroke-1" />
                  <p className="text-xs font-medium tracking-wide">No Primary Visual Media File Uploaded</p>
                </div>
              )}
              
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950/95 via-slate-950/40 to-transparent p-5 pt-12 flex flex-col gap-0.5 z-10">
                <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5 fill-current text-blue-400" />
                  <span>Primary Evidentiary Capture</span>
                </h4>
                <p className="text-[11px] text-slate-300">Logged via verified source channel</p>
              </div>
            </div>
          </div>

          {/* GEOSPATIAL MAP */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-80 sm:h-[450px] relative">
            <div ref={mapRef} className="w-full h-full bg-slate-100 block" />
          </div>

        </div>

        {/* ROW 2: DATA STRIPS & METRICS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          
          {/* GEOLOCATION METRICS CARD */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4 h-full flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="text-xs font-bold tracking-wider text-blue-600 uppercase flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" /> 
                <span>Incident Location</span>
              </h3>
              
              <div className="space-y-3">
                {(report.location?.address || report.address) && (
                  <p className="text-base font-semibold text-slate-900 leading-snug">
                    {report.location?.address || report.address}
                  </p>
                )}

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <code className="text-xs font-mono text-slate-600 block">
                    Coordinates: {finalLat.toFixed(6)}, {finalLng.toFixed(6)}
                  </code>
                </div>
              </div>
            </div>

            <div className="pt-4">
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

          {/* HAZARDS & NOTES PIPELINE */}
          <div className="space-y-6 h-full flex flex-col">
            
            {/* HAZARD SUMMARY */}
            {report.hazard && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center gap-3 shrink-0">
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg shrink-0">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Hazard</span>
                  <span className="text-sm font-bold text-slate-900">{report.hazard}</span>
                </div>
              </div>
            )}

            {/* REMARKS VIEWPORT */}
            {(report.citizenNotes || report.citizenComment || report.citizenRemarks) && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-2 flex-1">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-slate-500" />
                  <span>Citizen Notes</span>
                </h3>
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 h-[calc(100%-2rem)] overflow-y-auto">
                  <p className="text-sm text-slate-700 leading-relaxed font-medium whitespace-pre-line">
                    {report.citizenNotes || report.citizenComment || report.citizenRemarks}
                  </p>
                </div>
              </div>
            )}

            {/* AUDIO DISPATCH PLUGINS */}
            {(report.audioUrl || report.voicenoteUrl) && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-3 shrink-0">
                <h3 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-purple-500" /> 
                  <span>Incident Audio Dispatch Logs</span>
                </h3>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex items-center justify-between gap-4">
                  <audio 
                    src={report.audioUrl || report.voicenoteUrl} 
                    controls 
                    className="w-full h-8 accent-blue-600" 
                  />
                </div>
              </div>
            )}

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
