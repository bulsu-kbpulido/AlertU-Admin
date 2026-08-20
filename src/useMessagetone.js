import { useRef, useCallback } from 'react';

export const useMessagetone = (audioUrl = '/messagetone.mp3') => {
  const activeAudioRef = useRef(null);

  const playMessagetone = useCallback(() => {
    try {
      // 1. Create a fresh sound instance on every trigger
      const sound = new Audio(audioUrl);
      sound.volume = 1.0;
      activeAudioRef.current = sound;

      // 2. Play immediately
      const playPromise = sound.play();

      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('⚠️ Audio playback blocked or failed:', err);
        });
      }
    } catch (e) {
      console.error('❌ Error playing message tone:', e);
    }
  }, [audioUrl]);

  const stopMessagetone = useCallback(() => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
  }, []);

  return { playMessagetone, stopMessagetone };
};