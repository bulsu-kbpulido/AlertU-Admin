import { useState, useEffect, useCallback, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import socket, {
  joinSocketRoom,
  leaveSocketRoom,
  joinSosRoom,
  leaveSosRoom,
  onSosAlertTriggered,
  onSosLocationUpdated,
  onSosStatusUpdated,
} from './socket';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export const useSOSHandler = () => {
  const [activeSosAlerts, setActiveSosAlerts] = useState([]);
  const [selectedSos, setSelectedSos] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const prevSelectedSosIdRef = useRef(null);
  const audioRef = useRef(null);

  const getAuthToken = async () => {
    try {
      const currentUser = getAuth().currentUser;
      if (currentUser) {
        return await currentUser.getIdToken();
      }
      return null;
    } catch (err) {
      console.error('Failed to retrieve Firebase auth token:', err);
      return null;
    }
  };

  /**
   * Helper to format SOS document key cleanly (`sos_{id}`)
   */
  const formatSosKey = (rawId) => {
    if (!rawId) return `sos_${Date.now()}`;
    const clean = String(rawId).trim();
    return clean.startsWith('sos_') ? clean : `sos_${clean}`;
  };

  /**
   * Helper to check for a valid non-empty, non-N/A string value
   */
  const extractValidString = (...candidates) => {
    for (const val of candidates) {
      if (val && typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed !== '' && trimmed.toUpperCase() !== 'N/A' && trimmed !== 'undefined' && trimmed !== 'null') {
          return trimmed;
        }
      }
    }
    return undefined;
  };

  // Helper to normalize SOS object structure across socket & REST APIs
  const normalizeSosPayload = useCallback((raw) => {
    if (!raw) return null;

    const rawId = raw.sosId || raw.id || raw._id || raw.citizenUid || raw.citizenId;
    const sosId = formatSosKey(rawId);
    const cleanSosId = sosId.replace(/^sos_/, '');

    const locationData = raw.gisLocation || raw.location || raw.locationData || {
      latitude: raw.latitude ?? raw.lat ?? 0.0,
      longitude: raw.longitude ?? raw.lng ?? 0.0,
      address: raw.address || '',
    };

    // Robust extraction of Citizen Details across all known payload formats
    const citizenName = extractValidString(
      raw.citizenName,
      raw.submitterName,
      raw.name,
      raw.user?.name,
      raw.user?.displayName
    ) || 'Emergency Citizen';

    const citizenPhone = extractValidString(
      raw.citizenPhone,
      raw.submitterPhone,
      raw.phone,
      raw.phoneNumber,
      raw.contactNumber,
      raw.mobile,
      raw.user?.phoneNumber,
      raw.user?.phone,
      raw.user?.contactNumber
    ); // Returns undefined if missing (allowing SOSadminModal to fetch live from Firestore)

    const citizenEmail = extractValidString(
      raw.citizenEmail,
      raw.submitterEmail,
      raw.email,
      raw.emailAddress,
      raw.user?.email
    );

    // Robust extraction of Emergency Contacts
    let emergencyContacts = undefined;
    if (Array.isArray(raw.emergencyContacts) && raw.emergencyContacts.length > 0) {
      emergencyContacts = raw.emergencyContacts;
    } else if (Array.isArray(raw.contacts) && raw.contacts.length > 0) {
      emergencyContacts = raw.contacts;
    } else if (Array.isArray(raw.user?.emergencyContacts) && raw.user.emergencyContacts.length > 0) {
      emergencyContacts = raw.user.emergencyContacts;
    }

    const normalizedStatus = String(raw.status || 'ACTIVE').toUpperCase();

    return {
      ...raw,
      sosId,
      id: sosId,
      cleanSosId,
      status: normalizedStatus,
      targetRoom: sosId,
      citizenName,
      submitterName: citizenName,
      citizenId: raw.citizenId || raw.citizenUid || raw.userId || cleanSosId,
      citizenPhone,
      submitterPhone: citizenPhone,
      phone: citizenPhone,
      citizenEmail,
      submitterEmail: citizenEmail,
      email: citizenEmail,
      locationData,
      gisLocation: locationData,
      emergencyContacts, // Undefined if missing so modal defaults to Firestore doc
      sosDetails: raw.sosDetails || raw.notes || raw.details || raw.note || 'Emergency SOS Triggered',
    };
  }, []);

  const fetchActiveSosAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const response = await fetch(`${API_BASE_URL}/sos/active`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });

      if (response.ok) {
        const result = await response.json();
        const rawList = result.data || result.sosAlerts || (Array.isArray(result) ? result : []);
        if (Array.isArray(rawList)) {
          const normalized = rawList.map(normalizeSosPayload);
          setActiveSosAlerts(normalized);
        }
      }
    } catch (err) {
      console.error('❌ Error fetching SOS alerts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [normalizeSosPayload]);

  const fetchSosDetails = useCallback(
    async (sosId) => {
      if (!sosId) return null;
      const cleanId = String(sosId).replace(/^sos_/, '');
      try {
        const token = await getAuthToken();
        const response = await fetch(`${API_BASE_URL}/sos/${cleanId}/details`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            return normalizeSosPayload(result.data);
          }
        }
      } catch (err) {
        console.error(`❌ Error fetching details for SOS ${sosId}:`, err);
      }
      return null;
    },
    [normalizeSosPayload]
  );

  const updateSosStatus = useCallback(
    async (sosId, status, responderNotes = '') => {
      const formattedSosId = formatSosKey(sosId);
      const cleanId = formattedSosId.replace(/^sos_/, '');
      const normalizedStatus = String(status).toUpperCase();

      try {
        const token = await getAuthToken();
        const response = await fetch(`${API_BASE_URL}/sos/${cleanId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({ status: normalizedStatus, responderNotes }),
        });

        if (response.ok) {
          const result = await response.json();
          const isTerminated = normalizedStatus === 'RESOLVED' || normalizedStatus === 'CANCELLED';

          setActiveSosAlerts((prev) =>
            prev
              .map((alert) =>
                alert.sosId === formattedSosId
                  ? { ...alert, status: normalizedStatus, responderNotes }
                  : alert
              )
              .filter((alert) => (isTerminated ? alert.sosId !== formattedSosId : true))
          );

          setSelectedSos((prev) => {
            if (prev && prev.sosId === formattedSosId) {
              if (isTerminated) return null;
              return { ...prev, status: normalizedStatus, responderNotes };
            }
            return prev;
          });

          return result;
        }
      } catch (err) {
        console.error(`❌ Error updating status for SOS ${sosId}:`, err);
        setError(err.message);
      }
      return { success: false };
    },
    []
  );

  const playEmergencySound = () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('/assets/sounds/sos_alarm.mp3');
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((e) => console.warn('Audio playback prevented by browser:', e));
    } catch (e) {
      console.warn('Could not play emergency alarm:', e);
    }
  };

  useEffect(() => {
    joinSocketRoom('admins');
    fetchActiveSosAlerts();

    const handleReconnect = () => {
      joinSocketRoom('admins');
      if (prevSelectedSosIdRef.current) {
        joinSosRoom(prevSelectedSosIdRef.current);
      }
    };

    socket.on('connect', handleReconnect);

    // 🚨 Real-Time Listener: New or Re-triggered Emergency Alert
    const unsubscribeTriggered = onSosAlertTriggered((rawSos) => {
      const normalized = normalizeSosPayload(rawSos);
      const sosId = normalized?.sosId;

      if (!sosId) return;

      console.log('🚨 REAL-TIME SOS TRIGGERED IN HOOK:', normalized);
      playEmergencySound();

      setActiveSosAlerts((prev) => {
        const exists = prev.some((a) => a.sosId === normalized.sosId);
        if (exists) {
          return prev.map((alert) =>
            alert.sosId === normalized.sosId ? { ...alert, ...normalized } : alert
          );
        }
        return [normalized, ...prev];
      });

      setSelectedSos(normalized);

      if (normalized.sosId) {
        joinSosRoom(normalized.sosId);
        prevSelectedSosIdRef.current = normalized.sosId;
      }
    });

    // 📍 Real-Time Listener: GIS Location Updated
    const unsubscribeLocation = onSosLocationUpdated((updatePayload) => {
      const rawId = updatePayload.sosId || updatePayload.id || updatePayload.cleanSosId;
      const formattedSosId = formatSosKey(rawId);
      const gisLocation = updatePayload.gisLocation || updatePayload.location || updatePayload;

      setActiveSosAlerts((prev) =>
        prev.map((sos) => {
          if (sos.sosId === formattedSosId) {
            return {
              ...sos,
              gisLocation,
              locationData: gisLocation,
            };
          }
          return sos;
        })
      );

      setSelectedSos((prev) => {
        if (prev && prev.sosId === formattedSosId) {
          return {
            ...prev,
            gisLocation,
            locationData: gisLocation,
          };
        }
        return prev;
      });
    });

    // 🏷️ Real-Time Listener: Status Updated
    const unsubscribeStatus = onSosStatusUpdated((statusPayload) => {
      const rawId = statusPayload.sosId || statusPayload.id || statusPayload.cleanSosId;
      const formattedSosId = formatSosKey(rawId);
      const normalizedStatus = String(statusPayload.status || '').toUpperCase();
      const isTerminated = normalizedStatus === 'RESOLVED' || normalizedStatus === 'CANCELLED';

      setActiveSosAlerts((prev) =>
        prev
          .map((sos) => {
            if (sos.sosId === formattedSosId) {
              return { ...sos, status: normalizedStatus };
            }
            return sos;
          })
          .filter((sos) => (isTerminated ? sos.sosId !== formattedSosId : true))
      );

      setSelectedSos((prev) => {
        if (prev && prev.sosId === formattedSosId) {
          if (isTerminated) return null;
          return { ...prev, status: normalizedStatus };
        }
        return prev;
      });
    });

    return () => {
      socket.off('connect', handleReconnect);
      leaveSocketRoom('admins');
      if (prevSelectedSosIdRef.current) {
        leaveSosRoom(prevSelectedSosIdRef.current);
      }

      unsubscribeTriggered();
      unsubscribeLocation();
      unsubscribeStatus();
    };
  }, [fetchActiveSosAlerts, normalizeSosPayload]);

  const selectSosAlert = async (sos) => {
    if (!sos) {
      if (prevSelectedSosIdRef.current) {
        leaveSosRoom(prevSelectedSosIdRef.current);
        prevSelectedSosIdRef.current = null;
      }
      setSelectedSos(null);
      return;
    }

    const normalized = normalizeSosPayload(sos);
    const sosId = normalized.sosId;

    if (prevSelectedSosIdRef.current && prevSelectedSosIdRef.current !== sosId) {
      leaveSosRoom(prevSelectedSosIdRef.current);
    }

    joinSosRoom(sosId);
    prevSelectedSosIdRef.current = sosId;

    setSelectedSos(normalized);

    const fullDetails = await fetchSosDetails(sosId);
    if (fullDetails) {
      setSelectedSos((prev) => {
        if (!prev || prev.sosId !== normalized.sosId) return fullDetails;
        return {
          ...fullDetails,
          ...prev,
          emergencyContacts:
            prev?.emergencyContacts && prev.emergencyContacts.length > 0
              ? prev.emergencyContacts
              : fullDetails.emergencyContacts,
        };
      });
    }
  };

  return {
    activeSosAlerts,
    selectedSos,
    loading,
    error,
    fetchActiveSosAlerts,
    fetchSosDetails,
    updateSosStatus,
    selectSosAlert,
    setSelectedSos,
  };
};

export default useSOSHandler;