import React, { useState, useEffect } from 'react';
import { FiEye, FiEyeOff, FiAlertTriangle } from 'react-icons/fi';

export default function SensitiveMediaWrapper({ 
  mediaUrl, 
  isSensitive, 
  topic = "Incident Scene", 
  children 
}) {
  const [isRevealed, setIsRevealed] = useState(false);

  // 1. Force state reset whenever the source URL changes
  useEffect(() => {
    setIsRevealed(false);
  }, [mediaUrl]);

  // 2. Strict boolean coercion
  // Converts string "true", number 1, or boolean true to strict true
  const shouldCensor = String(isSensitive).toLowerCase() === 'true';

  if (!shouldCensor) {
    return <>{children}</>;
  }

  return (
    <div className="relative w-full h-full group overflow-hidden rounded-[2rem]">
      {/* Blurred Container */}
      <div 
        className={`w-full h-full transition-all duration-700 ease-out ${
          isRevealed 
            ? 'blur-0 scale-100 opacity-100' 
            : 'blur-[40px] scale-110 opacity-70 pointer-events-none'
        }`}
      >
        {children}
      </div>

      {/* Warning Overlay */}
      {!isRevealed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm text-center animate-in fade-in duration-300 z-20">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mb-4 shadow-inner">
            <FiAlertTriangle className="text-3xl animate-pulse" />
          </div>
          
          <h3 className="text-sm font-black uppercase tracking-widest text-white mb-1">
            ⚠️ Graphic Content Warning
          </h3>
          <p className="text-xs font-medium text-slate-300 max-w-[240px] mb-6 leading-relaxed">
            This asset contains graphic depictions of <span className="text-amber-400 font-bold">{topic}</span>.
          </p>

          <button
            onClick={() => setIsRevealed(true)}
            className="px-6 py-3 bg-white hover:bg-slate-100 text-slate-950 text-[10px] font-black uppercase tracking-widest rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
          >
            <FiEye className="text-sm" /> Click to Reveal
          </button>
        </div>
      )}

      {/* Re-Hide Button */}
      {isRevealed && (
        <button
          onClick={() => setIsRevealed(false)}
          className="absolute top-4 right-4 z-30 px-3.5 py-2 bg-slate-950/80 backdrop-blur-md text-white text-[10px] font-black uppercase tracking-widest rounded-xl border border-white/10 shadow-2xl hover:bg-slate-900 transition-all flex items-center gap-1.5 hover:scale-105 active:scale-95"
        >
          <FiEyeOff className="text-xs" /> Hide
        </button>
      )}
    </div>
  );
}