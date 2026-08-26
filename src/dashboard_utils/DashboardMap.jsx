import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import { circular } from 'ol/geom/Polygon';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { Style, Icon, Stroke, Fill } from 'ol/style';
import { FiPlus, FiMinus } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';
import { easeOut } from 'ol/easing';

// Firebase & Socket Imports
import { db } from '../firebase'; 
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { socket, joinSocketRoom, leaveSocketRoom } from '../socket';

const iconColorMap = {
  'fireicon.png': '#ef4444',
  'floodicon.png': '#3b82f6',
  'accicon.png': '#eab308',
  'caricon.png': '#eab308',
  'quakeicon.png': '#78350f',
  'warnicon.png': '#f97316'
};

const resolveIconFromType = (typeStr) => {
  if (!typeStr) return 'warnicon.png';
  const clean = String(typeStr).toLowerCase().trim();
  if (clean.includes('fire')) return 'fireicon.png';
  if (clean.includes('flood')) return 'floodicon.png';
  if (clean.includes('acc') || clean.includes('car') || clean.includes('crash')) return 'accicon.png';
  if (clean.includes('quake') || clean.includes('earthquake')) return 'quakeicon.png';
  return 'warnicon.png';
};

const severityColorMap = {
  high: '#ef4444',
  medium: '#eab308',
  low: '#10b981'
};

// Radar Beacon Overlay
const MapPulse = ({ map, coordinate, color }) => {
  const elRef = useRef(null);

  useEffect(() => {
    if (!map || !elRef.current || !coordinate) return;
    
    const overlay = new Overlay({
      element: elRef.current,
      position: fromLonLat([Number(coordinate[0]), Number(coordinate[1])]),
      positioning: 'center-center', 
      stopEvent: false, 
      insertFirst: true 
    });
    
    map.addOverlay(overlay);
    
    return () => {
      if (map && overlay) {
        map.removeOverlay(overlay);
      }
    };
  }, [map, coordinate]);

  return (
    <div 
      ref={elRef} 
      className="pointer-events-none absolute"
      style={{ transform: 'translate(-50%, -50%)' }} 
    >
      <motion.div
        initial={{ scale: 0, opacity: 0.85 }}
        animate={{ scale: 4.5, opacity: 0 }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
        style={{
          width: '24px',
          height: '24px',
          backgroundColor: color,
          borderRadius: '50%',
          boxShadow: `0 0 16px ${color}`
        }}
      />
    </div>
  );
};

export default function DashboardMap({ selectedReport, setSelectedReport, mapTargetCoords }) {
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  
  const [mapInstance, setMapInstance] = useState(null);
  const [liveReports, setLiveReports] = useState([]);
  const [activeHoverData, setActiveHoverData] = useState(null);
  
  const vectorSourceRef = useRef(null);
  const popupOverlayRef = useRef(null);

  // Helper to format timestamps gracefully inside the popup card
  const formatReportDateTime = (report) => {
    const raw = report?.timestamp || report?.createdAt || report?.created_at;
    if (!raw) return 'Unknown date and time';
    
    try {
      let dateObj;
      if (typeof raw.toDate === 'function') dateObj = raw.toDate();
      else if (raw.seconds) dateObj = new Date(raw.seconds * 1000);
      else dateObj = new Date(raw);

      if (isNaN(dateObj.getTime())) return 'Unknown date and time';

      return dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return 'Unknown date and time';
    }
  };

  // 1. Initialize OpenLayers Map Engine Centered at Paombong, Bulacan
  useEffect(() => {
    if (!mapRef.current || !popupRef.current) return;

    const vectorSource = new VectorSource();
    vectorSourceRef.current = vectorSource;

    const popupOverlay = new Overlay({
      element: popupRef.current,
      autoPan: false,
      positioning: 'bottom-center',
      offset: [0, -60], 
      stopEvent: false
    });
    popupOverlayRef.current = popupOverlay;

    const map = new Map({
      target: mapRef.current,
      controls: [], 
      layers: [
        new TileLayer({ source: new OSM({ crossOrigin: 'anonymous' }) }),
        new VectorLayer({ source: vectorSource })
      ],
      overlays: [popupOverlay],
      view: new View({
        center: fromLonLat([120.7842, 14.8236]), // Centered at Paombong, Bulacan
        zoom: 14 
      })
    });

    setMapInstance(map);

    // Hover Tooltip
    map.on('pointermove', (evt) => {
      const feature = map.forEachFeatureAtPixel(evt.pixel, (feat) => feat);
      if (feature && feature.get('reportData')) {
        const report = feature.get('reportData');
        const geometry = feature.getGeometry();
        map.getTargetElement().style.cursor = 'pointer';
        
        if (geometry && geometry.getType() === 'Point') {
          popupOverlay.setPosition(geometry.getCoordinates());
        } else {
          popupOverlay.setPosition(evt.coordinate);
        }
        setActiveHoverData(report);
      } else {
        map.getTargetElement().style.cursor = '';
        setActiveHoverData(null);
      }
    });

    // Single Click Feature Selection
    map.on('singleclick', (evt) => {
      const feature = map.forEachFeatureAtPixel(evt.pixel, (feat) => feat);
      if (feature && feature.get('reportData')) {
        const report = feature.get('reportData');
        const geometry = feature.getGeometry();
        if (geometry) {
          if (setSelectedReport) setSelectedReport(report);
          map.getView().animate({
            center: geometry.getCoordinates(),
            zoom: 17,
            duration: 600,
            easing: easeOut
          });
        }
      }
    });

    setTimeout(() => map.updateSize(), 100);

    const resizeObserver = new ResizeObserver(() => {
      map.updateSize();
    });
    if (mapRef.current) {
      resizeObserver.observe(mapRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (map) map.setTarget(undefined);
    };
  }, [setSelectedReport]);

  // 2. Integration: Socket.io Room Joining & Real-time Listeners
  useEffect(() => {
    joinSocketRoom('admins');
    joinSocketRoom('incidents');

    const handleSocketIncident = (newIncident) => {
      if (!newIncident) return;
      
      const formattedIncident = {
        id: newIncident.id || `socket-${Date.now()}`,
        source: 'socket',
        incidentType: newIncident.incidentType || newIncident.type || 'general',
        selectedMarkerIcon: newIncident.selectedMarkerIcon || resolveIconFromType(newIncident.incidentType),
        ...newIncident
      };

      setLiveReports(prev => {
        const exists = prev.some(r => r.id === formattedIncident.id);
        if (exists) {
          return prev.map(r => r.id === formattedIncident.id ? formattedIncident : r);
        }
        return [formattedIncident, ...prev];
      });
    };

    socket.on('new_incident', handleSocketIncident);
    socket.on('incident_updated', handleSocketIncident);

    return () => {
      leaveSocketRoom('admins');
      leaveSocketRoom('incidents');
      socket.off('new_incident', handleSocketIncident);
      socket.off('incident_updated', handleSocketIncident);
    };
  }, []);

  // 3. Real-time Firebase Firestore Stream
  useEffect(() => {
    let approvedList = [];
    let adminList = [];

    const handleNewIncomingIncidents = (combinedList) => {
      setLiveReports(combinedList);
    };

    const unsubApproved = onSnapshot(collection(db, 'approved_reports'), (snapshot) => {
      approvedList = snapshot.docs.map(doc => {
        const data = doc.data();
        const type = data.incidentType || data.hazardType || data.hazard || data.type || 'general';
        return {
          id: doc.id,
          source: 'approved',
          incidentType: type,
          selectedMarkerIcon: data.selectedMarkerIcon || resolveIconFromType(type),
          ...data
        };
      });
      handleNewIncomingIncidents([...approvedList, ...adminList]);
    }, (err) => console.error("Firestore approved_reports stream error:", err));

    const adminQuery = query(collection(db, 'ApprovedAdminReports'), where('isAuthenticated', '==', true));
    const unsubAdmin = onSnapshot(adminQuery, (snapshot) => {
      adminList = snapshot.docs.map(doc => {
        const data = doc.data();
        const type = data.incidentType || data.hazardType || data.hazard || data.type || 'general';
        return {
          id: doc.id,
          source: 'admin',
          incidentType: type,
          selectedMarkerIcon: data.selectedMarkerIcon || resolveIconFromType(type),
          ...data
        };
      });
      handleNewIncomingIncidents([...approvedList, ...adminList]);
    }, (err) => console.error("Firestore ApprovedAdminReports stream error:", err));

    return () => {
      unsubApproved();
      unsubAdmin();
    };
  }, []);

  // 4. Render Vector Layer Features (Icons, Polylines, Radii)
  useEffect(() => {
    if (!vectorSourceRef.current) return;
    vectorSourceRef.current.clear();

    liveReports.forEach((rep) => {
      if (!rep) return;
      
      const lat = Number(rep.radius?.centerLat ?? rep.location?.latitude ?? rep.coords?.[1] ?? 14.8236);
      const lng = Number(rep.radius?.centerLng ?? rep.location?.longitude ?? rep.coords?.[0] ?? 120.7842);
      let pinTarget = [lng, lat];
      let polylinePoints = [];

      const iconFile = rep.selectedMarkerIcon || resolveIconFromType(rep.incidentType);
      const hexColor = iconColorMap[iconFile] || '#3b82f6';

      if (rep.routeCoords && Array.isArray(rep.routeCoords) && rep.routeCoords.length > 0) {
        const sorted = [...rep.routeCoords].sort((a, b) => (a.order || 0) - (b.order || 0));
        polylinePoints = sorted.map(pt => [Number(pt.lng || pt.longitude), Number(pt.lat || pt.latitude)]);
      } else if (rep.polyline && Array.isArray(rep.polyline) && rep.polyline.length >= 2) {
        polylinePoints = rep.polyline.map(pt => [Number(pt.lng || pt.longitude), Number(pt.lat || pt.latitude)]);
      }

      if (polylinePoints.length > 0) {
        pinTarget = polylinePoints[Math.floor(polylinePoints.length / 2)];
        const projectedLineCoords = polylinePoints.map(p => fromLonLat(p));
        const lineGeometry = new LineString(projectedLineCoords);
        const lineFeature = new Feature({ geometry: lineGeometry });
        
        lineFeature.setStyle(new Style({
          stroke: new Stroke({ color: hexColor, width: 4.5, lineJoin: 'round', lineCap: 'round' })
        }));
        vectorSourceRef.current.addFeature(lineFeature);
      } else if (rep.radius) {
        const radiusMeters = Number(rep.radius.radiusMeters) || 300;
        const circleGeom = circular(pinTarget, radiusMeters, 64).transform('EPSG:4326', 'EPSG:3857');
        const radiusFeature = new Feature({ geometry: circleGeom });
        
        radiusFeature.setStyle(new Style({
          fill: new Fill({ color: `${hexColor}26` }),
          stroke: new Stroke({ color: hexColor, width: 2.5 })
        }));
        vectorSourceRef.current.addFeature(radiusFeature);
      }

      const markerFeature = new Feature({ geometry: new Point(fromLonLat(pinTarget)) });
      markerFeature.set('reportData', rep);
      
      markerFeature.setStyle(new Style({
        image: new Icon({
          src: `/${iconFile}`, 
          width: 58,  
          height: 58,
          anchor: [0.5, 1.0], 
          crossOrigin: 'anonymous'
        }),
        zIndex: 100
      }));
      vectorSourceRef.current.addFeature(markerFeature);
    });
  }, [liveReports]);

  // 5. Center View Camera Control
  useEffect(() => {
    if (!mapInstance || (!mapTargetCoords && !selectedReport)) return;

    let target = mapTargetCoords;
    if (selectedReport) {
      const lat = selectedReport.radius?.centerLat ?? selectedReport.location?.latitude ?? selectedReport.coords?.[1];
      const lng = selectedReport.selectedReport?.radius?.centerLng ?? selectedReport.location?.longitude ?? selectedReport.coords?.[0];
      target = [Number(lng), Number(lat)];
    }

    if (target && !isNaN(target[0]) && !isNaN(target[1])) {
      mapInstance.getView().animate({
        center: fromLonLat(target),
        zoom: 17,
        duration: 550,
        easing: easeOut
      });
    }
  }, [mapTargetCoords, selectedReport, mapInstance]);

  const zoomIn = () => {
    if (!mapInstance) return;
    const view = mapInstance.getView();
    view.animate({ zoom: view.getZoom() + 1, duration: 200, easing: easeOut });
  };

  const zoomOut = () => {
    if (!mapInstance) return;
    const view = mapInstance.getView();
    view.animate({ zoom: view.getZoom() - 1, duration: 200, easing: easeOut });
  };

  return (
    <div className="relative w-full h-full min-h-0 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-2xl overflow-hidden bg-slate-900 group">
      {/* Map Engine Viewport */}
      <div ref={mapRef} className="w-full h-full bg-slate-100 dark:bg-slate-950" />

      {/* Pulsing Radar Effect Overlays */}
      {mapInstance && liveReports.map((rep, idx) => {
        const lat = rep.radius?.centerLat ?? rep.location?.latitude ?? rep.coords?.[1] ?? 14.8236;
        const lng = rep.radius?.centerLng ?? rep.location?.longitude ?? rep.coords?.[0] ?? 120.7842;
        let pinTarget = [Number(lng), Number(lat)];
        
        let polylinePoints = [];
        if (rep.routeCoords && rep.routeCoords.length > 0) {
          polylinePoints = [...rep.routeCoords].sort((a, b) => (a.order || 0) - (b.order || 0)).map(pt => [Number(pt.lng || pt.longitude), Number(pt.lat || pt.latitude)]);
        } else if (rep.polyline && rep.polyline.length >= 2) {
          polylinePoints = rep.polyline.map(pt => [Number(pt.lng || pt.longitude), Number(pt.lat || pt.latitude)]);
        }
        
        if (polylinePoints.length > 0) {
          pinTarget = polylinePoints[Math.floor(polylinePoints.length / 2)];
        }
        
        const iconFile = rep.selectedMarkerIcon || resolveIconFromType(rep.incidentType);
        const color = iconColorMap[iconFile] || '#f97316';

        return (
          <MapPulse 
            key={`pulse-${rep.id || idx}`} 
            map={mapInstance} 
            coordinate={pinTarget} 
            color={color} 
          />
        );
      })}

      {/* Zoom Control Buttons */}
      <div className="absolute top-4 left-4 z-40 flex flex-col gap-1.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800/80 shadow-lg">
        <button 
          onClick={zoomIn} 
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg transition-colors"
          title="Zoom In"
        >
          <FiPlus className="text-lg" />
        </button>
        <div className="h-px bg-slate-200 dark:bg-slate-800 w-full" />
        <button 
          onClick={zoomOut} 
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg transition-colors"
          title="Zoom Out"
        >
          <FiMinus className="text-lg" />
        </button>
      </div>

      {/* Hover Info Card */}
      <div ref={popupRef} className="absolute bottom-4 z-50 pointer-events-none transform -translate-x-1/2">
        <AnimatePresence>
          {activeHoverData && (
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-4 rounded-2xl shadow-2xl w-[300px] sm:w-[340px] flex flex-col gap-3 font-sans"
            >
              {/* Header: Title and Severity Pill */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <span 
                  className="text-xs font-bold tracking-wide truncate max-w-[170px]"
                  style={{
                    color: iconColorMap[activeHoverData.selectedMarkerIcon || resolveIconFromType(activeHoverData.incidentType)] || '#f97316'
                  }}
                >
                  {activeHoverData.reportTitle || activeHoverData.hazard || activeHoverData.incidentType || 'Incident'}
                </span>
                
                {(() => {
                  const rawSev = (activeHoverData.verifiedSeverity || activeHoverData.severity || 'medium').toLowerCase();
                  const sevColor = severityColorMap[rawSev] || '#eab308';
                  return (
                    <span 
                      className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border tracking-wide shrink-0 capitalize"
                      style={{
                        backgroundColor: `${sevColor}15`,
                        color: sevColor,
                        borderColor: `${sevColor}30`
                      }}
                    >
                      {rawSev} Severity
                    </span>
                  );
                })()}
              </div>
              
              {/* Incident Details Layout */}
              <div className="flex flex-col gap-2 text-xs">
                {/* Location */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Location
                  </span>
                  <p className="font-medium text-slate-700 dark:text-slate-200 line-clamp-2 leading-relaxed">
                    {typeof activeHoverData.location === 'string' 
                      ? activeHoverData.location 
                      : activeHoverData.location?.address || 'Coordinates Pinpointed'}
                  </p>
                </div>

                {/* Date and Time */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Date & Time
                  </span>
                  <p className="font-medium text-slate-600 dark:text-slate-300">
                    {formatReportDateTime(activeHoverData)}
                  </p>
                </div>
              </div>

              {/* Tooltip Anchor Arrow */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-[8px] border-x-transparent border-t-[8px] border-t-white dark:border-t-slate-900 drop-shadow-md" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}