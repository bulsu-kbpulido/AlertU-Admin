import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

import { 
  X, 
  UploadCloud, 
  AlertCircle, 
  EyeOff, 
  RotateCcw, 
  MapPin,
  CheckCircle2,
  FileText,
  Video,
  Image as ImageIcon,
  Compass,
  Layers,
  Loader2,
  Info
} from 'lucide-react';
import { auth } from '../firebase';

// CONFIGURATIONS
const ALLOWED_MIME_TYPES = ['video/mp4', 'image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.mp4', '.png', '.jpeg', '.jpg', '.webp'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// Relative fallback allows Vite proxy in development or direct domain in production
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const ICON_COLOR_MAP = {
  'accicon.png': '#eab308',
  'caricon.png': '#eab308',
  'fireicon.png': '#ef4444',
  'floodicon.png': '#06b6d4',
  'quakeicon.png': '#78350f',
  'warnicon.png': '#f97316'
};

const DEFAULT_COLOR_MAP = {
  Fire: '#ef4444',
  Flood: '#06b6d4',
  Accident: '#eab308'
};

export default function SetIncRadandPol({
  isOpen,
  onClose,
  onConfirm,
  reportData,
  selectedAgencies = [],
  selectedReport,
  currentReportLat,
  currentReportLng,
  verifiedIncidentType
}) {
  if (!isOpen) return null;

  // FILE / EVIDENCE STAGING STATES
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStep, setUploadStep] = useState('idle');
  const [isSensitive, setIsSensitive] = useState(false);
  const fileInputRef = useRef(null);

  // SPATIAL MODELING & LOCATION STATES
  const activeReport = selectedReport || reportData;
  const initialLat = Number(currentReportLat || activeReport?.latitude || activeReport?.location?.latitude || 14.75);
  const initialLng = Number(currentReportLng || activeReport?.longitude || activeReport?.location?.longitude || 120.95);
  const initialAddress = activeReport?.address || activeReport?.location?.address || 'Location details unavailable.';

  const [latitude, setLatitude] = useState(initialLat);
  const [longitude, setLongitude] = useState(initialLng);
  const [address, setAddress] = useState(initialAddress);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);

  const incidentType = verifiedIncidentType || activeReport?.incidentType || 'Fire';
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
  const clickHandlerRef = useRef(null);

  const hasExistingMedia = Boolean(activeReport?.mediaUrl || activeReport?.media?.url);

  useEffect(() => {
    if (isOpen && !auth.currentUser) {
      setError("Session expired. Please log in again.");
    }
  }, [isOpen]);

  // --- EVIDENCE FILE VALIDATION ---
  const validateFile = (selectedFile) => {
    setError('');
    if (!ALLOWED_MIME_TYPES.includes(selectedFile.type)) {
      const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        setError('Only MP4, PNG, JPEG, and WEBP files are supported.');
        return false;
      }
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError(`File size exceeds 100MB limit. File size: ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`);
      return false;
    }
    return true;
  };

  const handleFileChange = (e) => {
    if (e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      if (validateFile(selectedFile)) {
        setFile(selectedFile);
        setError('');
      } else {
        e.target.value = '';
      }
    }
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      const selectedFile = e.dataTransfer.files[0];
      if (validateFile(selectedFile)) {
        setFile(selectedFile);
        setError('');
      }
    }
  };

  const getFileIcon = (fileType) => {
    if (fileType.includes('video')) return <Video className="w-5 h-5 text-indigo-500" />;
    if (fileType.includes('image')) return <ImageIcon className="w-5 h-5 text-emerald-500" />;
    return <FileText className="w-5 h-5 text-slate-500" />;
  };

  // --- MAP & ROUTING LOGIC ---
  const hexToRgba = (hex, alpha) => {
    const cleanHex = (hex || '#3b82f6').replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const fetchORSGeometries = useCallback(async (startPair, endPair) => {
    setLoadingRoute(true);
    try {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : null;
      
      const backendUrl = `${API_BASE_URL}/api/ors/directions?start=${startPair[0]},${startPair[1]}&end=${endPair[0]},${endPair[1]}`;
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        }
      });

      if (!response.ok) throw new Error(`Routing proxy status: ${response.status}`);
      const data = await response.json();

      if (data.features && data.features.length > 0 && data.features[0].geometry) {
        const lineStringGeometry = data.features[0].geometry.coordinates;
        setOrsRoutes([lineStringGeometry]);
      }
    } catch (err) {
      console.error("Route calculation error:", err);
    } finally {
      setLoadingRoute(false);
    }
  }, []);

  useEffect(() => {
    clickHandlerRef.current = (event) => {
      const [clickLng, clickLat] = toLonLat(event.coordinate);

      // Routing clicks mode
      if (isFlood || isAccident || (isOthers && othersMode === 'polyline')) {
        setClickedPoints((prev) => {
          if (prev.length >= 2) return prev;
          const updatedPoints = [...prev, [clickLng, clickLat]];
          if (updatedPoints.length === 2) fetchORSGeometries(updatedPoints[0], updatedPoints[1]);
          return updatedPoints;
        });
      }
    };
  }, [isFlood, isAccident, isOthers, othersMode, fetchORSGeometries]);

  useEffect(() => {
    if (!isOpen || !mapElement.current) return;

    let resizeObserver;

    if (!mapInstance.current) {
      mapElement.current.innerHTML = '';
      
      const centerMeters = fromLonLat([longitude, latitude]);
      const baseTile = new TileLayer({ source: new OSM() });
      const geomLayer = new VectorLayer({ source: geometrySource.current, zIndex: 10 });
      const markerLayer = new VectorLayer({ source: markerSource.current, zIndex: 20 });

      const map = new Map({
        target: mapElement.current,
        layers: [baseTile, geomLayer, markerLayer],
        view: new View({ center: centerMeters, zoom: 15, multiWorld: false })
      });

      map.on('singleclick', (event) => {
        if (clickHandlerRef.current) clickHandlerRef.current(event);
      });

      mapInstance.current = map;
    } else {
      mapInstance.current.getView().setCenter(fromLonLat([longitude, latitude]));
    }

    resizeObserver = new ResizeObserver(() => {
      mapInstance.current?.updateSize();
    });
    resizeObserver.observe(mapElement.current);

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      if (mapInstance.current) {
        mapInstance.current.setTarget(null);
        mapInstance.current = null;
      }
    };
  }, [isOpen, latitude, longitude]);

  useEffect(() => {
    if (!isOpen || !mapInstance.current || !markerSource.current || !geometrySource.current) return;

    markerSource.current.clear();
    geometrySource.current.clear();

    const centerMeters = fromLonLat([longitude, latitude]);
    const featuresToAdd = [];
    const currentSelectedIcon = markerMap[isOthers ? 'Others' : incidentType] || 'warnicon.png';

    const activeColor = isOthers 
      ? (ICON_COLOR_MAP[currentSelectedIcon] || '#a855f7') 
      : (DEFAULT_COLOR_MAP[incidentType] || '#3b82f6');

    if (isFire || isOthers) {
      const showRadius = isFire || (isOthers && othersMode !== 'polyline');
      if (showRadius) {
        const circleZone = new Feature({ geometry: new CircleGeom(centerMeters, radius) });
        circleZone.setStyle(new Style({
          stroke: new Stroke({ color: activeColor, width: 2 }),
          fill: new Fill({ color: hexToRgba(activeColor, 0.18) })
        }));
        featuresToAdd.push(circleZone);
      }
    }

    const showPolyline = !isFire && (!isOthers || othersMode !== 'radius');
    if (showPolyline && orsRoutes && orsRoutes.length > 0) {
      const route = orsRoutes[0];
      if (Array.isArray(route)) {
        const routeLine = new Feature({ geometry: new LineString(route.map(c => fromLonLat(c))) });
        routeLine.setStyle(new Style({ stroke: new Stroke({ color: activeColor, width: 6, lineCap: 'round' }) }));
        featuresToAdd.push(routeLine);
      }
    }

    const validFeatures = featuresToAdd.filter(f => f && f.getGeometry);
    if (validFeatures.length > 0) geometrySource.current.addFeatures(validFeatures);

    const mainMarker = new Feature({ geometry: new Point(centerMeters) });
    mainMarker.setStyle(new Style({ image: new Icon({ anchor: [0.5, 1], src: `/${currentSelectedIcon}`, scale: 1.15 }) }));
    markerSource.current.addFeature(mainMarker);

  }, [isOpen, incidentType, radius, othersMode, orsRoutes, clickedPoints, latitude, longitude, markerMap, isFire, isOthers]);

  const handleResetWorkspace = () => {
    setClickedPoints([]);
    setOrsRoutes([]);
  };

  // --- SUBMIT WORKFLOW WITH DEFERRED MEDIA UPLOAD & VRID GENERATION ---
  const handleFinalSubmit = async () => {
    // Media Required Validation Check
    if (!file && !hasExistingMedia) {
      setError("Evidence media (Image or Video) is required to save this report.");
      return;
    }

    if ((isFlood || isAccident || (isOthers && othersMode === 'polyline')) && clickedPoints.length < 2) {
      setError("Please click two points on the map to set the affected area.");
      return;
    }

    setIsUploading(true);
    setUploadStep('uploading');
    setError('');
    setUploadProgress(10);

    let uploadedMediaUrl = activeReport?.mediaUrl || activeReport?.media?.url || null;
    let uploadedStoragePath = activeReport?.storagePath || activeReport?.media?.fileName || null;
    let uploadedMediaType = activeReport?.mediaType || activeReport?.media?.type || null;

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Session expired. Please log in again.");
      const token = await user.getIdToken(true);

      // 1. UPLOAD MEDIA TO STORAGE (Endpoint: /api/dispatch-media/upload)
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        
        const reportFolderId = activeReport?.id || `vrid-dispatch-${Date.now()}`;
        formData.append('reportId', reportFolderId);

        const uploadResponse = await fetch(`${API_BASE_URL}/api/dispatch-media/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        });

        setUploadProgress(50);

        if (!uploadResponse.ok) {
          let serverErrorMsg = `HTTP Error ${uploadResponse.status}`;
          try {
            const errJson = await uploadResponse.json();
            serverErrorMsg = errJson.error || errJson.message || serverErrorMsg;
          } catch {
            serverErrorMsg = await uploadResponse.text();
          }
          throw new Error(`Media upload failed: ${serverErrorMsg}`);
        }

        const uploadData = await uploadResponse.json();
        if (!uploadData.success) throw new Error(uploadData.error || "Media upload failed");
        
        uploadedMediaUrl = uploadData.fileUrl;
        uploadedStoragePath = uploadData.storagePath;
        uploadedMediaType = file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
      }

      setUploadStep('saving');
      setUploadProgress(80);

      // 2. BUILD SPATIAL PAYLOADS
      let radiusPayload = null;
      let polylinePayload = null;

      if (isFire || (isOthers && othersMode === 'radius')) {
        radiusPayload = {
          centerLat: latitude,
          centerLng: longitude,
          radiusMeters: radius
        };
      } else if (isFlood || isAccident || (isOthers && othersMode === 'polyline')) {
        polylinePayload = [
          { lat: clickedPoints[0][1], lng: clickedPoints[0][0] },
          { lat: clickedPoints[1][1], lng: clickedPoints[1][0] }
        ];
      }

      const targetAgencies = selectedAgencies.length > 0 
        ? selectedAgencies
        : (activeReport?.selectedAgencies || [{ id: 'default', name: 'General Emergency Response' }]);

      const routeCoordsPayload = Array.isArray(orsRoutes) && orsRoutes.length > 0
        ? orsRoutes[0].map((c, idx) => ({ lat: c[1], lng: c[0], order: idx }))
        : [];

      const targetReportId = activeReport?.id;
      let resultingVRID = '';
      let finalResponseBody = {};

      if (targetReportId) {
        const verifyPayload = {
          incidentType: incidentType,
          verifiedSeverity: activeReport?.severity || activeReport?.verifiedSeverity || "Medium",
          reportTitle: activeReport?.reportTitle || `${incidentType} Incident`,
          adminNotes: activeReport?.adminNotes || "Verified via map confirmation",
          selectedAgencies: targetAgencies,
          correctedLatitude: latitude,
          correctedLongitude: longitude,
          correctedAddress: address,
          radius: radiusPayload,
          polyline: polylinePayload,
          routeCoords: routeCoordsPayload,
          selectedMarkerIcon: markerMap[isOthers ? 'Others' : incidentType] || 'warnicon.png',
          isSensitive: isSensitive,
          mediaUrl: uploadedMediaUrl,
          mediaFileName: uploadedStoragePath,
          mediaType: uploadedMediaType
        };

        const response = await fetch(`${API_BASE_URL}/api/reports/${targetReportId}/verify`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(verifyPayload),
        });

        if (!response.ok) {
          const serverError = await response.text();
          throw new Error(`Failed to confirm report: ${serverError}`);
        }

        finalResponseBody = await response.json();
        resultingVRID = finalResponseBody.verifiedReportID || finalResponseBody.verifiedreportID;

        if (onConfirm) await onConfirm(targetReportId, { ...verifyPayload, verifiedReportId: resultingVRID });
      } else {
        const backendPayload = {
          reportTitle: activeReport?.reportTitle?.trim() || `${incidentType} Incident Report`,
          notes: activeReport?.notes || activeReport?.adminNotes || 'Verified via map confirmation',
          incidentType: incidentType,
          hazard: activeReport?.hazard || 'None',
          severity: activeReport?.severity || 'Medium',
          status: 'verified',
          latitude: latitude,
          longitude: longitude,
          address: address,
          mediaUrl: uploadedMediaUrl,
          mediaType: uploadedMediaType,
          mediaFileName: uploadedStoragePath,
          isSensitive: isSensitive,
          selectedAgencies: selectedAgencies,
          timestamp: new Date().toISOString(),
          routeCoords: routeCoordsPayload,
          radius: radiusPayload,
          polyline: polylinePayload
        };

        const dbResponse = await fetch(`${API_BASE_URL}/api/admin-reports`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(backendPayload)
        });

        if (!dbResponse.ok) {
          const dbErrorText = await dbResponse.text();
          throw new Error(`Database error (${dbResponse.status}): ${dbErrorText}`);
        }

        finalResponseBody = await dbResponse.json();
        if (!finalResponseBody.success || !finalResponseBody.id) {
          throw new Error(finalResponseBody.message || "Failed to retrieve report ID.");
        }

        if (onConfirm) await onConfirm(finalResponseBody.id, finalResponseBody.data);
      }

      setUploadProgress(100);
      setIsUploading(false);
      setUploadStep('idle');
      if (onClose) onClose();

    } catch (err) {
      console.error('❌ Save Error:', err);
      setError(err.message);
      setIsUploading(false);
      setUploadStep('idle');
      setUploadProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 lg:p-6 bg-slate-950/80 backdrop-blur-md font-['Roboto',sans-serif] text-slate-800 dark:text-slate-100">
      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="bg-white dark:bg-slate-900 w-full max-w-7xl h-[92vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800"
      >
        {/* HEADER BAR */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tracking-wide uppercase">
                  Verify Incident
                </span>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md">
                  {incidentType}
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                Set Impact Area & Confirm Report
              </h3>
            </div>
          </div>

          <button 
            onClick={onClose} 
            disabled={isUploading} 
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MAIN BODY (MAP + SIDEBAR) */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
          
          {/* MAP CANVAS */}
          <div className="flex-1 h-full bg-slate-100 dark:bg-slate-950 relative">
            <div ref={mapElement} className="w-full h-full absolute inset-0" />

            {/* FLOATING MAP GUIDANCE INSTRUCTIONS */}
            <div className="absolute top-4 left-4 right-4 lg:right-auto lg:max-w-md z-10 pointer-events-none">
              <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3.5 rounded-xl shadow-lg border border-slate-200/80 dark:border-slate-800/80 pointer-events-auto flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 mt-0.5">
                  <Info className="w-4 h-4" />
                </div>
                <div className="text-xs space-y-1">
                  <span className="font-bold text-slate-900 dark:text-white block">
                    Instructions: {incidentType}
                  </span>
                  <p className="text-slate-600 dark:text-slate-300">
                    {(isFlood || isAccident || (isOthers && othersMode === 'polyline')) ? (
                      <span>Click <b>two points</b> on the map to mark the affected road or route.</span>
                    ) : (
                      <span>Use the slider on the right to change the size of the affected area.</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT CONTROL PANEL */}
          <div className="w-full lg:w-[420px] border-l border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 h-full flex flex-col justify-between overflow-y-auto">
            
            <div className="p-5 space-y-5 flex-1">
              
              {/* MAP AREA CONTROLS */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-500" />
                    <span>Impact Zone</span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Define how wide the area or route is for responders.
                  </p>
                </div>

                {(isFlood || isAccident || (isOthers && othersMode === 'polyline')) && (
                  <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Route Points</span>
                      <span className="text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-md">
                        {clickedPoints.length} / 2 Points Selected
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-xs font-medium space-y-1 border border-slate-200/60 dark:border-slate-800">
                      <p className="text-slate-600 dark:text-slate-400">
                        Status: <span className="font-bold text-slate-800 dark:text-slate-200">
                          {clickedPoints.length === 2 ? 'Route Locked' : 'Click two points on the map'}
                        </span>
                      </p>
                    </div>

                    {clickedPoints.length > 0 && (
                      <button 
                        onClick={handleResetWorkspace} 
                        className="w-full py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-red-600 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-all flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset Selected Points</span>
                      </button>
                    )}
                  </div>
                )}

                {(isFire || (isOthers && othersMode === 'radius')) && (
                  <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Impact Radius
                      </label>
                      <span className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md border border-red-500/20">
                        {radius} meters
                      </span>
                    </div>

                    <div className="space-y-1">
                      <input 
                        type="range" 
                        min="10" 
                        max="1000" 
                        step="10" 
                        value={radius} 
                        onChange={(e) => setRadius(Number(e.target.value))} 
                        className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-red-600" 
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                        <span>10m</span>
                        <span>500m</span>
                        <span>1000m</span>
                      </div>
                    </div>
                  </div>
                )}

                {isOthers && (
                  <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-sm">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                      Map Type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {['radius', 'polyline'].map((mode) => (
                        <button 
                          key={mode} 
                          onClick={() => { setOthersMode(mode); handleResetWorkspace(); }} 
                          className={`py-2 text-xs font-medium capitalize rounded-lg transition-all border ${
                            othersMode === mode 
                              ? 'bg-blue-600 text-white border-blue-600 font-semibold' 
                              : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          {mode === 'radius' ? 'Circle Area' : 'Line / Route'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* EVIDENCE UPLOAD SECTION */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <UploadCloud className="w-3.5 h-3.5 text-blue-500" />
                      <span>Add Photos or Videos</span>
                      <span className="text-rose-500 font-bold text-xs">*</span>
                    </h4>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      {hasExistingMedia ? 'Report contains existing media.' : 'Upload required evidence media before saving.'}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                    file || hasExistingMedia 
                      ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' 
                      : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                  }`}>
                    {file || hasExistingMedia ? 'Attached' : 'Required'}
                  </span>
                </div>

                {!file ? (
                  <label 
                    onDragOver={handleDragOver} 
                    onDragLeave={handleDragLeave} 
                    onDrop={handleDrop} 
                    className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all ${
                      isDragging 
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20' 
                        : !hasExistingMedia
                        ? 'border-rose-300/80 dark:border-rose-900/50 hover:border-rose-400 bg-rose-50/20 dark:bg-rose-950/10'
                        : 'border-slate-300 dark:border-slate-800 hover:border-blue-400 bg-white dark:bg-slate-950'
                    }`}
                  >
                    <UploadCloud className={`w-6 h-6 mb-1.5 ${
                      isDragging 
                        ? 'text-blue-500' 
                        : !hasExistingMedia 
                        ? 'text-rose-400' 
                        : 'text-slate-400'
                    }`} />
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200 text-center">
                      {isDragging ? 'Drop file here' : 'Click or drop media file here'}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      MP4, PNG, JPEG or WEBP • Max 100MB
                    </p>
                    <input 
                      ref={fileInputRef} 
                      type="file" 
                      className="hidden" 
                      onChange={handleFileChange} 
                      accept=".mp4,.png,.jpeg,.jpg,.webp" 
                      disabled={isUploading} 
                    />
                  </label>
                ) : (
                  <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-950 flex items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900">
                        {getFileIcon(file.type)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{file.name}</p>
                        <p className="text-[10px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB • Ready</p>
                      </div>
                    </div>
                    {!isUploading && (
                      <button 
                        onClick={() => { setFile(null); setError(''); if (fileInputRef.current) fileInputRef.current.value = ''; }} 
                        className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-900"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}

                {/* SENSITIVE CONTENT TOGGLE */}
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-3 shadow-sm">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <EyeOff className={`w-3.5 h-3.5 ${isSensitive ? 'text-rose-500' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Sensitive Content</span>
                    </div>
                    <p className="text-[10px] text-slate-500">Blur preview thumbnail</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsSensitive(!isSensitive)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isSensitive ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                        isSensitive ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* ERROR ALERT */}
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl flex gap-2.5 items-center">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-700 dark:text-red-300 font-medium">{error}</p>
                </div>
              )}

              {/* UPLOAD PROGRESS FEEDBACK */}
              {isUploading && (
                <div className="space-y-2 bg-white dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {uploadStep === 'uploading' ? 'Uploading media...' : 'Saving verification...'}
                    </span>
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600 transition-all duration-300" 
                      style={{ width: `${uploadProgress}%` }} 
                    />
                  </div>
                </div>
              )}
            </div>

            {/* LOCATION FOOTER BADGE */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-mono text-slate-500 space-y-1">
              <span className="font-bold text-emerald-600 dark:text-emerald-400 block uppercase tracking-wider text-[10px] font-sans">
                Reported Location
              </span>
              <p className="truncate text-slate-700 dark:text-slate-300">
                {isResolvingAddress ? 'Searching address...' : address}
              </p>
              <p>Lat: {latitude.toFixed(5)}° | Lng: {longitude.toFixed(5)}°</p>
            </div>
          </div>
        </div>

        {/* MODAL ACTION FOOTER */}
        <div className="bg-slate-50/80 dark:bg-slate-950 px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
          <button 
            onClick={onClose} 
            disabled={isUploading} 
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          
          <button 
            disabled={loadingRoute || (clickedPoints.length === 1) || isUploading || (!file && !hasExistingMedia)} 
            onClick={handleFinalSubmit} 
            className={`px-5 py-2 text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 ${
              loadingRoute || clickedPoints.length === 1 || isUploading || (!file && !hasExistingMedia)
                ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed' 
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Save</span>
              </>
            )}
          </button>
        </div>

      </motion.div>
    </div>
  );
}