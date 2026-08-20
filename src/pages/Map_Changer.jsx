import React, { useEffect, useRef, useState } from 'react';
import { FcGoogle } from "react-icons/fc";
import { FiMapPin, FiX, FiCheck, FiCompass, FiArrowLeft } from "react-icons/fi";
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import { fromLonLat, toLonLat } from 'ol/proj';
import OSM from 'ol/source/OSM';
import { Tile as TileLayer } from 'ol/layer';

export default function MapChanger({
  isOpen,
  onClose,
  initialLat,
  initialLng,
  initialAddress,
  onSave
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const debounceTimer = useRef(null);
  const searchDebounceTimer = useRef(null);

  // Core Synchronization States - Initialize with props to avoid null-check skips in effects
  const [lat, setLat] = useState(parseFloat(initialLat) || 14.85);
  const [lng, setLng] = useState(parseFloat(initialLng) || 120.81);
  const [address, setAddress] = useState(initialAddress || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);

  const bulacanBounds = {
    minLat: 14.7000,
    maxLat: 15.2000,
    minLng: 120.6000,
    maxLng: 121.3000
  };

  // Sync state when props change (e.g. when modal is opened with a new report)
  useEffect(() => {
    if (isOpen) {
      const nextLat = parseFloat(initialLat) || 14.85;
      const nextLng = parseFloat(initialLng) || 120.81;
      setLat(nextLat);
      setLng(nextLng);
      setAddress(initialAddress || 'Locating...');
      setSearchQuery('');
      setSearchResults([]);

      // If map already exists, move it to the new location
      if (mapInstance.current) {
        mapInstance.current.getView().setCenter(fromLonLat([nextLng, nextLat]));
      }
    }
  }, [isOpen, initialLat, initialLng, initialAddress]);

  // Map Initialization and Sizing
  useEffect(() => {
    if (!isOpen || !mapRef.current) return;

    // Initialize map if it doesn't exist
    if (!mapInstance.current) {
      const map = new Map({
        target: mapRef.current,
        layers: [new TileLayer({ source: new OSM() })],
        view: new View({
          center: fromLonLat([lng, lat]),
          zoom: 15.5,
          maxZoom: 18,
          minZoom: 9,
        }),
      });

      map.on('movestart', () => setIsDragging(true));
      map.on('moveend', () => {
        setIsDragging(false);
        const centerCoords = map.getView().getCenter();
        const [newLng, newLat] = toLonLat(centerCoords);
        setLat(newLat);
        setLng(newLng);

        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          reverseGeocode(newLat, newLng);
        }, 600);
      });

      mapInstance.current = map;
    }

    // ⚡ FIX: Use ResizeObserver to guarantee map renders even with animations
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstance.current) {
        mapInstance.current.updateSize();
      }
    });
    resizeObserver.observe(mapRef.current);

    // Initial pulse to handle immediate render
    const timer = setTimeout(() => {
      if (mapInstance.current) mapInstance.current.updateSize();
    }, 100);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(timer);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [isOpen]); // Re-run when modal opens

  if (!isOpen) return null;

  const reverseGeocode = async (targetLat, targetLng) => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${targetLat}&lon=${targetLng}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'AlertU_Dashboard' } });
      const data = await res.json();
      if (data.display_name) setAddress(data.display_name);
    } catch (err) {
      console.error("Reverse lookup error:", err);
    }
  };

  const searchPlaces = (query) => {
    setSearchQuery(query);
    if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    searchDebounceTimer.current = setTimeout(async () => {
      setIsLoadingSearch(true);
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'AlertU_Dashboard' } });
        const rawResults = await res.json();
        const filteredResults = rawResults.filter(place => {
          const pLat = parseFloat(place.lat);
          const pLng = parseFloat(place.lon);
          return pLat >= bulacanBounds.minLat && pLat <= bulacanBounds.maxLat &&
                 pLng >= bulacanBounds.minLng && pLng <= bulacanBounds.maxLng;
        });
        setSearchResults(filteredResults);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setIsLoadingSearch(false);
      }
    }, 500);
  };

  const handleSelectPlace = (place) => {
    const targetLat = parseFloat(place.lat);
    const targetLng = parseFloat(place.lon);
    setLat(targetLat);
    setLng(targetLng);
    setAddress(place.display_name);
    setSearchResults([]);

    if (mapInstance.current) {
      mapInstance.current.getView().animate({
        center: fromLonLat([targetLng, targetLat]),
        zoom: 16,
        duration: 800
      });
    }
  };

  const handleApplyChanges = () => {
    if (typeof onSave === 'function') {
      onSave({ 
        latitude: lat, 
        longitude: lng, 
        lat: lat,
        lng: lng,
        address: address 
      });
    }
    onClose();
  };

  const liveGoogleMapsLink = `https://maps.google.com/?q=${lat},${lng}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-md p-0 sm:p-4">
      <div className="relative w-full h-full sm:h-[90vh] sm:max-w-5xl bg-white dark:bg-slate-900 sm:rounded-3xl shadow-2xl overflow-hidden border border-transparent sm:border-slate-200/80 sm:dark:border-slate-800/80 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        
        {/* Search & Exit */}
        <div className="absolute top-5 left-0 right-0 z-50 px-5 pointer-events-none flex justify-between items-start gap-4">
          <div className="flex flex-col gap-2 w-full max-w-xl">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full shadow-xl flex items-center px-4 py-1 pointer-events-auto transition-all focus-within:ring-2 focus-within:ring-blue-600">
              <button onClick={onClose} type="button" className="p-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all">
                <FiArrowLeft className="text-lg" />
              </button>
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => searchPlaces(e.target.value)}
                placeholder="Type custom address location..."
                className="w-full bg-transparent px-3 py-3 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none placeholder-slate-400"
              />
              {isLoadingSearch ? (
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />
              ) : searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <FiX />
                </button>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-h-56 overflow-y-auto rounded-2xl shadow-2xl pointer-events-auto divide-y divide-slate-100 dark:divide-slate-800 animate-in slide-in-from-top-2 duration-200">
                {searchResults.map((place, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => handleSelectPlace(place)}
                    className="p-3.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer flex items-start gap-3 transition-colors"
                  >
                    <FiMapPin className="text-slate-400 shrink-0 mt-0.5" />
                    <span className="truncate">{place.display_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button 
            type="button" 
            onClick={onClose}
            className="pointer-events-auto w-11 h-11 flex items-center justify-center rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 shadow-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shrink-0"
          >
            <FiX className="text-xl" />
          </button>
        </div>

        {/* Map Viewport */}
        <div className="flex-1 w-full relative bg-slate-50 dark:bg-slate-950 min-h-[300px]">
          <div ref={mapRef} className="w-full h-full absolute inset-0 [&_.ol-control]:!hidden" />

          {/* Center Pin */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
            <div 
              className="flex flex-col items-center transition-all duration-200 ease-out"
              style={{
                transform: `translateY(${isDragging ? '-16px' : '-4px'}) scale(${isDragging ? 1.15 : 1.0})`
              }}
            >
              <div className="relative flex items-center justify-center drop-shadow-[0_10px_10px_rgba(0,0,0,0.35)]">
                <FiMapPin className="text-[48px] text-red-600 fill-red-600 opacity-100" />
                <div className="absolute top-[9px] w-3.5 h-3.5 bg-white rounded-full border border-red-600/20 shadow-inner" />
              </div>
              <div 
                className="w-2.5 h-1 bg-black/40 rounded-full blur-[1px] transition-all duration-200 mt-0.5"
                style={{
                  transform: `scale(${isDragging ? 0.4 : 1.0})`,
                  opacity: isDragging ? 0.15 : 0.7
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-5 flex flex-col md:flex-row items-center justify-between gap-4 z-40">
          <div className="flex items-center gap-3.5 w-full md:max-w-[60%]">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <FiCompass className="text-xl" />
            </div>
            <div className="space-y-0.5 min-w-0 flex-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block">Selected Operational Location</span>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{address}</p>
            </div>
          </div>

          <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto shrink-0 border-t md:border-0 pt-3 md:pt-0 border-slate-100 dark:border-slate-800">
            <div className="font-mono text-[11px] font-black px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-800">
              <span>{lat?.toFixed(5)}, {lng?.toFixed(5)}</span>
            </div>

            <a href={liveGoogleMapsLink} target="_blank" rel="noopener noreferrer" className="bg-slate-100 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800 text-slate-800 dark:text-slate-200 p-2.5 rounded-xl flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-800 transition-all">
              <FcGoogle className="text-lg" />
            </a>

            <button 
              type="button"
              onClick={handleApplyChanges}
              className="px-5 py-2.5 text-xs font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xl flex items-center gap-2 transition-all"
            >
              <FiCheck className="text-sm" />
              <span>Confirm Location</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}