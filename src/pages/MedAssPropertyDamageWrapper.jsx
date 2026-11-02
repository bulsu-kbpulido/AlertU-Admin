import React from 'react';
import { AlertCircle, ShieldAlert, HeartPulse } from 'lucide-react';

export default function MedAssPropertyDamageWrapper({ 
  report, 
  isPropertyDamage, 
  isMedicalAssistance, 
  incidentType,
  showBadgesOnly = false,
  children 
}) {
  // Resolve accident flags directly from props or nested report object
  const type = String(incidentType || report?.incidentType || '').trim().toLowerCase();
  const isAccident = type === 'accident';

  const propertyDamage = Boolean(
    isPropertyDamage ?? 
    report?.isPropertyDamage ?? 
    report?.hasPropertyDamage ?? 
    false
  );

  const medicalAssistance = Boolean(
    isMedicalAssistance ?? 
    report?.isMedicalAssistance ?? 
    report?.needsMedicalAssistance ?? 
    false
  );

  // If it's not an accident or neither flag is active, just render children or null
  if (!isAccident || (!propertyDamage && !medicalAssistance)) {
    return showBadgesOnly ? null : <>{children}</>;
  }

  const badgeContent = (
    <div className="flex items-center gap-2 flex-wrap">
      {propertyDamage && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300 shadow-xs">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>Property Damage</span>
        </span>
      )}
      {medicalAssistance && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300 shadow-xs">
          <HeartPulse className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
          <span>Needs Medical Assistance</span>
        </span>
      )}
    </div>
  );

  if (showBadgesOnly) {
    return badgeContent;
  }

  return (
    <div className="w-full flex flex-col gap-3">
      {badgeContent}
      {children}
    </div>
  );
}
