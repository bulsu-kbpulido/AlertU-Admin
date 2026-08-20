import { useCallback } from 'react';
import axios from 'axios';
import { getAuth } from 'firebase/auth';
import { useReportStore } from './useReportStore'; // Adjust path if needed

const RENDER_BACKEND_API = 'https://alertu-server.onrender.com/api';

/**
 * Standardizes Citizen ID input into CID format (e.g., '00000001' or 1 -> 'CID00000001')
 */
const getCitizenId = (citizen) => {
  if (!citizen) return 'CID00000001';
  
  if (typeof citizen === 'string' || typeof citizen === 'number') {
    const raw = String(citizen).trim();
    if (raw.startsWith('CID')) return raw;
    const numericPart = raw.replace(/\D/g, '');
    return numericPart ? `CID${numericPart.padStart(8, '0')}` : raw;
  }

  const id = citizen.citizenID || citizen.citizenId || citizen.cid || citizen.id;
  if (!id) return 'CID00000001';
  
  const rawId = String(id).trim();
  if (rawId.startsWith('CID')) return rawId;
  const numericPart = rawId.replace(/\D/g, '');
  return numericPart ? `CID${numericPart.padStart(8, '0')}` : `CID_${rawId}`;
};

/**
 * Helper to safely extract string ID from targets
 */
const resolveTargetString = (targetInput, fallbackReport) => {
  if (!targetInput && !fallbackReport) return 'UNKNOWN_TARGET';

  // If passed an object directly
  if (targetInput && typeof targetInput === 'object') {
    const candidateId = 
      targetInput.target ||
      targetInput.targetId ||
      targetInput.verifiedReportId ||
      targetInput.reportID ||
      targetInput.ReportId ||
      targetInput.reportId ||
      targetInput.id;

    if (candidateId) return String(candidateId);
  } else if (targetInput && typeof targetInput !== 'object') {
    return String(targetInput);
  }

  // Fallback to selectedReport store state
  if (fallbackReport) {
    const reportId =
      fallbackReport?.reportID ||
      fallbackReport?.ReportId ||
      fallbackReport?.reportId ||
      fallbackReport?.id;

    if (reportId) {
      const strId = String(reportId);
      return strId.startsWith('RID') || strId.startsWith('VRID')
        ? strId
        : `Report_#${strId}`;
    }
  }

  return 'UNKNOWN_TARGET';
};

/**
 * Asynchronously gets a fresh Firebase ID Token.
 * Firebase automatically handles refreshing expired tokens.
 */
const getFreshAuthToken = async () => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (currentUser) {
      return await currentUser.getIdToken(false);
    }
  } catch (err) {
    console.warn('⚠️ Could not fetch token from Firebase Auth directly:', err.message);
  }

  // Fallback to local / session storage if auth instance isn't hydrated yet
  if (typeof window !== 'undefined') {
    return (
      localStorage.getItem('authToken') ||
      localStorage.getItem('token') ||
      localStorage.getItem('accessToken') ||
      sessionStorage.getItem('authToken') ||
      sessionStorage.getItem('token') ||
      ''
    );
  }

  return '';
};

/**
 * Custom hook to dispatch admin action/movement logs to the Render backend audit API.
 */
export const useAuditLog = ({
  adminId = 'ADMIN-004',
  adminName = 'System Admin',
  authToken = '',
  apiBaseUrl = RENDER_BACKEND_API,
} = {}) => {
  const {
    selectedReport,
    currentStep,
    verifiedIncidentType,
    verifiedSeverity,
    reportTitle,
    selectedAgencies,
    customLocation,
    isSensitive,
  } = useReportStore();

  /**
   * Core function to post an action movement log to /admin-actions/log
   * Supports both positional signature: logMovement(actionType, target, extraMetadata)
   * And single object signature: logMovement({ action, target, actorId, details, metadata })
   */
  const logMovement = useCallback(
    async (actionTypeOrObj, customTarget = null, extraMetadata = {}) => {
      let actionType = 'SYSTEM_ACTION';
      let targetInput = customTarget;
      let payloadMetadata = extraMetadata;
      let overrideAdminId = adminId;
      let overrideAdminName = adminName;
      let customDetails = null;

      // Handle single object parameter overload
      if (typeof actionTypeOrObj === 'object' && actionTypeOrObj !== null) {
        actionType = actionTypeOrObj.action || actionTypeOrObj.actionType || 'SYSTEM_ACTION';
        targetInput = actionTypeOrObj.target || actionTypeOrObj.targetId || customTarget;
        payloadMetadata = { ...actionTypeOrObj.metadata, ...extraMetadata };
        overrideAdminId = actionTypeOrObj.actorId || actionTypeOrObj.adminId || adminId;
        overrideAdminName = actionTypeOrObj.adminName || adminName;
        customDetails = actionTypeOrObj.details || null;
      } else if (typeof actionTypeOrObj === 'string') {
        actionType = actionTypeOrObj;
      }

      // Resolve fresh token dynamically
      let rawToken = authToken || (await getFreshAuthToken());

      if (rawToken && rawToken.startsWith('Bearer ')) {
        rawToken = rawToken.replace(/^Bearer\s+/i, '');
      }

      // Resolve Target String safely
      const targetString = resolveTargetString(targetInput, selectedReport);

      const payload = {
        action: actionType,
        target: targetString,
        adminId: overrideAdminId,
        adminName: overrideAdminName,
        details: customDetails || `${overrideAdminName} (${overrideAdminId}) performed ${actionType} on ${targetString}`,
        metadata: {
          currentStep,
          reportTitle: reportTitle || selectedReport?.title || '',
          verifiedIncidentType: verifiedIncidentType || selectedReport?.type || '',
          verifiedSeverity,
          selectedAgencies,
          customLocation,
          isSensitive,
          ...payloadMetadata,
        },
      };

      const headers = {
        'Content-Type': 'application/json',
      };

      if (rawToken) {
        headers['Authorization'] = `Bearer ${rawToken}`;
      }

      // Ensure base URL formatted without trailing slashes
      const cleanBaseUrl = apiBaseUrl.replace(/\/+$/, '');

      try {
        const response = await axios.post(`${cleanBaseUrl}/admin-actions/log`, payload, { headers });

        console.log(
          `✅ [Audit Log Dispatched] ${overrideAdminId} -> ${actionType} on ${targetString}`,
          response.data
        );
        return response.data;
      } catch (error) {
        console.error(
          `❌ [Audit Log Failed] Failed to log action "${actionType}":`,
          error.response?.data || error.message
        );
        return null;
      }
    },
    [
      adminId,
      adminName,
      authToken,
      apiBaseUrl,
      selectedReport,
      currentStep,
      reportTitle,
      verifiedIncidentType,
      verifiedSeverity,
      selectedAgencies,
      customLocation,
      isSensitive,
    ]
  );

  // Aliases for backward compatibility and component flexibility
  const logAction = logMovement;
  const logAdminAction = logMovement;

  // ====================================================
  // 📥 EXPORT AUDIT MOVEMENT HELPERS
  // ====================================================

  /**
   * Generic export event logger
   */
  const logExportData = useCallback(
    (exportType = 'EXPORT_DATA', format = 'CSV', recordCount = 0, metadata = {}) => {
      const exportFormat = String(format).toUpperCase();
      return logMovement(exportType, `EXPORT_${exportFormat}`, {
        exportFormat,
        recordCount,
        exportedAt: new Date().toISOString(),
        ...metadata,
      });
    },
    [logMovement]
  );

  /**
   * Log exporting filtered or active reports list
   */
  const logExportFilteredReports = useCallback(
    (format = 'CSV', recordCount = 0, activeFilters = {}) => {
      const exportFormat = String(format).toUpperCase();
      return logMovement('EXPORT_FILTERED_REPORTS', `EXPORT_${exportFormat}`, {
        exportFormat,
        recordCount,
        appliedFilters: activeFilters,
        exportedAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  /**
   * Log exporting Barangay summary analytics
   */
  const logExportBarangayAnalytics = useCallback(
    (format = 'CSV', totalBarangaysCount = 0, metadata = {}) => {
      const exportFormat = String(format).toUpperCase();
      return logMovement('EXPORT_BARANGAY_ANALYTICS', `EXPORT_${exportFormat}`, {
        exportFormat,
        totalBarangaysCount,
        exportedAt: new Date().toISOString(),
        ...metadata,
      });
    },
    [logMovement]
  );

  /**
   * Log exporting Citizen and Agency interaction statistics
   */
  const logExportCitizenAgencyStats = useCallback(
    (format = 'CSV', metadata = {}) => {
      const exportFormat = String(format).toUpperCase();
      return logMovement('EXPORT_CITIZEN_AGENCY_STATS', `EXPORT_${exportFormat}`, {
        exportFormat,
        exportedAt: new Date().toISOString(),
        ...metadata,
      });
    },
    [logMovement]
  );

  // ====================================================
  // 🚨 REPORT RESOLUTION & ARCHIVING MOVEMENT HELPERS
  // ====================================================

  /**
   * Log resolving an active incident report (e.g. status set to RESOLVED)
   */
  const logResolveReport = useCallback(
    (report, resolutionNotes = '') => {
      const targetId = report?.reportID || report?.ReportId || report?.reportId || report?.id;
      return logMovement('RESOLVE_REPORT', targetId, {
        previousStatus: report?.status || 'PENDING',
        newStatus: 'RESOLVED',
        resolutionNotes,
        resolvedAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  /**
   * Log archiving a report
   */
  const logArchiveReport = useCallback(
    (report, archiveReason = '') => {
      const targetId = report?.reportID || report?.ReportId || report?.reportId || report?.id;
      return logMovement('ARCHIVE_REPORT', targetId, {
        reportTitle: report?.title || report?.reportTitle || 'N/A',
        archiveReason,
        archivedAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  // ====================================================
  // 🚨 REPORT VERIFICATION WORKFLOW HELPERS
  // ====================================================

  const logOpenVerifyModal = useCallback(
    (report) => {
      const targetId = report?.reportID || report?.ReportId || report?.reportId || report?.id;
      return logMovement('OPEN_VERIFY_MODAL', targetId, {
        initialType: report?.type || report?.incidentType,
        initialSeverity: report?.severity,
      });
    },
    [logMovement]
  );

  const logStepChange = useCallback(
    (nextStep) => {
      return logMovement('VERIFY_STEP_CHANGED', null, {
        previousStep: currentStep,
        nextStep,
      });
    },
    [logMovement, currentStep]
  );

  const logFieldUpdate = useCallback(
    (fieldName, newValue) => {
      return logMovement('VERIFY_FIELD_UPDATED', null, {
        field: fieldName,
        updatedValue: newValue,
      });
    },
    [logMovement]
  );

  const logCompleteVerification = useCallback(
    (finalDispatchData = {}) => {
      return logMovement('REPORT_VERIFIED', null, {
        status: 'VERIFIED',
        completedAt: new Date().toISOString(),
        ...finalDispatchData,
      });
    },
    [logMovement]
  );

  const logCancelVerification = useCallback(
    (reason = 'User closed modal') => {
      return logMovement('CANCEL_VERIFICATION', null, {
        reason,
        stoppedAtStep: currentStep,
      });
    },
    [logMovement, currentStep]
  );

  // ====================================================
  // 🔗 BROADCAST & SHARE LINK MOVEMENT HELPERS
  // ====================================================

  const logOpenShareModal = useCallback(
    (report) => {
      const targetId = report?.reportID || report?.ReportId || report?.reportId || report?.id || report?.incidentId;
      return logMovement('OPEN_SHARE_MODAL', targetId, {
        reportTitle: report?.title || report?.reportTitle || 'N/A',
        incidentType: report?.type || report?.incidentType || 'N/A',
      });
    },
    [logMovement]
  );

  const logGenerateSharedLink = useCallback(
    (incident, linkData = {}) => {
      const targetId =
        typeof incident === 'string'
          ? incident
          : incident?.reportID || incident?.ReportId || incident?.reportId || incident?.id || incident?.incidentId || 'REPORT';

      const rawTarget = String(linkData?.target || 'citizen').toLowerCase();
      const isCitizen = rawTarget === 'citizen';
      const targetAudience = isCitizen ? 'CITIZEN' : 'DEPARTMENT';
      const destinationPage = isCitizen ? 'PublicReportsPage2.jsx' : 'PublicReportsPage.jsx';

      const actionSummary = `${adminId} generated ${targetAudience} link for ${targetId}`;

      return logMovement('GENERATE_SHARE_LINK', targetId, {
        targetDepartment: targetAudience,
        destinationComponent: destinationPage,
        summary: actionSummary,
        linkKey: linkData?.linkKey || 'N/A',
        secureLink: linkData?.secureLink || 'N/A',
        expiresAt: linkData?.expiresAt || null,
        generatedAt: new Date().toISOString(),
      });
    },
    [logMovement, adminId]
  );

  const logCopySharedLink = useCallback(
    (linkUrl, targetDepartment = 'citizen', incidentId = null) => {
      const rawTarget = String(targetDepartment).toLowerCase();
      const isCitizen = rawTarget === 'citizen';
      const audience = isCitizen ? 'CITIZEN' : 'DEPARTMENT';
      const destinationPage = isCitizen ? 'PublicReportsPage2.jsx' : 'PublicReportsPage.jsx';

      return logMovement('COPY_SHARE_LINK', incidentId, {
        targetDepartment: audience,
        destinationComponent: destinationPage,
        copiedUrl: linkUrl,
        summary: `${adminId} copied ${audience} link`,
        copiedAt: new Date().toISOString(),
      });
    },
    [logMovement, adminId]
  );

  const logRevokeSharedLink = useCallback(
    (linkKey, reason = 'Admin manual revocation') => {
      return logMovement('REVOKE_SHARE_LINK', linkKey, {
        linkKey,
        reason,
        revokedAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  // ====================================================
  // 👥 CITIZEN MANAGEMENT AUDIT MOVEMENT HELPERS
  // ====================================================

  const logViewCitizen = useCallback(
    (citizen) => {
      const cid = getCitizenId(citizen);
      return logMovement('VIEW_CITIZEN_PROFILE', cid, {
        citizenName: citizen?.fullName || citizen?.name || 'N/A',
        citizenEmail: citizen?.email || 'N/A',
        zone: citizen?.zone || 'Unassigned',
      });
    },
    [logMovement]
  );

  const logRegisterCitizen = useCallback(
    (newCitizen) => {
      const cid = getCitizenId(newCitizen);
      return logMovement('CREATE_CITIZEN', cid, {
        citizenName: newCitizen?.fullName || newCitizen?.name || 'N/A',
        citizenEmail: newCitizen?.email || 'N/A',
        phoneNumber: newCitizen?.phoneNumber || newCitizen?.phone || 'N/A',
        zone: newCitizen?.zone || 'Unassigned',
        registeredAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  const logEditCitizen = useCallback(
    (citizen, updatedFields = {}) => {
      const cid = getCitizenId(citizen);
      return logMovement('EDIT_CITIZEN', cid, {
        citizenName: citizen?.fullName || citizen?.name || 'N/A',
        updatedFields,
        editedAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  const logToggleCitizenStatus = useCallback(
    (citizen, isDisabled) => {
      const cid = getCitizenId(citizen);
      const actionType = isDisabled ? 'DISABLE_CITIZEN_ACCOUNT' : 'ENABLE_CITIZEN_ACCOUNT';
      return logMovement(actionType, cid, {
        citizenName: citizen?.fullName || citizen?.name || 'N/A',
        newStatus: isDisabled ? 'Disabled' : 'Active',
        isDisabled,
        changedAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  const logArchiveCitizen = useCallback(
    (citizen, reason = '') => {
      const cid = getCitizenId(citizen);
      return logMovement('ARCHIVE_CITIZEN', cid, {
        citizenName: citizen?.fullName || citizen?.name || 'N/A',
        reason,
        archivedAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  const logRestoreCitizen = useCallback(
    (citizen) => {
      const cid = getCitizenId(citizen);
      return logMovement('RESTORE_CITIZEN', cid, {
        citizenName: citizen?.fullName || citizen?.name || 'N/A',
        restoredAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  const logDeleteCitizen = useCallback(
    (citizen) => {
      const cid = getCitizenId(citizen);
      return logMovement('PERMANENT_DELETE_CITIZEN', cid, {
        citizenName: citizen?.fullName || citizen?.name || 'N/A',
        deletedAt: new Date().toISOString(),
      });
    },
    [logMovement]
  );

  return {
    logMovement,
    logAction,
    logAdminAction,

    // Export Action Helpers
    logExportData,
    logExportFilteredReports,
    logExportBarangayAnalytics,
    logExportCitizenAgencyStats,

    // Report Actions (Resolving & Archiving)
    logResolveReport,
    logArchiveReport,

    // Report Verification Helpers
    logOpenVerifyModal,
    logStepChange,
    logFieldUpdate,
    logCompleteVerification,
    logCancelVerification,

    // Broadcast & Shared Link Helpers
    logOpenShareModal,
    logGenerateSharedLink,
    logCopySharedLink,
    logRevokeSharedLink,

    // Citizen Management Helpers
    logViewCitizen,
    logRegisterCitizen,
    logEditCitizen,
    logToggleCitizenStatus,
    logArchiveCitizen,
    logRestoreCitizen,
    logDeleteCitizen,
  };
};

export default useAuditLog;