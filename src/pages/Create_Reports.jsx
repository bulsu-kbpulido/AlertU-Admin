import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MapPin, 
  CheckCircle2, 
  Search, 
  X, 
  FileText, 
  Building2, 
  RotateCcw, 
  Plus, 
  Sliders, 
  Tag, 
  Loader2,
  AlertTriangle
} from 'lucide-react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import { fromLonLat, toLonLat } from 'ol/proj';
import OSM from 'ol/source/OSM';
import { Tile as TileLayer } from 'ol/layer';

// UI Components
import { Button } from "@/components/ui/button";
import SetIncidentModal from '../create_utilities/SetIncRadandPol';
import SetAgenciesModal from '@/create_utilities/SetAgencies';

// Custom Hooks
import { useAuditLog } from '../useAuditLog';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// Paombong / Bulacan coordinates & boundaries
const BULACAN_INITIAL = { lat: 14.8436, lng: 120.7876 };
const BULACAN_BOUNDS = { 
  minLat: 14.7000, 
  maxLat: 15.2000, 
  minLng: 120.6000, 
  maxLng: 121.3000 
};

const HAZARD_TYPES = ['None', 'Electrical', 'Chemical', 'Fire', 'Others'];
const SEVERITY_LEVELS = ['Low', 'Medium', 'High'];
const INCIDENT_TYPES = ['Fire', 'Flood', 'Accident', 'Others'];

export default function Create_Reports() {
  useDocumentTitle('Create Reports – AlertU');

  // Active Admin / Dispatcher Session (Replace with Auth context if available)
  const currentAdminId = "ADMIN-004";
  const currentAdminName = "Dispatch Admin";

  // Audit Logger Hook initialized with default admin session info
  const { logAction, logMovement } = useAuditLog({
    adminId: currentAdminId,
    adminName: currentAdminName,
  });

  // Form State
  const [formData, setFormData] = useState({
    incidentType: 'Fire',
    customIncidentType: '',
    hazard: 'None',
    customHazard: '',
    severity: 'Medium',
    status: 'Pending',
    address: 'Loading location...',
    latitude: BULACAN_INITIAL.lat,
    longitude: BULACAN_INITIAL.lng,
    notes: '',
    reportTitle: '',
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Pipeline Modals State
  const [isSetIncidentModalOpen, setIsSetIncidentModalOpen] = useState(false);
  const [selectedAgencies, setSelectedAgencies] = useState([]);
  const [isAgencyModalOpen, setIsAgencyModalOpen] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Marker Animation State
  const [markerScale, setMarkerScale] = useState(1);
  const [markerLift, setMarkerLift] = useState(0);

  // Map References
  const mapElement = useRef(null);
  const mapInstance = useRef(null);

  const debounceTimer = useRef(null);
  const searchDebounceTimer = useRef(null);

  // --- Map Initialization ---
  useEffect(() => {
    if (!mapElement.current || mapInstance.current) return;

    const baseTile = new TileLayer({ source: new OSM() });
    
    const map = new Map({
      target: mapElement.current,
      layers: [baseTile],
      view: new View({
        center: fromLonLat([BULACAN_INITIAL.lng, BULACAN_INITIAL.lat]),
        zoom: 15,
        multiWorld: false,
      }),
    });

    // Map interaction handlers
    map.on('movestart', () => {
      setIsDragging(true);
      setMarkerScale(1.15);
      setMarkerLift(-10);
    });

    map.on('moveend', () => {
      setIsDragging(false);
      setMarkerScale(1);
      setMarkerLift(0);

      const center = map.getView().getCenter();
      if (center) {
        const [newLng, newLat] = toLonLat(center);
        updateLocation(parseFloat(newLat.toFixed(6)), parseFloat(newLng.toFixed(6)));
      }
    });

    mapInstance.current = map;

    // Fetch initial location address
    syncNominatimAddress(BULACAN_INITIAL.lat, BULACAN_INITIAL.lng);

    // Handle window resize
    const handleResize = () => {
      if (mapInstance.current) mapInstance.current.updateSize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current);
      if (mapInstance.current) {
        mapInstance.current.setTarget(null);
        mapInstance.current = null;
      }
    };
  }, []);

  // --- Location Update Handler ---
  const updateLocation = (lat, lng) => {
    setFormData(prev => ({
      ...prev,
      latitude: lat,
      longitude: lng
    }));

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      syncNominatimAddress(lat, lng);
    }, 600);
  };

  // --- Reverse Geocoding ---
  const syncNominatimAddress = async (lat, lng) => {
    setIsLoadingAddress(true);
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'alertu-admin-dashboard' }
      });
      
      if (response.ok) {
        const data = await response.json();
        const displayName = data.display_name || `Coordinates: [${lat.toFixed(5)}, ${lng.toFixed(5)}]`;
        setFormData(prev => ({
          ...prev,
          address: displayName
        }));
        setSearchQuery(displayName);
      }
    } catch (error) {
      console.error('Nominatim error:', error);
      setFormData(prev => ({
        ...prev,
        address: `Coordinates: [${lat.toFixed(5)}, ${lng.toFixed(5)}]`
      }));
    } finally {
      setIsLoadingAddress(false);
    }
  };

  // --- Search Places ---
  const searchPlaces = async (query) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&bounded=1&viewbox=120.6,15.2,121.3,14.7`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'alertu-admin-dashboard' }
      });

      if (response.ok) {
        const data = await response.json();
        
        const filteredResults = data.filter(place => {
          const lat = parseFloat(place.lat);
          const lng = parseFloat(place.lon);
          return lat >= BULACAN_BOUNDS.minLat &&
                 lat <= BULACAN_BOUNDS.maxLat &&
                 lng >= BULACAN_BOUNDS.minLng &&
                 lng <= BULACAN_BOUNDS.maxLng;
        });

        setSearchResults(filteredResults);
        setShowSearchResults(true);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // --- Debounced Search Handler ---
  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current);

    if (query.trim() === '') {
      setSearchResults([]);
      setShowSearchResults(false);
    } else {
      searchDebounceTimer.current = setTimeout(() => {
        searchPlaces(query);
      }, 500);
    }
  };

  // --- Select Search Result ---
  const selectSearchResult = (place) => {
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);

    setFormData(prev => ({
      ...prev,
      latitude: lat,
      longitude: lng,
      address: place.display_name
    }));

    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);

    if (mapInstance.current) {
      mapInstance.current.getView().animate({
        center: fromLonLat([lng, lat]),
        duration: 500,
        zoom: 16
      });
    }
  };

  // --- Form Validation ---
  const validateForm = () => {
    const errors = {};
    if (!formData.reportTitle.trim()) errors.reportTitle = 'Report title is required';
    if (!formData.incidentType) errors.incidentType = 'Incident type is required';
    if (formData.incidentType === 'Others' && !formData.customIncidentType.trim()) {
      errors.customIncidentType = 'Please specify incident type';
    }
    if (formData.hazard === 'Others' && !formData.customHazard.trim()) {
      errors.customHazard = 'Please specify associated hazard';
    }
    if (!formData.notes.trim()) errors.notes = 'Description is required';

    if (selectedAgencies.length === 0) {
      errors.selectedAgencies = "Please assign at least one responder agency.";
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // --- Open Modal Handler ---
  const handleCreateReport = (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setIsSetIncidentModalOpen(true);
  };

  // Derived Effective Incident Type for Modal Pass-Through and Audit Logging
  const effectiveIncidentType = formData.incidentType === 'Others' && formData.customIncidentType.trim() 
    ? formData.customIncidentType.trim() 
    : formData.incidentType;

  // --- Called when SetIncRadandPol successfully submits ---
  const handleIncidentConfirmed = (reportIdOrData, payloadData) => {
    setIsSetIncidentModalOpen(false);
    setIsSubmitting(false);
    setSubmitSuccess(true);
    
    // Prioritize VRID / verifiedReportId over raw Firestore Document UID
    const resolvedReportId = 
      (typeof reportIdOrData === 'object' ? reportIdOrData?.verifiedReportId || reportIdOrData?.verifiedReportID || reportIdOrData?.vrid : null) ||
      payloadData?.verifiedReportId ||
      payloadData?.verifiedReportID ||
      payloadData?.vrid ||
      (typeof reportIdOrData === 'string' && reportIdOrData.startsWith('VRID') ? reportIdOrData : null) ||
      `VRID${Math.floor(10000000 + Math.random() * 90000000)}`;

    const resolvedHazard = formData.hazard === 'Others' ? formData.customHazard : formData.hazard;

    // --- Record System Audit Log Entry ---
    (logAction || logMovement)({
      action: 'CREATE_INCIDENT_REPORT',
      actorId: currentAdminId,
      adminId: currentAdminId,
      adminName: currentAdminName,
      target: resolvedReportId,
      targetId: resolvedReportId,
      details: `${currentAdminName} (${currentAdminId}) created emergency report ${resolvedReportId}`,
      metadata: {
        reportTitle: formData.reportTitle,
        incidentType: effectiveIncidentType,
        hazard: resolvedHazard,
        severity: formData.severity,
        notes: formData.notes,
        location: {
          address: formData.address,
          latitude: formData.latitude,
          longitude: formData.longitude
        },
        assignedAgencies: selectedAgencies.map(a => a.id || a.name || a)
      }
    });

    const resolvedMessage = `Emergency report (ID: ${resolvedReportId}) created and spatial telemetry registered successfully.`;

    setSuccessMessage(resolvedMessage);
    handleReset();
  };

  // --- Reset Handler ---
  const handleReset = () => {
    setFormData({
      incidentType: 'Fire',
      customIncidentType: '',
      hazard: 'None',
      customHazard: '',
      severity: 'Medium',
      status: 'Pending',
      address: 'Loading location...',
      latitude: BULACAN_INITIAL.lat,
      longitude: BULACAN_INITIAL.lng,
      notes: '',
      reportTitle: '',
    });
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    setValidationErrors({});
    setSelectedAgencies([]);
    setIsSubmitting(false);
    
    if (mapInstance.current) {
      mapInstance.current.getView().animate({
        center: fromLonLat([BULACAN_INITIAL.lng, BULACAN_INITIAL.lat]),
        zoom: 15,
        duration: 500
      });
    }
    
    syncNominatimAddress(BULACAN_INITIAL.lat, BULACAN_INITIAL.lng);
  };

  return (
    <div className="w-full p-4 font-sans text-slate-900 dark:text-slate-100 transition-colors duration-200">
      
      {/* Header */}
      <header className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Create Emergency Report
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Admin dashboard for incident documentation, spatial mapping, and responder assignment.
          </p>
        </div>
      </header>

      {/* Success Alert Banner */}
      <AnimatePresence>
        {submitSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-3 p-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md flex items-start gap-2.5 shadow-xs"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 flex-1">
              <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                {successMessage}
              </p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Your report was registered into the system alongside spatial telemetry.
              </p>
            </div>
            <button 
              onClick={() => setSubmitSuccess(false)}
              className="text-emerald-600 dark:text-emerald-400 hover:opacity-75 text-xs font-bold"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Interface Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        
        {/* Spatial Mapping Section */}
        <div className="lg:col-span-7 xl:col-span-8 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden flex flex-col h-[calc(100vh-230px)] min-h-[420px]">
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-rose-500" />
              <h2 className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Interactive Spatial Map Picker
              </h2>
            </div>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
              Drag map to pinpoint location
            </span>
          </div>

          <div className="relative flex-1 w-full bg-slate-100 dark:bg-slate-950 overflow-hidden">
            {/* Map Canvas */}
            <div ref={mapElement} className="w-full h-full absolute inset-0" />

            {/* Floating Center Pin Indicator */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div 
                className="flex flex-col items-center transition-transform duration-150 ease-out"
                style={{
                  transform: `scale(${markerScale}) translateY(${markerLift}px)`,
                }}
              >
                <div className="relative">
                  <MapPin className={`h-8 w-8 drop-shadow-md transition-colors ${
                    isDragging ? 'text-rose-600 fill-rose-500/20' : 'text-rose-600 fill-rose-600/30'
                  }`} />
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-1 bg-slate-900/40 rounded-full blur-[1px]" />
                </div>
              </div>
            </div>

            {/* Map Search Bar Overlay */}
            <div className="absolute top-2.5 left-2.5 right-2.5 z-20">
              <div className="max-w-sm mx-auto bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-md border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                <div className="flex items-center px-2.5 py-0.5">
                  <Search className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-0.5" />
                  <input
                    type="text"
                    placeholder="Search location in Bulacan..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    className="w-full bg-transparent px-2 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
                  />
                  {isSearching && <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0 mr-1.5" />}
                  {searchQuery && !isSearching && (
                    <button 
                      type="button" 
                      onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearchResults(false); }} 
                      className="p-0.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                
                {/* Search Dropdown */}
                {showSearchResults && (
                  <div className="border-t border-slate-100 dark:border-slate-800 max-h-40 overflow-y-auto">
                    {searchResults.length > 0 ? (
                      searchResults.map((result, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => selectSearchResult(result)}
                          className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition-colors truncate block"
                        >
                          {result.display_name}
                        </button>
                      ))
                    ) : (
                      <p className="px-2 py-1.5 text-[11px] text-slate-400 text-center">
                        No locations found in Bulacan.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Location Coordinate Bar */}
          <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-[11px]">
            <div className="flex items-center gap-1.5 overflow-hidden">
              <MapPin className="h-3 w-3 text-rose-500 shrink-0" />
              <span className="text-slate-700 dark:text-slate-300 font-medium truncate">
                {isLoadingAddress ? 'Retrieving street address...' : formData.address}
              </span>
            </div>
            <div className="font-mono text-slate-500 dark:text-slate-400 text-[10px] shrink-0">
              Lat: <span className="text-slate-800 dark:text-slate-200 font-semibold">{formData.latitude.toFixed(5)}</span> | Lng: <span className="text-slate-800 dark:text-slate-200 font-semibold">{formData.longitude.toFixed(5)}</span>
            </div>
          </div>
        </div>

        {/* Form Control Section */}
        <div className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs p-3.5 flex flex-col justify-between h-[calc(100vh-230px)] min-h-[420px] overflow-y-auto">
          <div className="space-y-2.5">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center justify-between">
              <h2 className="text-[11px] font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>Incident Parameters</span>
              </h2>
              <span className="text-[9px] font-bold text-rose-500 uppercase tracking-wider">* Required</span>
            </div>

            <form onSubmit={handleCreateReport} id="create-report-form" className="space-y-2.5">
              
              {/* Title Field */}
              <div className="space-y-0.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Report Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., Structure Fire on Market Street..."
                  value={formData.reportTitle}
                  onChange={(e) => setFormData({ ...formData, reportTitle: e.target.value })}
                  className={`w-full px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all ${
                    validationErrors.reportTitle
                      ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/20'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 focus:border-blue-500'
                  } text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none`}
                />
                {validationErrors.reportTitle && (
                  <p className="text-[10px] text-rose-500 font-medium">{validationErrors.reportTitle}</p>
                )}
              </div>

              {/* Incident Type Select */}
              <div className="space-y-0.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Incident Type <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.incidentType}
                    onChange={(e) => setFormData({ ...formData, incidentType: e.target.value, customIncidentType: '' })}
                    className={`w-full px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-all appearance-none ${
                      validationErrors.incidentType
                        ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/20'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 focus:border-blue-500'
                    } text-slate-900 dark:text-slate-100 focus:outline-none`}
                  >
                    {INCIDENT_TYPES.map(type => (
                      <option key={type} value={type} className="bg-white dark:bg-slate-900">{type}</option>
                    ))}
                  </select>
                  <Tag className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                </div>
                {validationErrors.incidentType && (
                  <p className="text-[10px] text-rose-500 font-medium">{validationErrors.incidentType}</p>
                )}
              </div>

              {/* Custom Incident Field */}
              {formData.incidentType === 'Others' && (
                <div className="space-y-0.5">
                  <input
                    type="text"
                    placeholder="Specify custom incident classification..."
                    value={formData.customIncidentType}
                    onChange={(e) => setFormData({ ...formData, customIncidentType: e.target.value })}
                    className={`w-full px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all ${
                      validationErrors.customIncidentType
                        ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/20'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 focus:border-blue-500'
                    } text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none`}
                  />
                  {validationErrors.customIncidentType && (
                    <p className="text-[10px] text-rose-500 font-medium">{validationErrors.customIncidentType}</p>
                  )}
                </div>
              )}

              {/* Severity Button Group */}
              <div className="space-y-0.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Severity Assessment
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {SEVERITY_LEVELS.map(level => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setFormData({ ...formData, severity: level })}
                      className={`py-1 px-1.5 rounded-md text-[11px] font-bold transition-all border shadow-2xs ${
                        formData.severity === level
                          ? level === 'High'
                            ? 'bg-rose-600 text-white border-rose-700'
                            : level === 'Medium'
                            ? 'bg-amber-500 text-white border-amber-600'
                            : 'bg-emerald-600 text-white border-emerald-700'
                          : 'bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hazard Select */}
              <div className="space-y-0.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Associated Secondary Hazard
                </label>
                <div className="relative">
                  <select
                    value={formData.hazard}
                    onChange={(e) => setFormData({ ...formData, hazard: e.target.value, customHazard: '' })}
                    className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 text-xs font-medium focus:border-blue-500 focus:outline-none appearance-none"
                  >
                    {HAZARD_TYPES.map(type => (
                      <option key={type} value={type} className="bg-white dark:bg-slate-900">{type}</option>
                    ))}
                  </select>
                  <AlertTriangle className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Custom Hazard Field */}
              {formData.hazard === 'Others' && (
                <div className="space-y-0.5">
                  <input
                    type="text"
                    placeholder="Specify custom secondary hazard..."
                    value={formData.customHazard}
                    onChange={(e) => setFormData({ ...formData, customHazard: e.target.value })}
                    className={`w-full px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all ${
                      validationErrors.customHazard
                        ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/20'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 focus:border-blue-500'
                    } text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none`}
                  />
                  {validationErrors.customHazard && (
                    <p className="text-[10px] text-rose-500 font-medium">{validationErrors.customHazard}</p>
                  )}
                </div>
              )}

              {/* Responder Agency Controls */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1">
                    <Building2 className="h-3 w-3 text-blue-500" />
                    <span>Assigned Responders</span>
                  </label>
                  {validationErrors.selectedAgencies && (
                    <span className="text-[9px] text-rose-500 font-bold uppercase">Required</span>
                  )}
                </div>
                
                {selectedAgencies.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setIsAgencyModalOpen(true)}
                    className={`w-full py-1.5 px-2.5 border border-dashed rounded-md flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${
                      validationErrors.selectedAgencies
                        ? 'border-rose-400 bg-rose-50/30 text-rose-600'
                        : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400'
                    }`}
                  >
                    <Plus className="h-3 w-3" />
                    <span>Set Agencies For Dispatch</span>
                  </button>
                ) : (
                  <div className="p-2 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/80 dark:bg-slate-950/40 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-slate-500 dark:text-slate-400">
                        {selectedAgencies.length} Agency Channels
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsAgencyModalOpen(true)}
                        className="font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                      >
                        <Sliders className="h-2.5 w-2.5" />
                        <span>Modify</span>
                      </button>
                    </div>
                    
                    <div className="flex flex-wrap gap-1">
                      {selectedAgencies.map((agency) => {
                        const styleClasses = agency.color || "border-slate-200 bg-slate-100 text-slate-700";
                        return (
                          <span 
                            key={agency.id || agency.name} 
                            className={`px-1.5 py-0.5 rounded border text-[9px] font-bold flex items-center gap-1 shadow-2xs ${styleClasses}`}
                          >
                            {agency.icon && <span>{agency.icon}</span>}
                            <span>{agency.id || agency.name}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes Description */}
              <div className="space-y-0.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Incident Description <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Provide concise details on current situation..."
                  rows={2}
                  className={`w-full px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all resize-none ${
                    validationErrors.notes
                      ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/20'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 focus:border-blue-500'
                  } text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none`}
                />
                {validationErrors.notes && (
                  <p className="text-[10px] text-rose-500 font-medium">{validationErrors.notes}</p>
                )}
              </div>
            </form>
          </div>

          {/* Action Trigger Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              className="w-full inline-flex items-center justify-center gap-1 text-[11px] font-bold uppercase tracking-wider h-8"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </Button>

            <Button
              type="submit"
              form="create-report-form"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-[11px] font-bold uppercase tracking-wider shadow-xs h-8"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  <span>Proceed</span>
                </>
              )}
            </Button>
          </div>
        </div>

      </div>

      {/* Agency Assignment Pipeline Modal */}
      <SetAgenciesModal
        isOpen={isAgencyModalOpen}
        onClose={() => setIsAgencyModalOpen(false)}
        selectedAgencies={selectedAgencies}
        onSave={(updatedList) => setSelectedAgencies(updatedList)}
      />

      {/* Final Incident Creation & Spatial Modeling Modal */}
      <SetIncidentModal
        isOpen={isSetIncidentModalOpen} 
        onClose={() => setIsSetIncidentModalOpen(false)}
        onConfirm={handleIncidentConfirmed}
        reportData={{
          ...formData,
          incidentType: effectiveIncidentType,
          hazard: formData.hazard === 'Others' ? formData.customHazard : formData.hazard
        }}
        verifiedIncidentType={effectiveIncidentType}
        selectedAgencies={selectedAgencies}
      />
    </div>
  );
}