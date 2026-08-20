import { useRef, useEffect, useCallback } from 'react';

/**
 * Custom hook to manage SOS emergency alert audio playback.
 * 
 * @param {string} audioUrl - Path to the SOS alert audio file (defaults to '/ringtone.mp3')
 * @returns {Object} { startRingtone, stopRingtone }
 */
export const useSOSRingtone = (audioUrl = '/sosring.mp3') => {
  const audioRef = useRef(null);

  useEffect(() => {
    // Initialize audio instance
    audioRef.current = new Audio(audioUrl);
    audioRef.current.loop = true;

    // Cleanup on unmount
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [audioUrl]);

  const startRingtone = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
        // Modern browsers block autoplay without prior user interaction
        console.warn('Autoplay blocked by browser. User interaction required first.', err);
      });
    }
  }, []);

  const stopRingtone = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, []);

  return { startRingtone, stopRingtone };
};

export default useSOSRingtone;