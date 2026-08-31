import React, { useState, useEffect, useRef } from 'react';
import 'ol/ol.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import { Point, LineString, Circle as CircleGeom } from 'ol/geom';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Style, Stroke, Fill, Icon } from 'ol/style';

// Modern Icons
import { 
  FiRefreshCw, 
  FiLock, 
  FiArrowLeft, 
  FiCheckCircle, 
  FiMapPin,
  FiX,
  FiLayers,
  FiCompass,
  FiSliders,
  FiClock
} from 'react-icons/fi';

// UI Helpers & Components
import { BorderBeam } from "@/components/ui/border-beam";
import MapChanger from './Map_Changer';
import { create } from 'zustand';
import { io } from 'socket.io-client';

// 🌐 Dynamic Environment & Server Configuration
const RAW_SERVER_URL = import.meta.env.VITE_BACKEND_URL || 'https://alertu-server-production.up.railway.app';
const CLEAN_SERVER_URL = RAW_SERVER_URL.replace(/\/+$/, '');
const API_BASE_URL = CLEAN_SERVER_URL.endsWith('/api')
  ? CLEAN_SERVER_URL
  : `${CLEAN_SERVER_URL}/api`;

// 🔌 Dynamic Socket.io Connection Base (Strips '/api' suffix if present)
const SOCKET_BASE_URL = CLEAN_SERVER_URL.replace(/\/api$/, '');
const socket = io(SOCKET_BASE_URL, { autoConnect: true });

// Store for managing real-time Admin Session State & Incident Verification Progress
export const useAdminModalStore = create((set) => ({
  activeAdminId: 'admin_session_01',
  activeStep: 2,
  isCalibrating: false,
  setActiveStep: (step) => set({ activeStep: step }),
  setIsCalibrating: (val) => set({ isCalibrating: val })
}));

const ICON_COLOR_MAP = {
  'accicon.png': '#a855f7',
  'caricon.png': '#eab308',
  'fireicon.png': '#ef4444',
  'floodicon.png': '#06b6d4',
  'quakeicon.png': '#78350f',
  'warnicon.png': '#f97316'
};

const DEFAULT_COLOR_MAP = {
  Fire: '#ef4444',
  Flood: '#2563eb',
  Accident: '#d97706'
};

/**
 * Formats timestamps cleanly
 */
const formatReportTimestamp = (timestamp) => {
  if (!timestamp) return 'Date unavailable';
  try {
    if (typeof timestamp === 'object' && typeof timestamp.toDate === 'function') {
      return timestamp.toDate().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }
    if (typeof timestamp === 'object' && timestamp.seconds !== undefined) {
      return new Date(timestamp.seconds * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }
    if (typeof timestamp === 'string' || timestamp instanceof Date) {
      return new Date(timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }
  } catch (err) {
    console.warn('Timestamp format warning:', err);
  }
  return 'Date unavailable';
};

export default function VerifyIncidentModal({
  isOpen,
  currentStep,
  setCurrentStep,
  selectedReport,
  currentReportLat,
  currentReportLng,
  handleVerifySubmit,
  setIsVerifyModalOpen,
  customLocation,
  setCustomLocation,
  verifiedIncidentType
}) {
  if (!isOpen || currentStep !== 2) return null;

  // Zustand State Management
  const { activeAdminId, setActiveStep, setIsCalibrating } = useAdminModalStore();

  const [isMapChangerOpen, setIsMapChangerOpen] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);

  const activeLat = Number(customLocation?.lat || currentReportLat || selectedReport?.latitude || 14.75);
  const activeLng = Number(customLocation?.lng || currentReportLng || selectedReport?.longitude || 120.95);
  const activeAddress = customLocation?.address || selectedReport?.address || 'Location details pending...';

  const formattedReportId = 
    selectedReport?.reportId || 
    selectedReport?.customId || 
    selectedReport?.formattedId ||
    (selectedReport?.id && !isNaN(selectedReport.id) ? `RID${String(selectedReport.id).padStart(8, '0')}` : selectedReport?.id || 'UNASSIGNED');

  const reportTimestamp = formatReportTimestamp(selectedReport?.createdAt || selectedReport?.timestamp);

  const incidentType = verifiedIncidentType || selectedReport?.incidentType || 'Fire';

  const isFire = incidentType === 'Fire';
  const isFlood = incidentType === 'Flood';
  const isAccident = incidentType === 'Accident';
  const isOthers = !isFire && !isFlood && !isAccident;

  const [radius, setRadius] = useState(300);
  const [othersMode, setOthersMode] = useState('radius');

  const [markerMap] = useState({
    Fire: 'fireicon.png',
    Flood: 'floodicon.png',
    Accident: 'accicon.png',
    Others: 'warnicon.png'
  });

  const [orsRoutes, setOrsRoutes] = useState([]);
  const [clickedPoints, setClickedPoints] = useState([]);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const mapElement = useRef(null);
  const mapInstance = useRef(null);
  const markerSource = useRef(new VectorSource());
  const geometrySource = useRef(new VectorSource());

  // Socket.io Listener + Zustand Event Broadcast Engine
  useEffect(() => {
    setActiveStep(2);
    setIsCalibrating(true);

    const payload = {
      adminId: activeAdminId,
      incidentId: selectedReport?.id || selectedReport?._id || 'UNASSIGNED',
      incidentType,
      step: 2,
      timestamp: new Date().toISOString()
    };

    socket.emit('admin:enter_step_2', payload);

    return () => {
      socket.emit('admin:leave_step_2', payload);
      setIsCalibrating(false);
    };
  }, [selectedReport, incidentType]);

  const hexToRgba = (hex, alpha) => {
    const cleanHex = (hex || '#2563eb').replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const handleConfirm = async () => {
    let geometryPayload = {};

    if (isFire || (isOthers && othersMode === 'radius')) {
      geometryPayload = {
        radius: {
          centerLat: activeLat,
          centerLng: activeLng,
          radiusMeters: radius
        }
      };
    } else if (isFlood || isAccident || (isOthers && othersMode === 'polyline')) {
      if (clickedPoints.length < 2) {
        alert("Please click two points on the map to define the route path.");
        return;
      }
      geometryPayload = {
        polyline: [
          { lat: clickedPoints[0][1], lng: clickedPoints[0][0] },
          { lat: clickedPoints[1][1], lng: clickedPoints[1][0] }
        ]
      };
    }

    const spatialData = {
      ...geometryPayload,
      selectedMarkerIcon: markerMap[isOthers ? 'Others' : incidentType] || 'warnicon.png',
      routeCoords: Array.isArray(orsRoutes) && orsRoutes.length > 0
        ? orsRoutes[0].map(([lng, lat], idx) => ({ lat, lng, order: idx }))
        : []
    };

    socket.emit('admin:confirm_step_2_calibration', {
      adminId: activeAdminId,
      incidentId: selectedReport?.id || selectedReport?._id,
      spatialData
    });

    handleVerifySubmit('verified', spatialData);
  };

  const fetchORSGeometries = async (startPair, endPair) => {
    setLoadingRoute(true);
    try {
      const backendUrl = `${API_BASE_URL}/ors/directions?start=${startPair[0]},${startPair[1]}&end=${endPair[0]},${endPair[1]}`;
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) throw new Error(`Proxy error status: ${response.status}`);
      const data = await response.json();

      if (data.features && data.features.length > 0 && data.features[0].geometry) {
        setOrsRoutes([data.features[0].geometry.coordinates]);
      }
    } catch (err) {
      console.error("Route calculation error via proxy:", err);
    } finally {
      setLoadingRoute(false);
    }
  };

  // OpenLayers Map Lifecycle
  useEffect(() => {
    if (!mapElement.current) return;

    if (!mapInstance.current) {
      const centerMeters = fromLonLat([activeLng, activeLat]);
      const baseTile = new TileLayer({ source: new OSM() });
      const geomLayer = new VectorLayer({ source: geometrySource.current, zIndex: 10 });
      const markerLayer = new VectorLayer({ source: markerSource.current, zIndex: 20 });

      const map = new Map({
        target: mapElement.current,
        layers: [baseTile, geomLayer, markerLayer],
        view: new View({ center: centerMeters, zoom: 15, multiWorld: false })
      });

      map.on('singleclick', (event) => {
        const [clickLng, clickLat] = toLonLat(event.coordinate);
        setClickedPoints((prev) => {
          if (prev.length >= 2) return prev;
          const updatedPoints = [...prev, [clickLng, clickLat]];
          if (updatedPoints.length === 2) {
            fetchORSGeometries(updatedPoints[0], updatedPoints[1]);
          }
          return updatedPoints;
        });
      });

      mapInstance.current = map;

      // Force size update to prevent blank/zero-sized viewport in flex layout
      setTimeout(() => {
        if (mapInstance.current) {
          mapInstance.current.updateSize();
        }
        setIsMapReady(true);
      }, 150);
    } else {
      mapInstance.current.getView().setCenter(fromLonLat([activeLng, activeLat]));
      mapInstance.current.updateSize();
    }

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstance.current) mapInstance.current.updateSize();
    });
    resizeObserver.observe(mapElement.current);

    return () => resizeObserver.disconnect();
  }, [isOpen]);

  useEffect(() => {
    if (mapInstance.current) {
      mapInstance.current.getView().animate({
        center: fromLonLat([activeLng, activeLat]),
        duration: 350
      });
      mapInstance.current.updateSize();
    }
  }, [activeLat, activeLng]);

  // Spatial Vector Layers Drawing
  useEffect(() => {
    if (!mapInstance.current || !markerSource.current || !geometrySource.current) return;

    markerSource.current.clear();
    geometrySource.current.clear();

    const centerMeters = fromLonLat([activeLng, activeLat]);
    const featuresToAdd = [];
    const currentSelectedIcon = markerMap[isOthers ? 'Others' : incidentType] || 'warnicon.png';

    const activeColor = isOthers
      ? (ICON_COLOR_MAP[currentSelectedIcon] || '#a855f7')
      : (DEFAULT_COLOR_MAP[incidentType] || '#2563eb');

    if (isFire || isOthers) {
      const showRadius = isFire || (isOthers && othersMode !== 'polyline');
      if (showRadius) {
        const circleZone = new Feature({ geometry: new CircleGeom(centerMeters, radius) });
        circleZone.setStyle(new Style({
          stroke: new Stroke({ color: activeColor, width: 2.5 }),
          fill: new Fill({ color: hexToRgba(activeColor, 0.18) })
        }));
        featuresToAdd.push(circleZone);
      }
    }

    const showPolyline = !isFire && (!isOthers || othersMode !== 'radius');
    if (showPolyline && orsRoutes && orsRoutes.length > 0) {
      const route = orsRoutes[0];
      if (Array.isArray(route)) {
        const transformedCoords = route.map(coord => fromLonLat(coord));
        const routeLine = new Feature({ geometry: new LineString(transformedCoords) });
        routeLine.setStyle(new Style({
          stroke: new Stroke({ color: activeColor, width: 6, lineCap: 'round' })
        }));
        featuresToAdd.push(routeLine);
      }
    }

    clickedPoints.forEach((pt) => {
      const pointFeature = new Feature({ geometry: new Point(fromLonLat(pt)) });
      pointFeature.setStyle(new Style({
        image: new Icon({
          anchor: [0.5, 0.5],
          src: `/${currentSelectedIcon}`,
          scale: 0.85
        })
      }));
      featuresToAdd.push(pointFeature);
    });

    const validFeatures = featuresToAdd.filter(f => f && f.getGeometry);
    if (validFeatures.length > 0) geometrySource.current.addFeatures(validFeatures);

    const mainMarker = new Feature({ geometry: new Point(centerMeters) });
    mainMarker.setStyle(new Style({
      image: new Icon({ anchor: [0.5, 1], src: `/${currentSelectedIcon}`, scale: 1.2 })
    }));
    markerSource.current.addFeature(mainMarker);

  }, [incidentType, radius, othersMode, orsRoutes, clickedPoints, activeLat, activeLng, markerMap, isFire, isOthers]);

  const handleResetWorkspace = () => {
    setClickedPoints([]);
    setOrsRoutes([]);
  };

  const handleClose = () => {
    if (typeof setIsVerifyModalOpen === 'function') {
      setIsVerifyModalOpen(false);
    } else {
      setCurrentStep(1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-sm text-slate-800 dark:text-slate-100 font-sans antialiased overflow-y-auto">
      
      {/* Outer Modal Container */}
      <div className="relative w-full max-w-6xl h-[90vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
        
        {/* MagicUI BorderBeam Integration */}
        <BorderBeam size={250} duration={12} delay={9} colorFrom="#3b82f6" colorTo="#6366f1" />

        {/* Modal Header Bar */}
        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 shrink-0">
              <FiCompass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  Verification Step 2
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Spatial Mapping
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight mt-0.5 flex items-center gap-2">
                Report #{formattedReportId}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-4 justify-between sm:justify-end">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <FiClock className="text-slate-400 w-3.5 h-3.5" />
              <span>{reportTimestamp}</span>
            </div>
            
            <button 
              onClick={handleClose} 
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-all shadow-sm active:scale-95 z-10"
              aria-label="Close dialog"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Modal Body: Map & Calibration Sidebar */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-50/30 dark:bg-slate-950/20">
          
          {/* Main Map View Area */}
          <div className="flex-1 h-full min-h-[350px] relative border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-100">
            {!isMapReady && (
              <div className="absolute inset-0 z-30 bg-slate-100 p-6 flex flex-col justify-between animate-pulse">
                <div className="w-48 h-10 bg-slate-200 rounded-xl" />
                <div className="space-y-3">
                  <div className="w-full h-12 bg-slate-200 rounded-xl" />
                  <div className="w-3/4 h-8 bg-slate-200 rounded-xl" />
                </div>
              </div>
            )}

            {/* OpenLayers Map Canvas Container */}
            <div ref={mapElement} className="w-full h-full absolute inset-0 z-10" />

            {/* Instruction Overlay Banner */}
            <div className="absolute top-3 left-3 right-3 z-20 bg-white/90 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2.5 text-xs text-slate-700 pointer-events-none">
              <FiLayers className="text-blue-600 w-4 h-4 shrink-0" />
              <span className="font-medium">
                {(isFlood || isAccident || (isOthers && othersMode === 'polyline'))
                  ? 'Click two points directly on the map to plot the affected road or route.'
                  : 'Adjust the impact area radius slider on the right sidebar.'}
              </span>
            </div>
          </div>

          {/* Right Control & Settings Panel */}
          <aside className="w-full lg:w-[380px] shrink-0 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between overflow-y-auto space-y-5 border-l border-slate-100 dark:border-slate-800">
            
            <div className="space-y-5">
              
              {/* Incident Profile Info Header */}
              <div className="space-y-3 pb-4 border-b border-slate-100">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center justify-between">
                  <span>Incident Type</span>
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5">
                    <FiLock className="w-3 h-3 text-blue-500" />
                    {incidentType}
                  </span>
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Mapping options are configured based on the verified incident type.
                </p>
              </div>

              {/* Dynamic Mapping Controls */}
              <div className="space-y-4">
                
                {/* Polyline Route Controls (Flood, Accident, or Custom Polyline) */}
                {(isFlood || isAccident || (isOthers && othersMode === 'polyline')) && (
                  <div className="bg-slate-50 dark:bg-slate-800/70 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        Route Line Points
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-100 text-blue-700">
                        {clickedPoints.length} / 2 Points Selected
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      {clickedPoints.length === 0 && 'Click start point on map.'}
                      {clickedPoints.length === 1 && 'Click end point on map.'}
                      {clickedPoints.length === 2 && '✓ Route created between points.'}
                    </p>

                    {clickedPoints.length > 0 && (
                      <button
                        onClick={handleResetWorkspace}
                        className="w-full py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95"
                      >
                        <FiRefreshCw className="w-3.5 h-3.5 text-slate-500" />
                        <span>Clear Map Points</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Radius Containment Controls (Fire, or Custom Radius) */}
                {(isFire || (isOthers && othersMode === 'radius')) && (
                  <div className="bg-slate-50 dark:bg-slate-800/70 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <FiSliders className="w-3.5 h-3.5 text-blue-600" /> Containment Radius
                      </label>
                      <span className="font-mono font-bold text-xs text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                        {radius} m
                      </span>
                    </div>

                    {/* Custom Styled Slider */}
                    <div className="space-y-2 pt-1">
                      <input
                        type="range"
                        min="10"
                        max="1000"
                        step="10"
                        value={radius}
                        onChange={(e) => setRadius(Number(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 focus:outline-none"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                        <span>10m</span>
                        <span>500m</span>
                        <span>1000m</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Others Drawing Mode Switcher */}
                {isOthers && (
                  <div className="bg-slate-50 dark:bg-slate-800/70 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                    <label className="text-xs font-bold text-slate-700 block">
                      Select Mapping Style
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {['radius', 'polyline'].map((m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setOthersMode(m);
                            handleResetWorkspace();
                          }}
                          className={`py-2 text-xs font-bold capitalize rounded-lg transition-all border ${
                            othersMode === m
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {m === 'radius' ? 'Area Radius' : 'Road Route'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Target Location Metadata Box */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <FiMapPin className="text-blue-600 w-3.5 h-3.5" /> Target Coordinates
              </span>
              <p className="text-slate-600 font-medium truncate">{activeAddress}</p>
              <p className="text-slate-400 font-mono text-[11px]">
                {activeLat.toFixed(5)}°, {activeLng.toFixed(5)}°
              </p>
            </div>

          </aside>
        </div>

        {/* Modal Action Footer */}
        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600 font-medium">
            <FiCheckCircle className="text-emerald-600 w-4 h-4" />
            <span>Ready for final report dispatch verification</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={() => {
                setActiveStep(1);
                setCurrentStep(1);
              }}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-all shadow-sm active:scale-95 flex items-center gap-1.5"
            >
              <FiArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            <button
              disabled={loadingRoute || clickedPoints.length === 1}
              onClick={handleConfirm}
              className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center gap-2 active:scale-95 ${
                loadingRoute || clickedPoints.length === 1
                  ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600'
              }`}
            >
              <span>{loadingRoute ? 'Calculating Route...' : 'Confirm Verification'}</span>
              <FiCheckCircle className="w-4 h-4" />
            </button>
          </div>
        </footer>

        {/* Map Location Corrector Component */}
        <MapChanger
          isOpen={isMapChangerOpen}
          onClose={() => setIsMapChangerOpen(false)}
          initialLat={activeLat}
          initialLng={activeLng}
          initialAddress={activeAddress}
          onSave={(updatedTelemetry) => {
            if (typeof setCustomLocation === 'function') {
              setCustomLocation({
                lat: Number(updatedTelemetry.latitude),
                lng: Number(updatedTelemetry.longitude),
                address: updatedTelemetry.address
              });
            }
            handleResetWorkspace();
          }}
        />

      </div>
    </div>
  );
}
