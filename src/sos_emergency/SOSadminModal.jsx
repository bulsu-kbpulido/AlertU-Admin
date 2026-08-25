import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../firebase';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import socket, { joinSosRoom, leaveSosRoom, onSosLocationUpdated, onSosStatusUpdated } from '../socket';
import { motion, AnimatePresence } from 'framer-motion';
import { useSOSRingtone } from '../useSOSRingtone'; // Ensure correct relative path

// OpenLayers Imports
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { Style, Icon } from 'ol/style';

// Lucide React Icons
import { 
  ShieldAlert, 
  MapPin, 
  ExternalLink, 
  User, 
  Phone, 
  Mail, 
  Users, 
  Minimize2, 
  Maximize2, 
  X, 
  Clock, 
  Radio, 
  GripHorizontal,
  AlertTriangle
} from 'lucide-react';

/**
 * SOS Emergency Citizen Location Tracker & Dispatch Modal
 * OpenLayers + OpenStreetMap (OSM) with live fallback resolution for Phone & Emergency Contacts.
 */
export default function SOSadminModal({
  sosId,
  targetRoom,
  citizenName,
  submitterName,
  citizenId,
  citizenPhone,
  submitterPhone,
  phone,
  citizenEmail,
  submitterEmail,
  email,
  locationData,
  emergencyContacts = [],
  sosDetails,
  adminId,
  adminName,
  onClose,
  backendUrl,
}) {
  const { startRingtone, stopRingtone } = useSOSRingtone('/sosring.mp3');

  const resolvedBackendUrl = useMemo(() => {
    return backendUrl || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
  }, [backendUrl]);

  // Format ID to clean standard key
  const activeSosId = useMemo(() => {
    const raw = sosId || (targetRoom ? targetRoom.replace(/^sos_/, '') : null);
    if (!raw) return null;
    const clean = String(raw).trim();
    return clean.startsWith('sos_') ? clean : `sos_${clean}`;
  }, [sosId, targetRoom]);

  // State to capture live document updates from Firestore
  const [docData, setDocData] = useState(null);
  const [userProfileData, setUserProfileData] = useState(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Helper to extract valid non-empty string values
  const isValidVal = (val) => {
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim();
    return trimmed !== '' && trimmed.toUpperCase() !== 'N/A' && trimmed !== 'undefined' && trimmed !== 'null';
  };

  // 📞 Phone Resolution Fallback Chain (Props -> SOS Alert Doc -> Users Collection Doc)
  const displayPhone = useMemo(() => {
    if (isValidVal(citizenPhone)) return citizenPhone.trim();
    if (isValidVal(submitterPhone)) return submitterPhone.trim();
    if (isValidVal(phone)) return phone.trim();

    if (docData) {
      if (isValidVal(docData.citizenPhone)) return docData.citizenPhone.trim();
      if (isValidVal(docData.submitterPhone)) return docData.submitterPhone.trim();
      if (isValidVal(docData.phone)) return docData.phone.trim();
    }

    if (userProfileData) {
      if (isValidVal(userProfileData.phone)) return userProfileData.phone.trim();
      if (isValidVal(userProfileData.phoneNumber)) return userProfileData.phoneNumber.trim();
      if (isValidVal(userProfileData.contactNumber)) return userProfileData.contactNumber.trim();
    }

    return 'N/A';
  }, [citizenPhone, submitterPhone, phone, docData, userProfileData]);

  // ✉️ Email Resolution Fallback Chain
  const displayEmail = useMemo(() => {
    if (isValidVal(citizenEmail)) return citizenEmail.trim();
    if (isValidVal(submitterEmail)) return submitterEmail.trim();
    if (isValidVal(email)) return email.trim();

    if (docData) {
      if (isValidVal(docData.citizenEmail)) return docData.citizenEmail.trim();
      if (isValidVal(docData.submitterEmail)) return docData.submitterEmail.trim();
      if (isValidVal(docData.email)) return docData.email.trim();
    }

    if (userProfileData) {
      if (isValidVal(userProfileData.email)) return userProfileData.email.trim();
    }

    return 'N/A';
  }, [citizenEmail, submitterEmail, email, docData, userProfileData]);

  // 👤 Name Resolution
  const displayName = useMemo(() => {
    if (isValidVal(citizenName)) return citizenName.trim();
    if (isValidVal(submitterName)) return submitterName.trim();

    if (docData) {
      if (isValidVal(docData.citizenName)) return docData.citizenName.trim();
      if (isValidVal(docData.submitterName)) return docData.submitterName.trim();
    }

    if (userProfileData) {
      if (isValidVal(userProfileData.name)) return userProfileData.name.trim();
      if (isValidVal(userProfileData.displayName)) return userProfileData.displayName.trim();
    }

    return 'Emergency Citizen';
  }, [citizenName, submitterName, docData, userProfileData]);

  // 🚨 Emergency Contacts Parsing Strategy
  const normalizedContacts = useMemo(() => {
    let sourceContacts = [];

    // 1. Check if non-empty contacts array supplied in props
    if (Array.isArray(emergencyContacts) && emergencyContacts.length > 0) {
      sourceContacts = emergencyContacts;
    } 
    // 2. Check if contacts exist in live sos_alerts Firestore document
    else if (docData && Array.isArray(docData.emergencyContacts) && docData.emergencyContacts.length > 0) {
      sourceContacts = docData.emergencyContacts;
    } 
    // 3. Check if contacts exist in user profile doc
    else if (userProfileData && Array.isArray(userProfileData.emergencyContacts) && userProfileData.emergencyContacts.length > 0) {
      sourceContacts = userProfileData.emergencyContacts;
    }

    return sourceContacts.map((contact) => ({
      name: contact.name || contact.fullName || contact.contactName || contact.displayName || 'Unnamed Contact',
      phone: contact.phone || contact.phoneNumber || contact.contactNumber || contact.mobile || contact.tel || 'N/A',
      email: contact.email || contact.emailAddress || 'N/A',
      relation: contact.relation || contact.relationship || contact.type || 'Emergency Contact',
    }));
  }, [emergencyContacts, docData, userProfileData]);

  // Helper to extract coordinates
  const extractCoordinates = useCallback((loc) => {
    if (!loc) return null;

    const gis = loc.gisLocation || loc.location || loc;
    const lat = gis.latitude ?? gis.lat ?? loc.latitude;
    const lng = gis.longitude ?? gis.lng ?? loc.longitude;

    if (lat === undefined || lng === undefined || lat === null || lng === null) return null;

    let timeString = new Date().toLocaleTimeString();
    const rawTime = loc.updatedAt || gis.updatedAt;
    if (rawTime) {
      if (typeof rawTime.toDate === 'function') {
        timeString = rawTime.toDate().toLocaleTimeString();
      } else if (rawTime.seconds) {
        timeString = new Date(rawTime.seconds * 1000).toLocaleTimeString();
      } else {
        timeString = new Date(rawTime).toLocaleTimeString();
      }
    }

    return {
      lat: Number(lat),
      lng: Number(lng),
      address: loc.address || loc.formattedAddress || gis.address || 'Updating location...',
      speed: gis.speed || loc.speed || 0,
      updatedAt: timeString,
    };
  }, []);

  // Initial State
  const [currentLocation, setCurrentLocation] = useState(() => extractCoordinates(locationData));
  const [trackingActive, setTrackingActive] = useState(true);

  // Helper to calculate safe bottom-right docked position on viewport
  const getSafeInitialPosition = useCallback(() => {
    if (typeof window === 'undefined') return { x: 20, y: 20 };
    const widgetWidth = 360;
    const widgetHeight = 280;
    const safeX = Math.max(12, window.innerWidth - widgetWidth - 24);
    const safeY = Math.max(12, window.innerHeight - widgetHeight - 24);
    return { x: safeX, y: safeY };
  }, []);

  // MINIMIZE & DRAG STATES
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState(getSafeInitialPosition);
  const [isDragging, setIsDragging] = useState(false);

  // Keep minimized widget safely clamped within viewport when window resizes/minimizes
  useEffect(() => {
    const handleWindowResize = () => {
      setPosition((prev) => {
        const widgetWidth = 360;
        const widgetHeight = 280;
        const maxX = Math.max(12, window.innerWidth - widgetWidth - 12);
        const maxY = Math.max(12, window.innerHeight - widgetHeight - 12);
        return {
          x: Math.max(12, Math.min(prev.x, maxX)),
          y: Math.max(12, Math.min(prev.y, maxY)),
        };
      });
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const onCloseRef = useRef(onClose);

  // OPENLAYERS MAP REFS
  const mapElementRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerSourceRef = useRef(null);

  // Start SOS alert audio playback automatically when active
  useEffect(() => {
    if (trackingActive) {
      startRingtone();
    }
  }, [trackingActive, startRingtone]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setTrackingActive(true);
    if (locationData) {
      const parsed = extractCoordinates(locationData);
      if (parsed) {
        setCurrentLocation(parsed);
        setIsDataLoaded(true);
      }
    }
  }, [locationData, activeSosId, extractCoordinates]);

  // Custom SVG Map Pin Generator (High contrast red location marker pin)
  const createMarkerStyle = useCallback(() => {
    const svgPin = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="#DC2626" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
        <circle cx="12" cy="10" r="3" fill="#FFFFFF"/>
      </svg>
    `;
    return new Style({
      image: new Icon({
        src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svgPin),
        anchor: [0.5, 1.0],
        scale: 1,
      }),
    });
  }, []);

  // 🗺️ OPENLAYERS INITIALIZATION & UPDATES
  useEffect(() => {
    if (!mapElementRef.current || !currentLocation?.lat || !currentLocation?.lng) return;

    const coords = fromLonLat([currentLocation.lng, currentLocation.lat]);

    if (!mapInstanceRef.current) {
      const markerFeature = new Feature({
        geometry: new Point(coords),
      });

      markerFeature.setStyle(createMarkerStyle());

      const markerSource = new VectorSource({
        features: [markerFeature],
      });
      markerSourceRef.current = markerSource;

      const vectorLayer = new VectorLayer({
        source: markerSource,
      });

      const olMap = new Map({
        target: mapElementRef.current,
        layers: [
          new TileLayer({
            source: new OSM(),
          }),
          vectorLayer,
        ],
        view: new View({
          center: coords,
          zoom: 16,
        }),
      });

      mapInstanceRef.current = olMap;
      setIsDataLoaded(true);
    } else {
      const map = mapInstanceRef.current;
      map.getView().animate({ center: coords, duration: 500 });

      if (markerSourceRef.current) {
        markerSourceRef.current.clear();
        const updatedFeature = new Feature({
          geometry: new Point(coords),
        });
        updatedFeature.setStyle(createMarkerStyle());
        markerSourceRef.current.addFeature(updatedFeature);
      }
    }
  }, [currentLocation, createMarkerStyle]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.updateSize();
      }, 300);
    }
  }, [isMinimized]);

  useEffect(() => {
    return () => {
      stopRingtone();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(null);
        mapInstanceRef.current = null;
      }
    };
  }, [stopRingtone]);

  // 🎯 TARGETED FIRESTORE doc() LISTENER ON sos_alerts
  useEffect(() => {
    if (!activeSosId) return;

    const cleanNumericId = activeSosId.replace(/^sos_/, '');

    joinSosRoom(activeSosId);

    const docRef = doc(db, 'sos_alerts', activeSosId);

    const unsubscribeDoc = onSnapshot(
      docRef,
      async (docSnap) => {
        if (docSnap.metadata.hasPendingWrites) return;

        if (docSnap.exists()) {
          const data = docSnap.data();
          setDocData(data);

          // If phone or contacts are missing in sos_alerts, fetch fallback user document
          const citizenUid = data.citizenUid || data.citizenID || cleanNumericId;
          if (citizenUid && !userProfileData) {
            try {
              const userRef = doc(db, 'users', citizenUid);
              const userSnap = await getDoc(userRef);
              if (userSnap.exists()) {
                setUserProfileData(userSnap.data());
              }
            } catch (err) {
              console.warn('⚠️ Could not fetch user profile fallback:', err);
            }
          }

          const parsed = extractCoordinates(data);
          if (parsed) {
            setCurrentLocation(parsed);
          }

          if (data.status === 'RESOLVED' || data.status === 'CANCELLED' || data.status === 'CLOSED') {
            setTrackingActive(false);
          }

          setIsDataLoaded(true);
        }
      },
      (error) => {
        console.error(`❌ Error in direct doc snapshot for sos_alerts/${activeSosId}:`, error);
        setIsDataLoaded(true);
      }
    );

    const handleLocationUpdate = (data) => {
      const incomingId = data.sosId || data.id || data.cleanSosId;
      if (!incomingId || String(incomingId).replace(/^sos_/, '') === cleanNumericId) {
        const parsed = extractCoordinates(data.gisLocation || data.location || data);
        if (parsed) {
          setCurrentLocation(parsed);
        }
      }
    };

    const handleStatusUpdate = (data) => {
      const incomingId = data.sosId || data.id || data.cleanSosId;
      const normalizedStatus = String(data.status || '').toUpperCase();

      if (
        (!incomingId || String(incomingId).replace(/^sos_/, '') === cleanNumericId) &&
        (normalizedStatus === 'RESOLVED' || normalizedStatus === 'CANCELLED' || normalizedStatus === 'CLOSED')
      ) {
        setTrackingActive(false);
      }
    };

    const unsubscribeSocketLocation = onSosLocationUpdated(handleLocationUpdate);
    const unsubscribeSocketStatus = onSosStatusUpdated(handleStatusUpdate);

    return () => {
      leaveSosRoom(activeSosId);
      unsubscribeDoc();
      if (typeof unsubscribeSocketLocation === 'function') unsubscribeSocketLocation();
      if (typeof unsubscribeSocketStatus === 'function') unsubscribeSocketStatus();
    };
  }, [activeSosId, extractCoordinates]);

  // OPEN LOCATION IN GOOGLE MAPS NEW TAB & STOP RINGTONE
  const handleOpenGoogleMaps = () => {
    stopRingtone();
    if (currentLocation?.lat && currentLocation?.lng) {
      const mapsUrl = `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`;
      window.open(mapsUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // HANDLER TO MINIMIZE & STOP RINGTONE
  const handleMinimize = () => {
    stopRingtone();
    setIsMinimized(true);
  };

  // HANDLER TO CLOSE MODAL & STOP RINGTONE
  const handleCloseModal = () => {
    stopRingtone();
    if (isDataLoaded && onCloseRef.current) {
      onCloseRef.current();
    }
  };

  // DRAGGING LOGIC
  const handleMouseDown = (e) => {
    if (!isMinimized) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleMouseMove = useCallback(
    (e) => {
      if (!isDragging || !isMinimized) return;

      let newX = e.clientX - dragStartRef.current.x;
      let newY = e.clientY - dragStartRef.current.y;

      const widgetWidth = 360;
      const widgetHeight = 280;
      const maxX = window.innerWidth - widgetWidth - 12;
      const maxY = window.innerHeight - widgetHeight - 12;

      newX = Math.max(12, Math.min(newX, maxX));
      newY = Math.max(12, Math.min(newY, maxY));

      setPosition({ x: newX, y: newY });
    },
    [isDragging, isMinimized]
  );

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove]);

  const modalContent = (
    <AnimatePresence>
      <div
        className={
          isMinimized
            ? 'fixed z-[9999] touch-none select-none'
            : 'fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 backdrop-blur-sm text-slate-800 font-sans antialiased overflow-y-auto'
        }
        style={
          isMinimized
            ? {
                left: `${position.x}px`,
                top: `${position.y}px`,
              }
            : {}
        }
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={isDragging ? { duration: 0 } : { duration: 0.2 }}
          className={`relative bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 ${
            isMinimized 
              ? 'w-[360px] border-2 border-slate-300 shadow-xl' 
              : 'w-full max-w-5xl max-h-[92vh]'
          }`}
        >
          {/* Header Bar */}
          {isMinimized ? (
            /* Minimized Drag Handle Header */
            <div
              onMouseDown={handleMouseDown}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200/80 border-b border-slate-200 flex items-center justify-between cursor-grab active:cursor-grabbing transition-colors"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 truncate">
                <GripHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="truncate">{displayName}</span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {currentLocation?.lat && (
                  <button
                    onClick={handleOpenGoogleMaps}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm transition active:scale-95"
                    title="Open location in Google Maps"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                    <span>Maps</span>
                  </button>
                )}
                <button
                  onClick={() => setIsMinimized(false)}
                  className="p-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition active:scale-95"
                  title="Expand Window"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            /* Standard Full Modal Header */
            <header className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/90 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 truncate">
                <div className="p-2 rounded-xl bg-red-50 border border-red-200 text-red-600 shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="truncate">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-600">
                      Live SOS Tracker
                    </span>
                    {trackingActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Radio className="w-3 h-3 text-emerald-600 mr-1 animate-pulse" />
                        Live GPS Signal
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                        Session Closed
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight mt-0.5 truncate">
                    {displayName}
                  </h3>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                {currentLocation?.lat && (
                  <button
                    onClick={handleOpenGoogleMaps}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm transition active:scale-95"
                  >
                    <ExternalLink className="w-4 h-4 text-slate-500" />
                    <span>Open in Google Maps</span>
                  </button>
                )}
                <button
                  onClick={handleMinimize}
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition-all shadow-sm active:scale-95"
                  title="Minimize Window"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCloseModal}
                  disabled={!isDataLoaded}
                  className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-all shadow-sm active:scale-95 ${
                    !isDataLoaded
                      ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                      : 'bg-white border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-600'
                  }`}
                  title={!isDataLoaded ? "Loading location data..." : "Close Tracker"}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>
          )}

          {/* Main Map & Info Body */}
          <div className="flex-1 bg-slate-100 relative overflow-hidden flex flex-col lg:flex-row">
            
            {/* Map Canvas Viewport */}
            <div className={`relative flex-1 bg-slate-200 flex items-center justify-center overflow-hidden ${
              isMinimized ? 'h-48' : 'min-h-[350px] lg:min-h-[460px]'
            }`}>
              <div ref={mapElementRef} className="w-full h-full z-0" />

              {/* Loading Overlay */}
              {!isDataLoaded && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm p-6 text-center text-slate-600">
                  <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-sm font-bold text-slate-800">Acquiring GPS Signal...</p>
                  <p className="text-xs text-slate-500 mt-1">Please wait while location data finishes loading.</p>
                </div>
              )}

              {/* Floating Map Overlay Badge */}
              {currentLocation && !isMinimized && (
                <div className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur-md border border-slate-200 p-3.5 rounded-2xl shadow-lg max-w-xs">
                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-slate-800 line-clamp-2">
                        {currentLocation.address || 'Address updating...'}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500 mt-1">
                        {currentLocation.lat?.toFixed(5)}, {currentLocation.lng?.toFixed(5)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar Details Panel */}
            {!isMinimized && (
              <div className="w-full lg:w-80 bg-white border-t lg:border-t-0 lg:border-l border-slate-200 p-5 flex flex-col justify-between shrink-0 space-y-4">
                <div className="space-y-4 overflow-y-auto max-h-[500px] pr-1">
                  
                  {/* Citizen Card */}
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2.5">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-600">
                      <User className="w-4 h-4 text-red-600" />
                      <span>Citizen Details</span>
                    </div>

                    <div>
                      <h4 className="text-base font-bold text-slate-900">{displayName}</h4>
                    </div>

                    <div className="space-y-1.5 pt-1 text-xs">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-['Roboto',sans-serif] text-sm font-semibold text-slate-800 truncate">{displayPhone}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-semibold text-slate-800 truncate">{displayEmail}</span>
                      </div>
                    </div>

                    {(sosDetails || docData?.sosDetails) && (
                      <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-xs text-amber-800 mt-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <p className="font-medium">{sosDetails || docData?.sosDetails}</p>
                      </div>
                    )}
                  </div>

                  {/* Emergency Contacts List */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
                        <Users className="w-4 h-4 text-slate-500" />
                        <span>Emergency Contacts</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold border border-slate-200">
                        {normalizedContacts.length}
                      </span>
                    </div>

                    {normalizedContacts.length > 0 ? (
                      <div className="space-y-2">
                        {normalizedContacts.map((contact, idx) => (
                          <div
                            key={idx}
                            className="p-3 bg-white border border-slate-200 rounded-xl shadow-sm space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-slate-900 truncate">{contact.name}</p>
                              {contact.relation && (
                                <span className="text-[10px] text-slate-400 font-medium">{contact.relation}</span>
                              )}
                            </div>
                            
                            {/* Larger Emergency Contact Phone Number in Roboto Font */}
                            <p className="font-['Roboto',sans-serif] text-sm font-bold text-slate-800 tracking-wide">
                              {contact.phone}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-500">
                        No emergency contacts listed.
                      </div>
                    )}
                  </div>

                </div>

                {/* Footer Note */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Last Ping: {currentLocation?.updatedAt || 'Live'}</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}